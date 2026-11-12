# Adopting OpenShop

This guide is for someone evaluating or running OpenShop for real. Every claim
marked **[verified]** was executed in this repository on 2026-10-28 (Stage 5 of
the sprint; full record in [STAGE5_JOURNEY.md](STAGE5_JOURNEY.md)). Anything
not marked that way is either sourced from the code or explicitly listed as
not yet done.

## 1. Honest scope

OpenShop is a self-hosted DTC storefront built on Medusa 2.21 (MIT, adapted
from the Medusa DTC Starter). It is **not** a hosted platform, not affiliated
with Shopify, and not production-hardened — see "What this is not" in the
[README](../README.md). Use it to learn, prototype, or run a small
test-mode store; read section 5 before any real money moves.

## 2. The verified path

Executed on a clean tree copy with a throwaway database. Commands are the
ones in the README quick start; results are what actually happened.

| Step | Command | Result [verified] |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | exit 0 (52.4 s) — lockfile installs unmodified |
| Configure | copy `.env.template` files, set `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET` | backend startup **fails fast and names** any missing/invalid variable (never prints values) |
| Migrate + seed | `pnpm exec medusa db:migrate` | exit 0; created 1 store, 1 region, 4 products, 20 variants, 2 shipping options, publishable key, 20 inventory levels; runs 2 and 3 changed nothing |
| Demo catalogue | `pnpm exec medusa exec ./src/scripts/seed-demo-products.ts` (+ inventory levels) | 54 products / 440 variants / 440 inventory items; rerun prints "Nothing to do" |
| Admin user | `pnpm exec medusa user -e ... -p ...` | created; login `POST /auth/user/emailpass` → 200 (see gotcha below) |
| Run | `.\scripts\local-dev.ps1 start` | backend `/health` 200, storefront 200 |
| Buy | `python tests/e2e/e2e-journey.py` | **exit 0** — full checkout to a confirmed order, 13 screenshots |

**Admin API gotcha [verified]:** the working login route in Medusa 2.21 is
`POST /auth/user/emailpass` (returns `{token}`). `POST /admin/auth` is a
different session route and always answers 401 — it is not a credential bug.

## 3. What you get out of the box

- 54 published products / 440 variants, all in stock **[verified]**
- 1 region (7 EU countries), 2 shipping options, publishable API key **[verified]**
- Multi-step checkout (address → delivery → payment → review) with the
  **test payment provider** (`pp_system_default` — authorizes, never charges)
  and the labelled **development payment provider**
  (`pp_dev-payment_default` — simulates the full lifecycle in the database;
  refuses to boot in production without an explicit acknowledgement — see
  [PAYMENTS.md](PAYMENTS.md)) **[verified]**
- Order placement writes correct line items, shipping line, totals, and an
  inventory reservation; cancel releases the reservation **[verified]**
- Admin dashboard at `/app`; admin API with Bearer auth; anonymous admin
  requests rejected **[verified]**
- Async CSV export for orders/products (`POST /admin/{orders,products}/export`
  → 202 → CSV delivered to `/static/private-…`) — products export produced
  440 data rows matching the 440 variants **[verified]**
- Rerun-safe seeds: re-running the initial seed skips when complete and
  aborts with counts when partial **[verified]** (the manual `medusa exec` path
  is guarded too)
- Tests: storefront 43/43 + backend 17/17, lint and type-check clean, production
  build succeeds **[verified]**

## 4. Configuration checklist

1. `DATABASE_URL` → your own database (never a shared/dev one for experiments).
2. `JWT_SECRET` / `COOKIE_SECRET` → long random values; startup validation
   names them if missing.
3. Storefront `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` → `pk_…` from
   Settings → Publishable API keys; the storefront's preflight check rejects
   missing/malformed values before the app boots.
4. `*_CORS` entries for your real storefront origin when not on localhost.
5. Leave the test/development providers in place until you deliberately wire
   a real one — the admin shows a "For testing purposes only" badge in every
   build mode, and the development provider additionally warns on every boot
   and refuses production start-up unless `ENABLE_DEV_PAYMENT_PROVIDER=true`
   acknowledges that payments are simulated.

## 5. Before taking real orders (blocking checklist)

Each item is tracked with an acceptance test in [ROADMAP.md](../ROADMAP.md).

- **Payments:** only simulated/test providers exist (manual test +
  development). Stripe (or any real provider)
  is not wired, and a simulated successful payment is not a payment
  integration (G5 does not raise payment readiness; Gate 3 stays FAIL).
  PCI scope becomes yours the moment a real one is (P0-6/P1).
- **Tax:** no tax rates are seeded, so checkout totals contain no tax
  (P1-9). Configure rates for your jurisdictions and re-test.
- **Rate limiting:** `/auth/*` is rate-limited (in-memory, per instance —
  no shared Redis store yet, G6); every other endpoint is unlimited
  (P1-3 tail).
- **Dependencies:** `pnpm audit --prod` reported **1 advisory** at adoption
  (down from 36: `deepmerge@4.3.1` low, no patched version exists — P0-6
  tail). **Update 2026-11-08 (G10-E): the live feed added 2 moderates**
  (`glob` GHSA-3g3m-2fjr-6pw4, `minimatch` GHSA-g3hv-75wg-m249, both via
  `@medusajs/cli`, patched upstream, overrides pending approval) — count
  **3** at that point, see `docs/SECURITY_ADVISORIES.md`. **Update
  2026-11-09 (G10-F): both moderates remediated** via the approved
  selector override (`"glob@13.0.6": "^14.0.2"`) — current count back to
  **1** (the unfixable `deepmerge` low). Budget for a pinned
  Medusa upgrade when it patches.
- **Staff access:** no RBAC usage — every admin identity has full power (P1-6).
- **Email:** no notification provider; account/order emails are undeliverable
  as shipped (P1-4).
- **Backups/upgrades:** documented and tested — [BACKUPS.md](BACKUPS.md)
  (backup + restore with row-count verification), [UPGRADING.md](UPGRADING.md)
  and [DEPLOYMENT.md](DEPLOYMENT.md) (clean-install test, upgrade/rollback).
  You still operate PostgreSQL, TLS and the reverse proxy yourself — those
  sections are explicitly **[NOT TESTED]** (no proxy/TLS tooling on the test
  machine).
- **`db:migrate` exit code:** use `pnpm run db:migrate` — the checked
  wrapper verifies migration-script completion in the database. The raw
  `pnpm exec medusa db:migrate` can still be 0 even when the seed script
  fails (upstream CLI bug, P1-10) — if you use it, read the output too.

## 6. Day-2 operations

```powershell
.\scripts\local-dev.ps1 start    # backend + storefront, waits until ready
.\scripts\local-dev.ps1 status   # read-only health check
.\scripts\local-dev.ps1 stop     # frees :9000 and :8000
pnpm run test                    # 43 storefront + 17 backend unit tests
pnpm run build                   # production build of both apps
```

Optional end-to-end check (creates **one pending order** in whatever database
the backend is pointed at — use a throwaway DB):

```powershell
python tests\e2e\e2e-journey.py
```

Note: another app running on ports 8000/9000 will silently answer instead of
OpenShop — `local-dev.ps1 stop` first if in doubt.

## 7. Evidence and further reading

| Document | What it contains |
| --- | --- |
| [PRODUCT_AUDIT.md](PRODUCT_AUDIT.md) | Full audit: feature matrix, ranked problems H1–L14, stage outcomes |
| [SHOPIFY_PARITY_MATRIX.md](SHOPIFY_PARITY_MATRIX.md) | Category-by-category comparison with measurable acceptance tests (no affiliation claims) |
| [ROADMAP.md](../ROADMAP.md) | Prioritized P0–P4 work with acceptance criteria |
| [STAGE5_JOURNEY.md](STAGE5_JOURNEY.md) | The isolated end-to-end test record, including everything marked NOT RUN and why |
| [local-development.md](local-development.md) | Deep-dive local setup and troubleshooting |
