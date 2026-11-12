# Roadmap

Honest, best-effort intentions — not commitments. Anything here may change.

Priorities derive from `docs/PRODUCT_AUDIT.md` (2026-10-27, HEAD `ef47115`)
and `docs/SHOPIFY_PARITY_MATRIX.md`. Every task lists scope, dependencies,
risks, acceptance criteria and tests. A task is done when its acceptance
criteria are **executed**, not when code exists.

---

## P0 — Security, transaction correctness, data integrity, release blockers

### P0-1 Guard the non-idempotent initial seed
- **Scope:** Make `apps/backend/src/migration-scripts/initial-data-seed.ts` detect an already-seeded database (store/region/product handle exists) and no-op with a clear message instead of duplicating; keep first-run behaviour identical. Do not rewrite the seed wholesale.
- **Dependencies:** none (Medusa workflows already used).
- **Risks:** false-positive skip on a legitimately empty DB; false-negative duplicate on a partially seeded one.
- **Acceptance:** Running `medusa db:migrate` twice against the same isolated DB leaves row counts (stores, regions, products, shipping options) identical between run 1 and run 2.
- **Tests:** integration test against an isolated `openshop_p0_*` DB asserting counts after double migration; regression test for the "empty DB still seeds" path.

### P0-2 Make test-payment mode unmistakable
- **Scope:** The "For testing purposes only" indicator must render whenever the active provider is `pp_system_default`, not only when `NODE_ENV === "development"` (`payment-container/index.tsx:28`); surface a build/startup warning when serving checkout with only the test provider outside development.
- **Dependencies:** none.
- **Risks:** visual noise in dev; false alarm if a real provider is later added (label must be provider-driven, not env-driven).
- **Acceptance:** A production-mode build of the storefront still shows the test-mode badge while `pp_system_default` is the session provider; adding a real provider removes it.
- **Tests:** unit test over the badge predicate (provider-based), storefront vitest.

### P0-3 Redact secrets from logs and errors
- **Scope:** Stop logging full response headers in `apps/storefront/src/lib/util/medusa-error.ts:16-19`; add a small shared redaction helper (cookie/set-cookie/authorization/api-key patterns) used by storefront error paths; review `next.config.js` `logging.fetches.fullUrl`.
- **Dependencies:** none.
- **Risks:** over-redaction hiding useful debugging info.
- **Acceptance:** A simulated failing API call logs no `set-cookie`/`authorization` values; helper unit tests cover each pattern.
- **Tests:** vitest unit tests for the redaction helper (added to existing storefront suite).

### P0-4 Backend env validation at startup
- **Scope:** Validate `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `STORE_CORS`, `ADMIN_CORS` presence/format in `medusa-config.ts` (zod is already transitively available or add explicitly), failing fast with a message naming the variable — without printing values.
- **Dependencies:** none.
- **Risks:** breaking legitimate dev flows that rely on framework fallbacks; must not log secret values in errors.
- **Acceptance:** Missing `JWT_SECRET` in production mode exits with a named-variable error; dev keeps a documented safe path.
- **Tests:** unit tests over the validation function (first backend unit tests — see P0-5).

### P0-5 Repair the backend test harness
- **Scope:** Replace POSIX `VAR=value` test scripts with a cross-platform runner; wire a backend `test` script into turbo so root `pnpm run test` actually runs backend tests; ensure `test:unit` matches at least the tests added by P0-3/P0-4.
- **Dependencies:** P0-3/P0-4 supply the first test files.
- **Risks:** CI time increase; jest/ESM friction under Medusa v2.
- **Acceptance:** `pnpm run test` on Windows executes ≥ the new backend unit tests and exits 0; CI runs it.
- **Tests:** the harness itself is the test; CI job updated.

### P0-6 Triage the 20 high production-chain advisories
- **Scope:** For each `pnpm audit --prod` high: classify (runtime-exposed vs build-only) and either pin an override, or document "requires Medusa upgrade" with an issue link. Fix README's now-inaccurate claim that remaining findings sit in dev/build tooling.
- **Dependencies:** none; a Medusa minor upgrade may resolve clusters (coordinate with P1-6).
- **Risks:** dependency overrides breaking Medusa internals — mitigated by full CI run after each override.
- **Acceptance:** Every high-severity advisory is either removed or individually documented with exposure analysis in `docs/`.
- **Tests:** existing CI (lint/tsc/build/tests) must stay green after lockfile-affecting changes; audit output recorded.

---

## P1 — Core merchant workflows and clean installation

### P1-1 Order-lifecycle integration suite
- **Scope:** DB-backed tests covering: cart → checkout (test provider) → order persisted → inventory decremented → cancel → inventory restored → refund state transition. Run in CI with a PostgreSQL service container.
- **Dependencies:** P0-1 (deterministic seed), P0-5 (harness).
- **Risks:** CI flakiness, migration time; must use a throwaway DB name and never a developer database.
- **Acceptance:** CI job green with a real PostgreSQL; suite fails if inventory decrement regresses.
- **Tests:** this task *is* the test; add `integration-tests/http/*.spec.ts`.
- **Status (Stage 5):** manual evidence exists (journey: reserve on order → cancel → release, `docs/STAGE5_JOURNEY.md` §3) but no automated suite yet — this item stays open.

### P1-2 Clean-checkout install verification
- **Scope:** Script (or documented checklist) that takes a fresh clone → install → env → migrate → seed → admin → start on a clean machine/OS, exercised on Windows and Linux (CI).
- **Dependencies:** P0-1.
- **Risks:** drift between script and docs.
- **Acceptance:** Documented commands executed verbatim produce a running stack; Stage-5 journey record serves as evidence.
- **Tests:** smoke script asserting `/health` 200 + storefront 200.
- **Status (Stage 5):** partial — Windows clean-copy path executed (`pnpm install --frozen-lockfile` exit 0 → migrate/seed → start → journey, `docs/STAGE5_JOURNEY.md`); the Linux/CI half and a repeatable script are still open.

### P1-3 Rate limiting on sensitive endpoints
- **Scope:** Add request throttling for auth-facing store/admin endpoints (login, register, verification) — in-process limiter first, documented as insufficient behind a shared proxy.
- **Dependencies:** none.
- **Risks:** false positives behind reverse proxies; memory use.
- **Acceptance:** >N requests/minute to login returns 429; normal browsing unaffected.
- **Tests:** integration test asserting 429 after the configured burst.

### P1-4 Notification/email provider (optional, documented)
- **Scope:** Configure Medusa's notification module with a **dev default** (local file/SMTP sink) so verification and order emails have a deliverable path; document optional production providers (Resend/SendGrid/Postmark) as opt-in.
- **Dependencies:** must not become a mandatory paid dependency (project rule 8).
- **Risks:** provider lock-in if documented carelessly.
- **Acceptance:** Register a customer in local dev → a verification email object exists in the dev sink; order placement emits an order-confirmation notification event.
- **Tests:** integration test asserting the notification record/event, provider-agnostic.

### P1-5 Outbound webhooks with signature verification
- **Scope:** Order/product webhook subscriptions to a configured URL, HMAC-signed, with a documented verification recipe and replay protection.
- **Dependencies:** Medusa event bus [FRAMEWORK].
- **Risks:** secret handling, retry semantics.
- **Acceptance:** A local receiver accepts a valid signature and rejects a tampered body (401) — executed test.
- **Tests:** integration test generating, signing, and verifying payloads.

### P1-6 Enable RBAC policies
- **Scope:** Configure Medusa's permission checks for a minimal second role (read-only orders) and document how to define more; admin UI for roles already ships.
- **Dependencies:** Medusa RBAC [FRAMEWORK].
- **Risks:** locking merchants out of their own store — ship a documented recovery path.
- **Acceptance:** Limited-role token receives 403 on an order-write request; full admin 200.
- **Tests:** integration test over both tokens.

### P1-7 SEO basics: sitemap + robots
- **Scope:** Add `app/sitemap.ts` and `app/robots.ts` (or static files), delete or fix the dead `next-sitemap.js` config, ensure product URLs are included.
- **Dependencies:** none.
- **Risks:** sitemap listing unpublished/draft URLs — filter by published status.
- **Acceptance:** `/sitemap.xml` and `/robots.txt` return 200; sampled product URLs in sitemap return 200.
- **Tests:** storefront unit test over URL generation + manual curl recorded.

### P1-8 Documentation-command audit
- **Scope:** Fix `AGENTS.md`'s `backend:seed` claim (script is a no-op), verify every command in README/CONTRIBUTING/AGENTS executes as written; document the `pnpm.overrides` warning.
- **Dependencies:** none.
- **Risks:** none material.
- **Acceptance:** Each documented command run in the sprint record with its real exit code.
- **Tests:** manual command table in sprint report; optionally a docs-lint script later.

### P1-9 Seed default tax rates
- **Scope:** Stage 5 found `tax_rate` empty while 7 tax regions exist — checkout therefore writes **no tax lines** (`tax_total = 0`) and the taxed path never runs. Seed a sensible default rate for the seeded regions (configurable, documented as placeholder — not tax advice) so orders produce real tax lines.
- **Dependencies:** P0-1.
- **Risks:** wrong rates presented as real — must be labelled placeholder and overridable per region.
- **Acceptance:** order placement in an isolated DB yields ≥1 `order_line_item_tax_line` row and `tax_total > 0`; documented how a merchant changes it.
- **Tests:** extend the Stage-5 journey DB assertions (tax-line count) + unit test over the seed.

### P1-10 Surface `db:migrate` script-runner failures
- **Scope:** `@medusajs/cli` `commands/db/migrate.js` discards the `db:migrate:scripts` child exit code (Stage 5 observed a printed `Failed to load migration script …` stack with exit 0), so a broken seed looks green. Add a repo-side post-migration check (e.g. fail if any `script_migrations` row lacks `finished_at`, or a wrapper that scans runner output) and file the issue upstream.
- **Dependencies:** none (works regardless of upstream fix).
- **Risks:** false failures on legitimately skipped scripts — assert only on `finished_at IS NULL` rows.
- **Acceptance:** induced seed failure → `db:migrate` path exits non-zero in an isolated DB; clean run stays exit 0.
- **Tests:** integration test with a deliberately broken throwaway script.

---

## P2 — Storefront editing, themes, merchant usability, migration

- **P2-1 Content as data:** hero/campaign/footer copy served from DB (Medusa custom model or file-backed), editable by merchant; acceptance: edit → reload → new copy, no source change; test: integration + storefront fetch unit test.
- **P2-2 Product import (CSV):** map Shopify-export CSV columns → Medusa product import with dry-run mode; acceptance: import a 20-product fixture into an isolated DB with zero manual edits; test: fixture-driven integration test; document limitations (metafields, images hosting) explicitly.
- **P2-3 Verified export flow:** exercise admin CSV exports, document actual column sets and caveats; acceptance: export → row counts match DB. *(Stage 5 partial: POST export → 202 → CSV downloads verified — orders 0 rows with 0 orders, products 440 rows = 440 variants; column-set documentation still open.)*
- **P2-4 Theme/light-dark + typography tokens:** document the theming surface (CSS variables/Tailwind tokens) so a second theme is a token swap; acceptance: a documented token change restyles ≥3 key pages; test: none automatable — visual checklist.
- **P2-5 Merchant usability pass:** onboarding checklist widget in admin (missing-env hints, "you are on test payments" banner linking to P0-2); acceptance: fresh install shows checklist until all steps pass.
- **P2-6 Search route:** dedicated storefront search page backed by the seeded index (ROADMAP "later" item); acceptance: query → results with facets; test: integration over `/store/search`.
- **P2-7 Accessibility pass:** automated axe run over home/PDP/cart/checkout in CI (non-blocking first), fix critical/serious issues; acceptance: zero critical violations; test: axe CI step.

## P3 — Plugin ecosystem, integrations, API stability, contributor experience

- **P3-1 Extension cookbook:** one worked example each of custom module, workflow, subscriber, admin widget, storefront block — shipped in-repo as templates with tests; acceptance: a contributor can copy an example and pass CI.
- **P3-2 API stability policy + versioning:** document which routes are public API, deprecation process; acceptance: `docs/API_STABILITY.md` with explicit support window.
- **P3-3 Webhook + integration certification checklist:** for each optional integration (Stripe, mail, analytics) a documented "works-with-OpenShop" verification list; acceptance: each entry has an executed checklist on record.
- **P3-4 Release process:** semver, changelog, tagged releases, CI-gated publish checklist; acceptance: first tagged release cut with changelog covering `ef47115..tag`.
- **P3-5 E2E in CI:** headless Playwright journey against ephemeral stack + throwaway DB (adapt `tests/e2e/e2e-journey.py`); acceptance: CI job green and proven to fail on induced breakage.
- **P3-6 ESLint migration off `next lint`** before Next 16 (carried from old roadmap); acceptance: lint runs via ESLint CLI in CI green.

## P4 — B2B, subscriptions, multi-store, POS, advanced capabilities

Per project rule: **design documents + acceptance tests first, no stubs.**

- **P4-1 B2B design doc:** company accounts, contract price lists, payment terms — scoped against Medusa's capabilities; acceptance: reviewed design with acceptance-test list, no code yet.
- **P4-2 Subscriptions design doc:** selling plans, dunning, test-provider-safe billing simulation; acceptance: same.
- **P4-3 Digital products:** download delivery with signed expiring URLs; acceptance: implemented flow + test issuing and expiring a link.
- **P4-4 Multi-store/multi-region expansion:** second region with its own currency and catalog; acceptance: both regions transact in integration tests.
- **P4-5 POS/retail:** only after a real integrator exists; otherwise documented as out of scope.

---

## Carried over from the previous roadmap (still valid)

- Fix `test:unit` on Windows → now **P0-5**.
- Migrate `next lint` → **P3-6**.
- Two `react-hooks/exhaustive-deps` warnings → fold into **P2-7**.
- Reduce dependency advisories → **P0-6**.
- `loading.tsx` for main/checkout route groups → **P2** polish.
- Optional real payment provider → after **P0-2**; stays optional, never mandatory.
- Headless E2E in CI → **P3-5**.
- Deployment/hardening guide → **P3** (with backup drill from P2-3/P3-4).

## Out of scope

- Shopify feature/parity claims or any affiliation (the parity matrix is a
  comparison target only).
- Multi-tenant SaaS features.
- Replacing the Medusa engine.
- Mandatory paid/hosted services of any kind.
