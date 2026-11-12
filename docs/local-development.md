# Local development

Windows-native workflow for this monorepo (Medusa v2 backend + Next.js
storefront). No Docker, no WSL, no cloud services, no paid services.

For **production deployment** (architecture, env reference, reverse proxy
status, health checks, the tested clean-install record) see
[DEPLOYMENT.md](DEPLOYMENT.md); upgrades/rollback: [UPGRADING.md](UPGRADING.md).

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
   pnpm run db:migrate
   ```

   On Medusa 2.21 this runs the schema migrations **and**
   `src/migration-scripts/initial-data-seed.ts` automatically (store, region,
   sales channel, shipping options, publishable API key, stock location, and
   4 starter products). The seed itself is **not** idempotent, so it now
   carries a re-run guard: a second run *skips* when the data is already
   there and *aborts with an error* on a partially seeded database instead of
   creating duplicates. Prefer not to run it manually at all.

   `pnpm run db:migrate` is a thin repo-side wrapper
   (`scripts/migrate-checked.js`) around the upstream `medusa db:migrate`.
   Upstream 2.21.2 discards the exit code of its migration-script child
   process (finding F3 — a failing seed printed an error but the command
   still exited 0), so the wrapper additionally verifies that every row in
   `script_migrations` has `finished_at` set and fails the run if any script
   did not finish. Use the wrapper for anything that gates on exit status
   (CI, scripts); the regression suite lives in
   `apps/backend/integration-tests/migrate/` and runs with
   `pnpm run test:integration:migrate`.

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

7. **Configure at least one tax rate per country you sell in** — in the
   admin go to **Settings -> Tax regions**, open your country (e.g. Germany),
   and add a rate (e.g. `19%`, code `VAT`, marked as default). The initial
   seed creates tax *regions* for the seeded countries but **no rates**, so
   without this step every checkout silently computes `tax_total = 0` and
   the order carries no tax lines (verified by the regression suite in
   `apps/backend/integration-tests/http/tax-calculation.spec.ts` and by the
   merchant-path suite
   `apps/backend/integration-tests/http/tax-configuration.spec.ts`). The
   same can be done through the Admin API:
   `POST /admin/tax-rates` with `tax_region_id`, `rate`, `code`, and
   `is_default` in the body. Full setup guide, inclusive-pricing notes, and
   limitations: [TAX.md](TAX.md).

8. Create the storefront publishable key: in the admin, go to
   **Settings -> Publishable API keys**, create a key, copy the token
   (`pk_...`), and paste it into `apps\storefront\.env.local` as
   `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...`. The storefront refuses to
   start without it (checked at boot by `check-env-variables.js`).

9. Start the storefront in a second terminal from the repository root:

   ```powershell
   pnpm run storefront:dev
   ```

### What success looks like

- Storefront: http://localhost:8000/dk (any locale prefix, or `/` which
  redirects) — the store page lists **54 products**, all purchasable
  (stock levels are set by step 5).
- Admin: http://localhost:9000/app — the catalog shows the same products.
- Checkout end-to-end works with the built-in **manual test payment
  provider** (`pp_system_default`) and the labelled **development payment
  provider** (`pp_dev-payment_default`, [PAYMENTS.md](PAYMENTS.md)). They
  never charge anyone and never
  contact a real payment network.

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

## Backups

Create a logical backup and restore it into a new, isolated database (with
row-count verification) using the repo scripts — see **`docs/BACKUPS.md`** for
the full procedure, the restore drill, and incident order. Quick version:

```powershell
cd apps\backend
pnpm run db:backup                                  # writes apps\backend\backups\<db>-<timestamp>.dump (git-ignored)
pnpm run db:restore -- <dump> <new_database_name>   # refuses to touch an existing database
```

The scripts find `pg_dump`/`pg_restore` via `PG_BIN`, `PATH`, or the default
PostgreSQL install locations. Backup files contain all store data including
customer PII — keep them private. The automated restore drill runs with
`pnpm run test:integration:migrate` (`integration-tests/migrate/backup-restore.spec.ts`).

## SEO: sitemap and robots

The storefront generates both files through framework-native Next.js metadata
routes (G11 — these replaced an obsolete, never-installed `next-sitemap` config):

- `src/app/sitemap.ts` → `/sitemap.xml` — country homepages for every region
  country, `/store` per country, and all **published** products, collections
  and categories. Cart, checkout, account, order, admin and API routes are
  never included. Regenerated hourly (`revalidate = 3600`); if the backend is
  unreachable at generation time the sitemap degrades to the static routes
  instead of failing.
- `src/app/robots.ts` → `/robots.txt` — allows public pages, disallows cart,
  checkout, account, order, verification and API paths (both bare and
  country-prefixed), and points at the absolute sitemap URL. Robots rules are
  crawler etiquette, **not access control**.
- Absolute URLs come from `NEXT_PUBLIC_BASE_URL` (validated — see
  `.env.template` and the production-build note under "Test and quality
  commands").

Unit coverage lives in `apps/storefront/src/lib/seo/*.test.ts` and
`src/lib/util/env.test.ts` (run with `pnpm --filter @dtc/storefront test`).

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

## Auth rate limiting

Every request under `/auth/*` (login, register, password reset, token
refresh) passes through an in-memory rate limiter
(`apps/backend/src/lib/auth-rate-limit.ts`, registered in
`src/api/middlewares.ts`).

Configuration (environment variables, plain integers — see
`apps/backend/.env.template`):

| Variable                       | Default | Meaning                                            |
| ------------------------------ | ------- | -------------------------------------------------- |
| `RATE_LIMIT_AUTH_MAX`          | `10`    | Requests allowed per client per window             |
| `RATE_LIMIT_AUTH_WINDOW_MS`    | `60000` | Window length in milliseconds                      |
| `RATE_LIMIT_TRUSTED_PROXY_HOPS`| `0`     | Trusted reverse-proxy hops before                  |
|                                |         | `X-Forwarded-For` is consulted                     |

Behavior:

- Counters are keyed per **client IP + HTTP method + path**, so a burst on
  one endpoint (say, login) never locks a user out of the others — an
  over-aggressive global lockout would itself be a denial of service.
- Within the limit the request proceeds and the response carries
  `X-RateLimit-Limit` and `X-RateLimit-Remaining`. Above the limit the
  response is HTTP 429 with `Retry-After` (seconds) and a JSON body
  `{ "message", "type": "rate_limit", "retryAfter" }`. Windows reset on
  their own; nothing is ever permanently locked.
- **Proxy/IP handling:** forwarded headers are ignored by default
  (`RATE_LIMIT_TRUSTED_PROXY_HOPS=0`) because any client can send
  `X-Forwarded-For` and would otherwise rotate fake addresses to bypass
  the limit. Behind a reverse proxy, set the hops to the number of trusted
  proxy layers; the client is then taken from the right-hand, proxy-appended
  portion of the header. If the header is missing or shorter than the hop
  count, the socket address is used (a shared bucket behind a proxy is
  preferable to a spoofable one).
- The middleware never logs: auth paths, headers, and bodies can carry
  credentials or tokens, and a rate-limit hit must not become a channel
  that writes them to disk. Covered by unit and integration tests.

**Known limitation — in-memory, per instance.** Counters live in the
backend process's memory. With multiple backend instances (or
serverless/autoscaled deployments) each instance enforces the limit
independently, so the effective global limit is `instances x configured
limit`, and counters reset on every deploy/restart. For a strict global
limit put a shared store in front: a Redis-backed limiter in the backend,
or an edge/CDN-level limiter (e.g. Cloudflare) in front of `/auth/*`.

To extend the limiter to other sensitive routes (for example
`/store/customers` password-adjacent endpoints or admin login helpers),
add a route entry with its own matcher in `src/api/middlewares.ts` and call
`createAuthRateLimitMiddleware()` again — each call creates an independent
counter store; reuse one instance if the routes should share a budget.

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
pnpm --filter @dtc/storefront test        # vitest — unit tests, no services needed
pnpm --filter @dtc/backend test           # jest — backend unit tests, no services needed
pnpm --filter @dtc/storefront exec tsc --noEmit
pnpm --filter @dtc/backend exec tsc --noEmit
pnpm run build                            # production builds of both apps
```

**Production builds require a public storefront origin.** Since the G11 SEO
work, `next build` validates `NEXT_PUBLIC_BASE_URL` and **fails with a clear
error** if it is missing, malformed, or a loopback address — production output
must never publish `localhost` canonical/Open Graph/sitemap URLs. The stock
`.env` (localhost, for the dev server) therefore works for `pnpm dev` but not
for `pnpm run build`; build locally with an explicit origin:

```powershell
$env:NEXT_PUBLIC_BASE_URL = "https://your-store.example.com"
pnpm run build
Remove-Item Env:\NEXT_PUBLIC_BASE_URL
```

CI uses the reserved placeholder `https://ci-build.example` for its
build-verification runs (see `.github/workflows/ci.yml`).

Backend tests run through `scripts/run-jest.js`, which sets `TEST_TYPE` and
`NODE_OPTIONS` on every platform (the old scripts used POSIX `VAR=value`
syntax and failed on Windows). `pnpm run test` from the repository root runs
both suites. The DB-backed integration suites still require a reachable
PostgreSQL and are not part of CI.

## HTTP integration tests (`apps/backend/integration-tests/http/`)

Deterministic suites that boot a real backend against a **disposable
database** using `medusaIntegrationTestRunner` (`@medusajs/test-utils`):

- `tax-calculation.spec.ts` — regression for the zero-tax clean install:
  configures an explicit 19% VAT rate, runs a full store checkout, and
  asserts the computed totals (1.90 item tax + 1.90 shipping tax = 3.80,
  order total 23.80) **and** the persisted tax lines on the stored order.
- `tax-configuration.spec.ts` — the G3 merchant path end to end: every
  rate/setting is created through the stock **admin API** (the same calls
  the dashboard makes, including an authenticated admin session), then a
  real store checkout is verified. Covers: no configuration = 0 tax and no
  tax lines; valid rate = correct item/shipping/order totals; province
  override; product-scoped rate vs. shipping default; tax-inclusive price
  extraction; a DE rate not applied to an FR address; invalid rates
  rejected with HTTP 400 naming the range (the G3 bounds middleware) and
  unknown tax regions with 404; rate changes not rewriting historical
  orders; `automatic_taxes: false` disabling automatic tax. Setup details
  in [TAX.md](TAX.md).
- `migrate/seed-exit-code.spec.ts` (run with
  `pnpm run test:integration:migrate`) — regression for finding F3: proves
  `pnpm run db:migrate` exits 0 on a clean install and non-zero when a
  migration script fails, even though the raw upstream `medusa db:migrate`
  exits 0 on the same failure. It does not boot the app; it spawns the CLI
  against a disposable database and drops it afterwards.

### How to run (two steps)

```powershell
# 1. From apps\backend: create a disposable database and run the app's own
#    documented clean-install migration against it (seeds region, tax
#    regions, products, publishable key, shipping, inventory):
#      CREATE DATABASE <name>;  then:
$env:DATABASE_URL = "postgres://USER:PASS@localhost:5432/<name>"
pnpm run db:migrate               # exit 0 = fixtures seeded (checked wrapper)

# 2. Run the suite. The runner builds its own connection from DB_* variables
#    (host/port/user/password) — it deliberately ignores DATABASE_URL, then
#    creates, boots, and finally DROPS a database it names itself:
$env:DB_HOST = "localhost"         # NOT 127.0.0.1: the runner enables SSL
$env:DB_PORT = "5432"              # for any host not containing "localhost"
$env:DB_USERNAME = "postgres"      # and node-postgres hard-fails on
$env:DB_PASSWORD = "..."           # declined SSL against a plain server
Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
pnpm run test:integration:http     # exit 0 = passed
```

Step 1 is required on Windows: the runner's own migration path was seen to
abort mid-migration with "Connection ended unexpectedly" here, while the
app's `medusa db:migrate` completes reliably; the pre-migrated fixtures also
let the suite reuse the exact documented clean-install state (including the
seed-guard behaviour under test). Expect ~40s per run.

### Suite design rules (learned the hard way)

- **The runner snapshots the database after the suite's `beforeAll` and
  restores it before every subsequent `it()`** (its `beforeEach` terminates
  all connections via `pg_terminate_backend`, drops and recreates the
  database from the template). Data created inside one test is therefore
  invisible to the next test. Keep each scenario — including its
  assertions — inside a single `it()`, or re-create state in each test.
- The `Connection Error: Connection ended unexpectedly` lines and the
  `[Search] Failed to seed "product"` error in the log are **benign**: they
  come from the snapshot/restore terminating connections while the search
  module's boot-time index seeding is still running. Assertions are
  unaffected.
- Raw `query.graph({ entity: "order" })` fields use **plain relation paths**
  (`"items.tax_lines"`). The `*items.tax_lines` expansion syntax belongs to
  the HTTP query-config layer and is **silently dropped** by `query.graph`
  (the returned object then simply lacks `items`).
- Module-level queries return Medusa `BigNumber` objects for rates/totals —
  coerce with `Number(...)` before numeric assertions.
- `initialDataSeed` cannot run inside the suite: the store module
  auto-creates a store during app boot, which trips the seed's re-run guard
  ("partial initial seed detected"). Pre-migrate instead (step 1 above).
- The runner boots the full app, **admin HTTP API included** (verified
  empirically in G3: unauthenticated `GET /admin/regions` returns 401
  Unauthorized, and authenticated `POST /admin/tax-rates` works). It logs
  `Disabling admin as we run integration tests` — that refers to the admin
  *dashboard UI*, not the API routes. To exercise admin flows in a suite,
  create a user like `medusa user` does (workflow `create-users-workflow` +
  `authService.register("emailpass")` + link the auth identity to the user
  id), then log in via `POST /auth/user/emailpass` and send the token as a
  Bearer header — see `tax-configuration.spec.ts` for the working pattern.
  Module services (e.g. `container.resolve(Modules.TAX).createTaxRates(...)`)
  remain a valid alternative when the API path is not what you are testing.

## Unix-like systems

The same steps apply: use `cp` instead of `Copy-Item`, and run the apps with
`pnpm run backend:dev` / `pnpm run storefront:dev` (or `pnpm dev`) —
`scripts/local-dev.ps1` is PowerShell and needs `pwsh` on non-Windows hosts.
SQL, migration, and seed commands are identical.

## Known local-only deviations and observations

- Dependency-overrides location (corrected 2026-10 sprint): with the pinned
  `pnpm@10.11.1` (root `packageManager` field), the effective overrides are
  the ones in the root **`package.json`** under `pnpm.overrides` — pnpm 10
  does **not** read `overrides` from `pnpm-workspace.yaml` (proven three
  ways; a global pnpm 11 emits a warning in the opposite direction, which
  only applies once the `packageManager` pin moves to pnpm 11). Both files
  are kept in sync so either reader sees the same set; after any override
  change, confirm with a fresh `pnpm audit` that the advisory actually
  cleared. The overrides exist to address published advisories
  (`sharp`, `proxy-addr`, and the Sprint-3 security batches — see
  `docs/SECURITY_ADVISORIES.md`).
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
  `apps\storefront\.env.local` (step 8).
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
  probably run a second time by hand (the re-run guard added in the
  2026-10 sprint now catches this and skips/aborts, but databases seeded
  before that may still hold duplicates) — recreate the database and redo
  steps 1-5.
- Backend up but checkout shows no delivery/payment options: confirm the
  region has shipping options (`verify-local-state.ts` reports counts) and
  reload; option lists hydrate client-side after the address step.
- Checkout total equals the item+shipping subtotal (no tax anywhere, tax
  lines missing on the order): no tax **rate** exists for the shipping
  country — see step 7. Tax *regions* alone are not enough; each region
  needs at least one rate.
- Ports busy: `.\scripts\local-dev.ps1 status` shows what is listening;
  `stop` frees :9000 and :8000.
