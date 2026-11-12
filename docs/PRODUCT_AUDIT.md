# OpenShop Product Audit

Date: 2026-10-27 · Branch `main` · HEAD `ef47115` ("fix: harden first-run setup and add release quality gates") · working tree clean (0 changes) before this sprint's edits.

**Method.** Every claim below is labelled by evidence type:

- **[RUN]** — a command was executed in this environment and its exit code recorded.
- **[SRC]** — verified by reading repository source (path + line cited).
- **[FRAMEWORK]** — behaviour comes from Medusa framework code in `node_modules`, not from this repository; cited as such.
- **[DOC]** — stated in repository documentation only, not independently executed here.
- **[NOT RUN]** — not executed this sprint; status unknown, explicitly not claimed.

Nothing is called "complete" because a route or UI component exists.

---

## 1. Checks executed this session [RUN]

| # | Check | Command | Result | Exit |
| --- | --- | --- | --- | --- |
| 1 | Lint (both workspaces) | `pnpm run lint` | backend: "No lint issues found"; storefront: clean (`next lint` passes) | **0** |
| 2 | Backend type-check | `tsc --noEmit` (apps/backend) | no errors | **0** |
| 3 | Storefront type-check | `tsc --noEmit` (apps/storefront) | no errors | **0** |
| 4 | Unit tests (Stage-1 baseline) | `pnpm run test` | storefront vitest **18/18** (2 files); backend had no test files then — see rows 7–9 for the final numbers | **0** |
| 5 | Production build | `pnpm run build` | backend build 23.2 s, storefront build 60.3 s, both "completed successfully" | **0** |
| 6 | Production dependency audit | `pnpm audit --prod` | **36 findings: 0 critical, 20 high, 14 moderate, 2 low** | **1** |
| 7 | Post-fix battery (modified tree) | `pnpm run lint`, `tsc --noEmit` ×2, `pnpm run test`, `pnpm run build` | lint 0 (2 pre-existing `exhaustive-deps` warnings), tsc 0/0, **vitest 43/43 (4 files) + jest 17/17 (2 suites)**, build success | **0** |
| 8 | Clean-copy install (Stage 5) | `pnpm install --frozen-lockfile` on a fresh tree copy | exit 0 in 52.4 s — lockfile installs unmodified | **0** |
| 9 | Merchant journey (Stage 5) | `python tests/e2e/e2e-journey.py` against isolated DB `openshop_sprint5` | exit 0, order confirmed end-to-end; DB/cancel/secret-scan evidence in `docs/STAGE5_JOURNEY.md` | **0** |

Notes:

- Check 4 is the Stage-1 baseline. Check 7 is the authoritative post-fix result: `pnpm run test` runs storefront vitest **43/43 across 4 files** (checkout 5, redact 22, variant 13, payment-badge 3) plus backend jest **17/17 across 2 suites** (seed guard 7, env validation 10) — root task exit 0, re-confirmed 2026-10-28.
- Check 6 exit code 1 is expected behaviour for a non-empty audit; CI runs it as `continue-on-error` [SRC `.github/workflows/ci.yml:76-78`].
- The prior sprint (2026-10-24) recorded 31 findings (1 low / 14 moderate / 16 high). Today: 36 (2 / 14 / 20). The delta is new advisories in the same dependency tree — see §5.4.
- CI on GitHub: last full ubuntu run green on `ef47115` (frozen-lockfile install → lint → tsc ×2 → vitest → build → informational audit) [DOC — prior sprint record]; this sprint adds a backend unit-test step to `ci.yml` but is uncommitted, so CI has not run it yet.

---

## 2. Feature matrix

Legend: **V** = implemented and verified this sprint (run or executed flow) · **S** = implemented, verified in source only (not executed end-to-end here) · **P** = partial · **M** = missing · **X** = blocked by an external provider/credential.

| Area | Status | Evidence |
| --- | --- | --- |
| Product catalogue (products, collections, categories, tags, options/variants) | **S** | Seeded by `src/migration-scripts/initial-data-seed.ts` (4 starter products) + `src/scripts/seed-demo-products.ts` (rerun-safe, deterministic handles, skip-if-exists [SRC L228-248]); admin CRUD comes from stock Medusa dashboard [FRAMEWORK] |
| Pricing / price lists | **P** | Core prices work; no promo/discount engine configured in repo (no price-list/promotion seeds) [SRC]; `pnpm run lint` emits 12 `@medusajs/prices-in-major-units` warnings where seed literals look like minor units [RUN] |
| Promotions / discounts / gift cards | **M** | No promotion code anywhere in `apps/` [SRC] (Medusa ships the module; not configured or seeded) |
| Cart | **S** | Storefront cart flows `src/lib/data/cart.ts`; unit tests cover variant/stock/checkout-step helpers only [SRC, RUN] |
| Multi-step checkout (address → delivery → payment → review) | **S** | Route group `src/app/[countryCode]/(checkout)/`; `getCheckoutStep` covered by 5 unit tests [RUN]; E2E script exercises full flow but is **[NOT RUN]** this sprint |
| Payments (real) | **X / M** | Only `pp_system_default` (manual test provider) seeded (`initial-data-seed.ts:106`) [SRC]; no Stripe/PayPal module config (`medusa-config.ts` has no `modules` block) [SRC]; storefront Stripe wrapper is inert unless keys set (`payment-wrapper/index.tsx:14-45`) [SRC] |
| Payments (test mode made unmistakable) | **P** | The "For testing purposes only" badge renders only when `NODE_ENV === "development"` (`payment-container/index.tsx:28`) [SRC] → **a production build shows an ordinary "Manual Payment" option with no test-mode warning** |
| Refunds / cancellations / capture | **S [FRAMEWORK]** | Provided by Medusa admin routes (`orders/[id]/cancel`, `payments/[id]/capture|refund`) [FRAMEWORK]; no repo-level code and **no tests** [SRC] |
| Orders (admin workflow) | **S [FRAMEWORK]** | Stock dashboard [FRAMEWORK]; storefront places orders via `lib/data/cart.ts:393 placeOrder()` [SRC]; persistence not re-verified this sprint **[NOT RUN]** |
| Inventory (stock levels, out-of-stock) | **S** | `seed-demo-inventory-levels.ts` idempotent (create-missing/update-differs, exit codes documented) [SRC]; `isVariantInStock` unit-tested (6 tests) [RUN] |
| Inventory reservations / stock movements | **M** | No repo code [SRC]; only stock dashboard internals [FRAMEWORK] |
| Shipping options / fulfillment | **S** | Seeded: 1 stock location, fulfillment set, 2 shipping options (`initial-data-seed.ts`) [SRC]; exercised only at seed level, not through checkout this sprint **[NOT RUN]** |
| Tax | **S** | `createTaxRegionsWorkflow` on seed [SRC]; tax calculation happens inside Medusa order flows [FRAMEWORK]; no repo-level tax tests [SRC] |
| Customer accounts (register/login/verify/addresses) | **S** | `src/lib/data/customer.ts` (register, login, email verification request/confirm, address CRUD) [SRC]; not executed this sprint **[NOT RUN]** |
| Transactional email / notifications | **X** | No notification module configured, no SENDGRID/mail env anywhere in `apps/` [SRC] — verification and order emails are *requested* in code but **nothing delivers them** without adding a provider |
| Guest checkout | **S** | E2E script's verified path per README [DOC]; **[NOT RUN]** this sprint |
| Search (store facets) | **P** | `POST /store/search` configured via `middlewares.ts` [SRC]; index seeded on boot; README: no dedicated storefront search route [DOC] |
| SEO metadata | **P** | `generateMetadata` on 4 page types + static metadata on ~15 pages + OG/twitter images [SRC] |
| SEO sitemap/robots | **M** | No `sitemap.*`/`robots.*` route, no `public/robots.txt` [SRC]; `next-sitemap.js` exists but the `next-sitemap` package is in no `package.json` and no script calls it — dead config, also has an array-concat bug (`exclude: excludedPaths + ["/[sitemap]"]`) [SRC] |
| Analytics / marketing | **M** | No analytics integration; `instrumentation.ts` OpenTelemetry fully commented out [SRC] |
| Content / theme management (CMS) | **M** | No CMS dependency; homepage content hardcoded (`modules/home/components/hero/index.tsx`) [SRC]; listed as future work in `ROADMAP.md:22` [DOC] |
| Staff roles / permissions (RBAC) | **M** | No `role|permission|rbac` code in `apps/` [SRC]; Medusa ships `rbac/roles*` endpoints and a `check-permissions` middleware — **unused** [FRAMEWORK] |
| Multi-region / multi-currency / sales channels | **S** | Seeded 1 region (7 EU countries), 1 sales channel, publishable key [SRC]; multi-currency not configured |
| Import / export data | **P** | No repo export code [SRC]; Medusa admin ships CSV export for orders/products/inventory-items [FRAMEWORK] — **[RUN] Stage 5**: `POST /admin/orders/export` + `/admin/products/export` → 202 async workflow → CSV via `local` notification provider; products CSV 443,047 bytes / 441 rows verified, orders CSV 0 bytes (0 orders) — **no import tooling at all** |
| Backup / restore | **M** | No tooling, no docs [SRC] |
| API (store/admin) surface | **P** | Only two stub routes exist: `GET /admin/custom`, `GET /store/custom` (`res.sendStatus(200)`) plus search middleware [SRC]; everything else is Medusa's built-in API [FRAMEWORK] |
| Webhooks (outbound) | **M** | No webhook routes, no signature verification, no webhook env vars in repo [SRC]; Medusa's generic inbound payment hook exists but no provider consumes it [FRAMEWORK] |
| Plugin / module extensibility | **P** | File-based routing + workflow conventions documented in `src/api/README.md` etc. [SRC]; `src/modules/`, `src/workflows/`, `src/subscribers/`, `src/jobs/`, `src/links/` contain **README.md only** — zero custom modules |
| Admin customisations | **M** | `src/admin/` has README, tsconfig, and an empty `i18n/index.ts` (`export default {}`) — no widgets/routes/pages [SRC] |
| B2B / subscriptions / digital products / POS | **M** | Nothing in repo [SRC] |
| Local dev experience | **V** | `scripts/local-dev.ps1 start|status|stop` rerun-safe (port-based skip, exit 0/1) [SRC]; `docs/local-development.md` + troubleshooting [SRC] |
| E2E journey script | **S** | `tests/e2e/e2e-journey.py` exists (Playwright, exit 0/1) [SRC]; **[RUN] Stage 5** — exit 0 on isolated DB, one pending order placed and canceled; full record in `docs/STAGE5_JOURNEY.md` |

---

## 3. Clean-install and upgrade findings

- **Clean install (Linux/CI):** frozen-lockfile install succeeds on ubuntu in CI [DOC/CI run green on `ef47115`].
- **Clean install (this machine):** node_modules already present from the prior sprint's `pnpm install` (pnpm 10.11.1 pin honoured; global pnpm 11.8.0 emits a harmless `pnpm.overrides` warning on every command) [RUN]. The from-scratch copy install was executed in Stage 5: `pnpm install --frozen-lockfile` → **exit 0** (52.4 s) on a clean tree copy, proving the lockfile installs without modification [RUN].
- **Requirements drift:** README requires Node ≥ 22.22.0 and pnpm 10.11.1; environment runs Node v24.17.0 with all checks green [RUN] — works, but the documented floor is untested below 22.
- **First-run correctness:** `medusa db:migrate` runs
  `src/migration-scripts/initial-data-seed.ts` through Medusa's migration-script
  runner, which records finished scripts in a `script_migrations` table and
  skips them on later runs [FRAMEWORK `commands/db/migrate.js`, `run-scripts.js`,
  `migrations/run-migration-scripts.js`] — so a routine re-migration does **not**
  duplicate data. The seed itself is still non-idempotent, and two paths bypass
  that bookkeeping: manual execution (`medusa exec`), and a run that crashed
  mid-script (records without `finished_at` are deliberately retried)
  [FRAMEWORK]. Docs warn about the manual path [DOC]; no code guard existed
  before this sprint (fixed in Stage 4, see §10).
- **`db:migrate` swallows the seed-runner's exit code [RUN/SRC].** In
  `@medusajs/cli` `commands/db/migrate.js`, the `db:migrate:scripts` child
  process result is not checked (unlike the adjacent `db:migrate:search` path,
  which does propagate failures). Observed live in Stage 5: run 1 printed
  `Failed to load migration script … No default export found` plus a stack
  trace, yet the command exited **0**. A broken or half-failed seed can
  therefore look successful to CI and to operators — only the log text reveals
  it. Upstream Medusa issue material; recorded as roadmap item **P1-10**.
- **Upgrade path: effectively none documented.** `.github/workflows/update.yaml` is a manual `workflow_dispatch` running `medusajs/medusa-update-action@v1` with an `ANTHROPIC_API_KEY` secret [SRC] — no versioning policy, no changelog, no upgrade guide, no migration-review process. Medusa is pinned at 2.21.2, Next at 15.5.28 [RUN].
- **Version pinning:** lockfile present and used with `--frozen-lockfile` in CI [SRC]; overrides live in `pnpm-workspace.yaml` (sharp, proxy-addr) while `package.json#pnpm.overrides` is dead and warns [SRC/README].

## 4. Payment, tax, shipping, inventory and order-lifecycle findings

1. **Payment is test-only by design** — `pp_system_default` is the single seeded provider (`initial-data-seed.ts:106`) [SRC]; README states no real payment processing [DOC]. Correct and documented, **but** the visual "For testing purposes only" badge disappears outside development builds (`payment-container/index.tsx:28`) [SRC] — a production deployment would show an unmarked manual payment option. See ranked issue **H2**.
2. **Tax and shipping configuration exist at seed level** (tax regions for 7 countries, 2 shipping options) [SRC]; **[RUN] Stage 5** executed both through checkout on an isolated DB: both shipping options were offered, `Standard Shipping` (10) was written to the order, totals reconciled (40 + 10 = 50). **Tax produced 0 lines — finding:** `tax_rate` table is completely empty (7 tax regions exist but no rates), so `tax_total = 0` by construction and the taxed code path never executes. Shopify applies tax by default → real parity/data gap, roadmap **P1-9**. Full record: `docs/STAGE5_JOURNEY.md`.
3. **Inventory:** seeded levels are idempotent and verified by `verify-local-state.ts` (read-only, exit 1 on invariant failure) [SRC]. No reservation/movement layer in repo code. **[RUN] Stage 5** observed the framework layer working: order placement created a `reservation_item` (qty 1) on exactly the ordered variant (`reserved=1`, 11 siblings untouched); admin cancel soft-deleted the reservation and restored `reserved=0`.
4. **Order lifecycle:** creation is repo code (`placeOrder`); every transition (cancel/refund/capture/fulfill) is stock Medusa [FRAMEWORK]. **[RUN] Stage 5** verified `cancel` end-to-end (200 → `status=canceled`, `canceled_at` set, inventory released); capture/refund/fulfill remain **[NOT RUN]** (reasons in `docs/STAGE5_JOURNEY.md` §7). **Zero backend automated tests** cover any transition [SRC] — roadmap P1-1.
5. **Seed safety split:** `seed-demo-products.ts` and `seed-demo-inventory-levels.ts` are rerun-safe with deterministic behaviour [SRC]; `initial-data-seed.ts` is not and runs during migration — the single biggest data-integrity hazard in the repo (issue **H1**).

## 5. Security and privacy findings

### 5.1 Data integrity (rated here because migration+seed runs on every install)

`initial-data-seed.ts` (839 lines) creates sales channels, API keys, stores, regions, tax regions, stock locations, shipping options, 4 fixed-handle products and inventory levels with **no existence checks inside the script** [SRC]. Two execution paths matter:

- **Via `medusa db:migrate` (the normal path):** Medusa's migration-script runner records completion in `script_migrations` and skips finished scripts, with advisory locking [FRAMEWORK] — safe against routine re-migration.
- **Manual or interrupted runs:** `medusa exec ./src/migration-scripts/initial-data-seed.ts` bypasses that bookkeeping entirely, and a crashed run (no `finished_at`) is retried from the top — in both cases the script would recreate stores/regions/products it already created [FRAMEWORK/SRC]. Only documentation warned about this before this sprint; a code guard was absent (added in Stage 4 — see §10).

### 5.2 Authentication / authorization

- Custom admin route `GET /admin/custom` has **no authorization code in the repo** [SRC]. It is nonetheless protected by framework defaults: Medusa authenticates every route file unless it exports `AUTHENTICATE = false`, and `/admin/*` requires user auth (bearer/session/api-key) with no anonymous option [FRAMEWORK `routes-loader.js:197-199`, `router.js:89-93`].
- Store routes require a valid `x-publishable-api-key` and allow unauthenticated customers [FRAMEWORK `ensure-publishable-api-key.js`].
- **No permission/policy checks are used** — Medusa's `wrapWithPoliciesCheck` exists but is opt-in and unused [FRAMEWORK/SRC]. Any authenticated admin identity can hit every admin route equally. No staff/roles usage.
- Repo `middlewares.ts` contains only search configuration — no auth middleware of its own [SRC].
- **[RUN] Stage 5 verified the boundary in both directions:** anonymous `GET /admin/custom` → 401; same route with a Bearer token → 200; store routes 200 only with a valid publishable key (bogus key → 400). **Endpoint gotcha:** in Medusa 2.21 the working login is `POST /auth/user/emailpass` (returns `{token}`); `POST /admin/auth` is a different session route that always answers `{"message":"Unauthorized"}` — do not misread it as a credential bug [RUN/SRC `api/auth/[actor_type]/[auth_provider]/route.js`].

### 5.3 Secrets and logging

- `apps/backend/.env.template` ships `JWT_SECRET=supersecret` / `COOKIE_SECRET=supersecret` defaults [SRC]; framework warns and falls back to `supersecret` in dev, throws in production [FRAMEWORK `config.js:79-92`].
- **Storefront error handler logs full response headers** — `src/lib/util/medusa-error.ts:16-19` `console.error("Headers:", err.response.headers)` on every failed API call; headers can include `set-cookie` [SRC].
- `next.config.js` enables `logging.fetches.fullUrl: true` — full URLs incl. query strings in server logs [SRC].
- **No secret-redaction helper exists anywhere** in either app (grep `redact|mask|sanitize` → no matches) [SRC].
- **No rate limiting** — none in repo code and none in the Medusa HTTP stack [SRC/FRAMEWORK].
- Webhooks: none configured, therefore **no signature verification exists** — and none is currently needed until an outbound webhook provider is added [SRC].
- `.env` / `.env.local` / `.local-logs` correctly git-ignored (`git check-ignore` verified) [RUN]; no secrets, DBs, or logs tracked (0 suspicious tracked files) [RUN].

### 5.4 Dependency vulnerabilities

`pnpm audit --prod` → **36 (0 critical / 20 high / 14 moderate / 2 low)**, exit 1 [RUN]. High-severity runtime-chain examples: `lodash` (code injection via `_.template`), `follow-redirects` (credential-header exposure), `body-parser` / `multer` / `compression` / `qs` (DoS), `zod` (memory exhaustion), `@grpc/grpc-js` (authz bypass in certain configs), `postcss`/`source-map-js`/`brace-expansion` (DoS, mostly build-chain). **README's claim that "the rest sit in dev/build tooling" is no longer accurate** — several highs are production runtime libraries (issue **M4**). All are transitive via `@medusajs/*`; none has a non-invasive fix without a Medusa upgrade, so the realistic remedy is a pinned Medusa minor upgrade + overrides review.

## 6. Performance, accessibility, SEO, i18n, mobile

- **Performance [NOT RUN]:** no Lighthouse/timing measurements taken this sprint; production build completes (23 s backend / 60 s storefront) [RUN]. No claims made.
- **Accessibility [NOT RUN as an audit]:** no automated a11y scan executed. `ROADMAP.md` already carries an accessibility pass as planned work [DOC].
- **SEO [SRC]:** per-page metadata present (§2); sitemap/robots absent and the `next-sitemap` config is dead code; `metadataBase` falls back to `https://localhost:8000` when unset (`lib/util/env.ts:2`) [SRC].
- **i18n [SRC]:** country/region routing via `[countryCode]` + middleware (URL → cf → header → default `dk`), locale header plumbing, country/language selectors. No translated UI strings, no i18n library, admin i18n stub is empty `export {}`.
- **Mobile [NOT RUN]:** no device/emulation testing this sprint; storefront is Tailwind responsive by construction but unverified here.

## 7. Backup, restoration, migration, data export, operational readiness

| Capability | Status | Evidence |
| --- | --- | --- |
| Backup tooling/docs | **M** | none in repo [SRC] |
| Restore procedure | **M** | none [SRC] |
| Data export | **P** | framework CSV endpoints exist (orders/products/inventory) [FRAMEWORK]; **[RUN] Stage 5**: POST `/admin/{orders,products}/export` → 202 async → CSVs via `local` notification provider; products CSV 443,047 bytes, 441 rows incl. header (= 440 data rows, matching the 440 seeded variants); no repo-level export code |
| Data import / migration from Shopify etc. | **M** | no importer, no migration guide [SRC] |
| Upgrade guide / changelog / versioning | **M** | none; only a manual update workflow [SRC] |
| Production hardening guide | **M** | README explicitly says "Not provided" [DOC] |
| Observability | **M** | OpenTelemetry commented out [SRC] |
| Health check | **V** | `GET /health` → 200 [RUN] Stage 5 (and prior verified runs) |

## 8. Developer experience, extensibility, contribution barriers

**Strengths [SRC/RUN]:** `docs/local-development.md` is detailed with troubleshooting; `scripts/local-dev.ps1` is rerun-safe; CONTRIBUTING.md, SECURITY.md, issue/PR templates present [RUN `git ls-files`]; CI blocks on lint/tsc/build [SRC]; `AGENTS.md` documents conventions; clear attribution and MIT license [SRC].

**Barriers:**

1. Backend test harness was broken/empty: `test:unit` used POSIX `VAR=value` syntax (fails on Windows) and matched **zero files** [SRC — also documented in README known issues]. **Fixed in Stage 4** (`scripts/run-jest.js`, 17 tests now run in CI).
2. Root `pnpm backend:seed` was a **no-op** — turbo declares the task, `apps/backend/package.json` had no `seed` script — yet `AGENTS.md` documented it as "seeds initial data" [SRC]. Documentation/command mismatch (issue **M12**). **Fixed in Stage 4** — real rerun-safe `seed` script + AGENTS.md corrected.
3. No example of a custom module/workflow/subscriber — every extension directory is README-only, so contributors have no in-repo pattern to copy [SRC].
4. `next.config.js` ignores TS and ESLint errors during builds [SRC]; mitigated by CI running both separately [SRC], but local `next build` gives false confidence.
5. pnpm 10 warning on `package.json#pnpm.overrides` on every command (cosmetic, documented) [RUN].

## 9. CI coverage and missing tests

**What CI runs [SRC `.github/workflows/ci.yml`]:** frozen-lockfile install → `pnpm run lint` → `tsc --noEmit` ×2 → storefront vitest → **backend jest unit tests (step added this sprint, uncommitted)** → `pnpm run build` → informational `pnpm audit --prod`. One job, ubuntu, 30-min timeout.

**What CI does not run (self-documented in `ci.yml:4-8`):** any PostgreSQL service, DB integration suites (`test:integration:http` has no spec files anyway), the E2E journey, any runtime/HTTP smoke test.

**Test inventory:** storefront **4 files / 43 assertions** (18 pre-existing: checkout-step derivation + variant keying/lookup/stock; 25 added this sprint: redaction 22 incl. the raw-header-leak regression, payment badge 3) [RUN]. Backend **2 suites / 17 assertions**, both added this sprint (seed guard 7, env validation 10) [RUN]. All green via root `pnpm run test` (exit 0). Integration-tests directory contains only a 3-line `setup.js` [SRC]. Still no tests for: routes, auth, middleware, order lifecycle, payment, refunds, search index, export (DB-backed suites = P1-1).

## 10. Highest-impact problems, ranked

| # | Sev | Problem | User impact | Evidence |
| --- | --- | --- | --- | --- |
| **H1** | **High** | Non-idempotent `initial-data-seed.ts` with no in-script guard: manual re-execution or an interrupted run (retried without `finished_at`) recreates stores/regions/products. *Routine `db:migrate` re-runs are safe — the migration-script runner tracks completion in `script_migrations` [FRAMEWORK] (corrected after framework-source verification).* | Data corruption on a common operator path (docs-only protection) | [SRC/FRAMEWORK] §5.1 |
| **H2** | **High** | Test-payment badge hidden outside development builds; production build shows unmarked "Manual Payment" as sole provider | Merchant can deploy a store that cannot take money while believing checkout works; violates "test mode impossible to mistake" | [SRC] §4 |
| **H3** | **High** | Zero backend tests; CI green without exercising a single DB-backed path | Regressions in orders/payment/auth ship undetected; "green" is weaker than it looks | [SRC/RUN] §9 |
| **M4** | **Medium-High** | 20 high-severity production-chain dependency advisories; README claim outdated | Known exploitable transitive CVEs (DoS, credential exposure) in self-hosted deployments | [RUN] §5.4 |
| **M5** | **Medium** | Storefront logs full response headers + full URLs; no redaction helper anywhere | Session cookies/tokens can leak into shared logs | [SRC] §5.3 |
| **M6** | **Medium** | No rate limiting on any endpoint (incl. auth) | Brute-force/abuse exposure for self-hosters | [SRC/FRAMEWORK] §5.3 |
| **M7** | **Medium** | Backend env vars unvalidated (silent `DATABASE_URL` default, dev fallback secrets) | Misconfiguration fails late or silently | [SRC/FRAMEWORK] §2, §5.3 |
| **M8** | **Medium** | No backup/restore, no upgrade guide, no export verification, no changelog | Operators cannot run this safely beyond a laptop | [SRC] §7 |
| **M9** | **Medium** | No notification/email provider configured; account verification and order mails are requested but undeliverable | Customer-facing flows dead-end silently | [SRC] §2 |
| **M10** | **Medium** | No RBAC usage; every authenticated admin identity has full power | Cannot safely give staff limited access | [FRAMEWORK/SRC] §5.2 |
| **M11** | **Medium** | No sitemap/robots; `next-sitemap` config dead and buggy | Stores are harder to index; misleading config | [SRC] §6 |
| **M12** | **Medium-Low** | `pnpm backend:seed` no-op while AGENTS.md documents it as seeding | New contributors follow docs and get silent nothing | [SRC] §8 |
| **L13** | **Low** | Backend `test:unit` broken on Windows + matches nothing | First contributor stumbling block | [SRC] §8 |
| **L14** | **Low** | `/store/locales` 404 from storefront; doubled/absent favicon-type metadata nits; `pnpm.overrides` warning | Cosmetic noise | [DOC/RUN] |

### Explicitly *not* problems (verified)

- Git hygiene: no secrets, DBs, logs, or artifacts tracked; ignore rules verified [RUN].
- Store/admin route authentication relies on Medusa defaults — present and correct, though undocumented in-repo [FRAMEWORK].
- Rerun-safe demo seeds and `verify-local-state.ts` show real engineering discipline around data [SRC].
- License/attribution: MIT with preserved Medusa © 2022 attribution [SRC]; no Shopify affiliation or branding claims anywhere in docs [SRC].

### Stage 4 outcomes (this sprint's fixes — tests recorded in the final report)

| Issue | Outcome |
| --- | --- |
| H1 seed re-run guard | **Fixed** — `initial-seed-guard.ts`: skip when complete, abort with counts when partial; 7 unit tests; live double-run verified during Stage 5 |
| H2 test-payment badge | **Fixed** — badge now driven by provider id, not `NODE_ENV`; 3 component tests incl. a production-mode regression case |
| H3 backend test harness | **Partially fixed** — cross-platform runner + first 17 backend unit tests wired into `pnpm run test` and CI; DB-backed order-lifecycle suites still missing (P1-1) |
| M4 dependency advisories | **Documented, not resolved** — README claim corrected with the real count; per-advisory triage assigned to P0-6 |
| M5 log redaction | **Fixed** — `redact.ts` helper applied to `medusa-error.ts`; 22 tests incl. a raw-header-leak regression test |
| M7 env validation | **Fixed** — backend `collectEnvReport` (10 tests) fails fast naming variables without values; storefront `check-env-variables.js` now also validates backend URL presence/format and publishable-key format (4 branches executed, exits 1/0/1/1) |
| M12 `backend:seed` no-op | **Fixed** — backend now has a real, rerun-safe `seed` script; AGENTS.md corrected |
| L13 `test:unit` broken on Windows | **Fixed** — `scripts/run-jest.js` sets env cross-platform; suite runs green on Windows |
| M6/M8/M9/M10/M11 | **Open** — assigned to P1 in `ROADMAP.md` |

### Stage 5 outcomes (isolated journey — full record in `docs/STAGE5_JOURNEY.md`)

| Check | Outcome |
| --- | --- |
| Merchant journey (Playwright) | **PASS** — exit 0: home → search → PDP → cart → address → delivery → payment → review → order confirmed; 13 screenshots captured |
| DB effects | **1 order row** with address, line item (40), shipping line (10), totals reconciled (50); test provider `pp_system_default` authorized 50 / captured 0 |
| Inventory | **Held then released** — reservation qty 1 on the exact ordered variant (siblings untouched); admin cancel soft-deleted it, `reserved` back to 0 |
| Tax | **Gap found** — 0 tax lines because `tax_rate` is empty → new roadmap P1-9 |
| Admin authz / CSV export | **PASS both directions** (anon 401 / Bearer 200); POST export → 202 → real CSVs (products 443 KB / 441 rows) |
| Secret leakage | **PASS** — 4 runtime logs × 7 secret classes = 28/28 searches, 0 hits |
| Payment failure, capture/refund/fulfill, E2E-in-CI | **NOT RUN** with reasons (§7 of the journey record) |

---

*Audit performed 2026-10-27 against `ef47115`; Stage 5 executed 2026-10-28 on an isolated DB. Items marked [NOT RUN] were not executed and no result is claimed for them.*
