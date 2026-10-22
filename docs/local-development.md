# Local development

Windows-native workflow for this monorepo (Medusa v2 backend + Next.js
storefront). No Docker, no WSL, no cloud services, no paid services.

## Prerequisites

- Node.js >= 22.22.0 (required by this repo's `engines` field; the Medusa
  packages themselves support Node 20.19+/22.12+)
- pnpm 10.11.1 (`npm install -g pnpm@10.11.1`, or enable corepack)
- PostgreSQL 14 or newer running locally (verified on PostgreSQL 17)
- Python 3.12+ with Playwright, only if you want to run the E2E journey test
  (`pip install playwright && playwright install chromium`)

## One-time setup

All backend commands run from `apps\backend` unless noted. Secrets (database
password, JWT/cookie secrets, publishable keys) live only in your local
`.env` files — never commit them, never paste them into chats, scripts, or
GitHub issues.

1. Create a dedicated database (examples use `maison_public_local`; pick any
   name you like and keep it consistent in `DATABASE_URL`):

   ```powershell
   psql -U postgres -c "CREATE DATABASE maison_public_local;"
   ```

2. Copy the environment templates and fill in **your** values:

   ```powershell
   Copy-Item apps\backend\.env.template apps\backend\.env
   Copy-Item apps\storefront\.env.template apps\storefront\.env.local
   ```

   - `apps\backend\.env` — set `DATABASE_URL` to
     `postgres://USER:YOUR_PASSWORD@localhost:5432/maison_public_local`, and
     replace the `JWT_SECRET` / `COOKIE_SECRET` placeholders with long random
     strings of your own.
   - `apps\storefront\.env.local` — leave
     `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` empty for now (step 6 fills it).

3. Run migrations **from `apps\backend`**:

   ```powershell
   cd apps\backend
   pnpm exec medusa db:migrate
   ```

   On Medusa 2.21 this runs the schema migrations **and**
   `src/migration-scripts/initial-data-seed.ts` automatically (store, region,
   sales channel, shipping options, publishable API key, stock location, and
   4 starter products). **Do not run `initial-data-seed.ts` manually** — it
   is not idempotent and a second run creates duplicates.

4. Seed the demo catalogue (50 more products, deterministic handles; re-runs
   skip existing handles — 54 published products total):

   ```powershell
   pnpm exec medusa exec ./src/scripts/seed-demo-products.ts
   ```

   On a backend that has never booted, this script prints a warning that the
   search index is not ready yet and exits 0 — the products are created; the
   index is built on the backend's first boot.

5. Apply realistic stock levels (required — see "Inventory stock" below):

   ```powershell
   pnpm exec medusa exec ./src/scripts/seed-demo-inventory-levels.ts
   ```

6. Create your admin user (pick your own credentials, run locally — do not
   share them), then start the backend:

   ```powershell
   pnpm exec medusa user -e YOUR_EMAIL -p YOUR_PASSWORD
   cd ..\..
   pnpm run backend:dev
   ```

   Open http://localhost:9000/app and sign in.

7. Create the storefront publishable key: in the admin, go to
   **Settings -> Publishable API keys**, create a key, copy the token
   (`pk_...`), and paste it into `apps\storefront\.env.local` as
   `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...`. The storefront refuses to
   start without it (checked at boot by `check-env-variables.js`).

8. Start the storefront in a second terminal from the repository root:

   ```powershell
   pnpm run storefront:dev
   ```

### What success looks like

- Storefront: http://localhost:8000/dk (any locale prefix, or `/` which
  redirects) — the store page lists **54 products**, all purchasable
  (stock levels are set by step 5).
- Admin: http://localhost:9000/app — the catalog shows the same products.
- Checkout end-to-end works with the built-in **manual test payment
  provider** (`pp_system_default`). It never charges anyone and never
  contacts a real payment network.

## Daily workflow

From the repository root (after the one-time setup above):

```powershell
.\scripts\local-dev.ps1 start    # start backend (:9000) + storefront (:8000), wait for readiness
.\scripts\local-dev.ps1 status   # read-only port + HTTP checks (exit 0 when both are up)
.\scripts\local-dev.ps1 stop     # stop whatever owns :9000 and :8000
```

`pnpm dev` from the repository root also works once both `.env` files exist
(it runs both apps via pnpm's recursive runner).

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

## Verifying the environment

A read-only sanity report (counts + invariants, no secrets):

```powershell
cd apps\backend
pnpm exec medusa exec ./src/scripts/verify-local-state.ts
cd ..\..
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
`apps/storefront/.next/cache/fetch-cache` and restart the storefront — product
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
  test method (`pp_system_default`) — there is no real payment processing.
- Override the target with `E2E_BASE_URL` (default `http://localhost:8000`)
  and the artifact directory with `E2E_ARTIFACTS_DIR`.

## Test and quality commands

From the repository root:

```powershell
pnpm run lint                             # turbo lint (both workspaces)
pnpm --filter @dtc/storefront test        # vitest — 18 unit tests, no services needed
pnpm --filter @dtc/storefront exec tsc --noEmit
pnpm --filter @dtc/backend exec tsc --noEmit
pnpm run build                            # production builds of both apps
```

The backend currently ships **no Jest unit-test files** (its `test:unit`
script exists but matches nothing; on Windows it also fails earlier because
the script uses POSIX `VAR=value` syntax). This is tracked in ROADMAP.md.

## Unix-like systems

The same steps apply: use `cp` instead of `Copy-Item`, and run the apps with
`pnpm run backend:dev` / `pnpm run storefront:dev` (or `pnpm dev`) —
`scripts/local-dev.ps1` is PowerShell and needs `pwsh` on non-Windows hosts.
SQL, migration, and seed commands are identical.

## Known local-only deviations and observations

- pnpm 10 warns that the root `package.json` `pnpm.overrides` field is
  ignored; the effective dependency overrides live in `pnpm-workspace.yaml`
  (`sharp`, `proxy-addr` — both chosen to address published advisories).
- Telemetry is disabled via `MEDUSA_DISABLE_TELEMETRY=true` when set in your
  environment (the dev scripts set it in documented setups).
- PostgreSQL on this reference machine listens on localhost only, with
  `scram-sha-256` auth — your `DATABASE_URL` password must match the role.
- `GET /store/locales` 404s (storefront calls it; harmless).
- No customer accounts exist until someone registers through the storefront
  (or you create them in the admin); the guest checkout path is the one
  exercised by the E2E test.

## Troubleshooting

- **`password authentication failed for user ...` / connection refused on
  5432** — the database role/password in `DATABASE_URL` is wrong, or
  PostgreSQL is not running (`Get-Service postgresql*` on Windows). Fix the
  URL in `apps\backend\.env`; do not commit it. "Database does not exist"
  means step 1 was skipped or used a different name.
- **Storefront exits immediately with "Missing required environment
  variables"** — `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` is empty in
  `apps\storefront\.env.local` (step 7).
- **Backend starts but `/health` fails** — check
  `.local-logs\backend.err.log`; the usual causes are a bad `DATABASE_URL`
  or a migration that was never run (step 3).
- Blank storefront page with a black circle in the corner: a Next.js dev
  compile/hydration error — check the storefront console or
  `.local-logs/storefront.err.log`, then reload.
- "Out of stock" on every product: run
  `pnpm exec medusa exec ./src/scripts/seed-demo-inventory-levels.ts`
  (see Inventory stock), clear the fetch cache, restart the storefront.
- Duplicate stores/regions after a fresh setup: `initial-data-seed.ts` was
  probably run a second time by hand — recreate the database and redo
  steps 1-5 (it is not idempotent).
- Backend up but checkout shows no delivery/payment options: confirm the
  region has shipping options (`verify-local-state.ts` reports counts) and
  reload; option lists hydrate client-side after the address step.
- Ports busy: `.\scripts\local-dev.ps1 status` shows what is listening;
  `stop` frees :9000 and :8000.
