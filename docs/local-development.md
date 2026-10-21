# Local development

Windows-native workflow for this monorepo (Medusa v2 backend + Next.js
storefront). No Docker, no WSL, no cloud services, no paid services.

## Prerequisites

- Node.js >= 22.22.0 (this machine runs v24)
- pnpm 10.11.1 (`npm install -g pnpm@10.11.1`, or enable corepack)
- PostgreSQL 16+ running locally with a dedicated database and role
- Python 3.12+ with Playwright, only if you want to run the E2E journey test
  (`pip install playwright && playwright install chromium`)

## One-time database setup

All commands run from `apps/backend` unless noted. Secrets (database
password, JWT/cookie secrets) live only in your local `.env` files - never
commit them, never paste them into chats or scripts.

1. Create the database and role in PostgreSQL (e.g. database `maison_public_local`).
2. Copy env templates and fill values locally:
   - `apps/backend/.env` from `apps/backend/.env.template`
   - `apps/storefront/.env.local` from `apps/storefront/.env.template`
3. Run migrations: `pnpm exec medusa db:migrate`
4. Seed the base commerce data (region, channel, sales channel, shipping
   options, payment provider, stock location, 4 starter products):
   `pnpm exec medusa exec ./src/migration-scripts/initial-data-seed.ts`
5. Seed the demo catalog (50 products, deterministic handles):
   `pnpm exec medusa exec ./src/scripts/seed-demo-products.ts`
6. Apply realistic stock levels (required - see "Inventory stock" below):
   `pnpm exec medusa exec ./src/scripts/seed-demo-inventory-levels.ts`
7. Create your admin user (pick your own credentials, run locally - do not
   share them):
   `pnpm exec medusa user -e YOUR_EMAIL -p YOUR_PASSWORD`
   Then open http://localhost:9000/app and sign in.

## Daily workflow

From the repo root:

```powershell
.\scripts\local-dev.ps1 start    # start backend (:9000) + storefront (:8000), wait for readiness
.\scripts\local-dev.ps1 status   # read-only port + HTTP checks (exit 0 when both are up)
.\scripts\local-dev.ps1 stop     # stop whatever owns :9000 and :8000
```

Notes:

- `start` never starts a duplicate process on a port that is already
  listening, and never runs migrations or seeds (setup is manual, above).
- Logs go to `.local-logs/` (git-ignored): `backend.out.log`,
  `backend.err.log`, `storefront.out.log`, `storefront.err.log`.
- The backend runs `medusa develop`, which watches `apps/backend/src/` and
  restarts on edits (roughly 30-60s). Transient connection-refused errors on
  :9000 during that window are expected.
- Storefront routes compile on first visit in dev; automated tests already
  account for this with generous timeouts.

Storefront: http://localhost:8000 (locale-prefixed, e.g. http://localhost:8000/dk)
Admin: http://localhost:9000/app

## Verifying the environment

A read-only sanity report (counts + invariants, no secrets):

```powershell
cd apps\backend
pnpm exec medusa exec ./src/scripts/verify-local-state.ts
```

It fails (exit 1) if there are no published products, if any inventory item
is missing a level, or if no region/shipping options exist. It also lists
orders (display id, status, currency) and the user count.

## Inventory stock

`seed-demo-inventory-levels.ts` maintains stock for every inventory item at
the seeded warehouse location. It is idempotent: items are created only when
missing, updated only when the quantity differs from the target, skipped
otherwise. It never touches variant-to-item links.

Configuration (optional environment variables, plain integers/flags):

| Variable              | Default | Meaning                                              |
| --------------------- | ------- | ---------------------------------------------------- |
| `DEMO_STOCK_QUANTITY` | `10`    | Flat quantity for every level (integer 1..100000)    |
| `DEMO_STOCK_VARIED`   | off     | `1`/`true`/`yes` = deterministic 5-50 per item,      |
|                       |         | derived from the item SKU (stable across runs)       |

Why this script is required: `seed-demo-products.ts` (via
`createProductVariantsWorkflow`) attaches an inventory item to every managed
variant but creates no level for items added after the initial migration
seed. Items without a level report `inventory_quantity = 0` and the
storefront shows "Out of stock". The initial migration seed also writes
one-time placeholder quantities (1,000,000); the first run of this script
normalizes them to the configured target.

If you change stock data while the storefront is running, delete
`apps/storefront/.next/cache/fetch-cache` and restart the storefront - product
queries are fetched with `force-cache` and otherwise keep stale values.

## E2E journey test

One real order through the storefront (home -> store -> search -> PDP ->
cart -> checkout -> confirmation):

```powershell
python tests\e2e\e2e-journey.py
```

- Requires both services running (`.\scripts\local-dev.ps1 start`).
- Exit 0 = order confirmed; screenshots and `result.txt` are written to
  `tests/e2e/artifacts/` (git-ignored).
- Every successful run places one new **pending** order for the test buyer
  `e2e.buyer@example.com`. Orders are never marked paid or fulfilled by the
  test. The only configured payment provider is Medusa's built-in manual
  test method (`pp_system_default`) - there is no real payment processing.
- Override the target with `E2E_BASE_URL` (default `http://localhost:8000`)
  and the artifact directory with `E2E_ARTIFACTS_DIR`.

## Test and quality commands

From the repo root:

```powershell
pnpm run lint            # turbo lint (all workspaces)
pnpm --filter @dtc/storefront test   # vitest (unit)
pnpm --filter @dtc/backend run test:unit   # if present in backend package
```

## Known local-only deviations and observations

- `apps/storefront/.env.local` uses `http://localhost:8000` for
  `NEXT_PUBLIC_BASE_URL` (the template assumes https).
- pnpm 10 warns that the root `package.json` `pnpm.overrides` field is
  ignored (pre-existing; fix path is a `pnpm-workspace.yaml` migration -
  not done here to keep the lockfile untouched).
- Telemetry is disabled via `MEDUSA_DISABLE_TELEMETRY=true`.
- PostgreSQL listens on localhost only, with `scram-sha-256` auth.
- `GET /store/locales` 404s (storefront calls it; harmless).
- No user accounts exist until you create your admin user (step 7 above);
  the customer account journeys are therefore untested.

## Troubleshooting

- Blank storefront page with a black circle in the corner: a Next.js dev
  compile/hydration error - check the storefront console or
  `.local-logs/storefront.err.log`, then reload.
- "Out of stock" on every product: run
  `pnpm exec medusa exec ./src/scripts/seed-demo-inventory-levels.ts`
  (see Inventory stock), clear the fetch cache, restart the storefront.
- Backend up but checkout shows no delivery/payment options: confirm the
  region has shipping options (`verify-local-state.ts` reports counts) and
  reload; option lists hydrate client-side after the address step.
- Ports busy: `.\scripts\local-dev.ps1 status` shows what is listening;
  `stop` frees :9000 and :8000.
