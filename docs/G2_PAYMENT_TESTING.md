# G2 — Payment Testing Record

> **Date:** 2026-11-12 (local, Windows/PowerShell). **Environment:** Node
> v24.17.0, pnpm 10.11.1, Medusa 2.21.2 (pinned, no upgrade), PostgreSQL
> 17, jest via `scripts/run-jest.js`.
>
> **Truthfulness rules applied here:** no unexecuted test is counted as
> passing; sandbox (real-provider) results are separated from local
> results; failure evidence is preserved; no Stripe credentials exist, so
> **nothing in this document claims a real-provider transaction** (G2-G is
> BLOCKED — see `docs/G2_SANDBOX_VALIDATION.md`).

## 1. Exact commands and exit codes (all local)

| # | Command (cwd noted) | Exit | Result |
| --- | --- | --- | --- |
| 1 | `pnpm exec tsc --noEmit -p tsconfig.json` (`apps/backend`) | **0** | 0 errors |
| 2 | `pnpm run test:unit` (`apps/backend`) | **0** | **171/171**, 12 suites |
| 3 | `powershell -File %TEMP%\opencode\regression-prep.ps1` (repo root) | **0** | six suite DBs created + migrated + seeded |
| 4 | `pnpm run test:integration:http` (`apps/backend`, `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD` from `.env`, `DATABASE_URL` unset) | **0** | **47/47**, 6 suites |
| 5 | `pnpm run test:integration:migrate` (`apps/backend`, same DB_* env) | **0** | **8/8**, 2 suites |
| 6 | `pnpm run test` (`apps/storefront`) | **0** | **87/87**, 7 files |
| 7 | `pnpm run lint` (repo root, turbo → both apps) | **0** | backend 0 errors / 22 warnings (advisory), storefront 2 warnings (pre-existing) |
| 8 | `NEXT_PUBLIC_BASE_URL=https://ci-build.example pnpm run build` (`apps/storefront`) | **0** | production build complete |

**Source-tree total: 313/313** (171 unit + 87 storefront + 47 HTTP +
8 migrate) — the 219 G10-F baseline plus **94 new G2 tests**. Nothing was
skipped, disabled, or weakened to reach this number.

## 2. Suite-by-suite results

### Backend unit — 171/171 (baseline 90 → +81)

G2 additions (all credential-free, offline):

| Spec | Focus |
| --- | --- |
| `src/modules/sim-payment/__tests__/sim-webhook.unit.spec.ts` | simulator webhook verify/validate/associate/stamp/advance rules (18 tests) |
| `src/modules/sim-payment/__tests__/webhook-signature.unit.spec.ts` | HMAC sign/verify, malformed headers, replay window |
| `src/lib/__tests__/payment-webhooks.unit.spec.ts` | pipeline status mapping, verification-error mapping, guards |
| `src/lib/__tests__/payment-reconcile.unit.spec.ts` | pure classification + amount compare (integer minor units) |
| `src/modules/payment-events/__tests__/payment-events.unit.spec.ts` | journal error redaction/truncation + duplicate classification |
| `src/modules/payment-contract/__tests__/payment-contract.unit.spec.ts` | full 13-check contract vs simulator + broken-provider negatives |
| `src/modules/payment-contract/__tests__/stripe-provider.unit.spec.ts` | Stripe offline subset (identifier, validateOptions, signature failure → 400) |
| `src/config/__tests__/validate-env.unit.spec.ts` | +11 payment-config validation cases |

### HTTP integration — 47/47 (baseline 34 → +13)

Six suites, each on its own pre-created database (two-step procedure in
`docs/local-development.md`): `g2-payment` (13), `dev-payment` (9),
`order-lifecycle`, `tax-calculation`, `tax-configuration`, `rate-limit`.

`integration-tests/http/g2-payment.spec.ts` (13 tests, all passing):

1. simulator registered and offered in the store region
2. wrong-secret and missing-signature deliveries → 400, **nothing journaled**
3. signed amount mismatch → 400 before any state write; persisted amount is
   an exact integer minor-unit value
4. signed `succeeded` for a pending cart → official `processPaymentWorkflow`
   recovers the cart into an order, payment created + captured, journal
   `processed`
5. identical redelivery → 200 `{received, duplicate}`, still one order
6. in-flight event redelivery → 409, not applied, journal stays `processing`
7. stale out-of-order `processing` event → acknowledged `not_supported`,
   zero money-state change
8. `payment_failed` → journaled, no workflow, no order, no payment row
9. unknown provider path → 404
10. `/webhooks/stripe` with no credentials → 404 (provider absent from the
    module; **no simulator fallback**), nothing journaled
11. reconciliation `in_sync` — two runs, distinct `rec_*` run ids,
    identical classification, **never auto-charges**
12. provider-side capture drift → `capture_mismatch` report, repeat-safe,
    **still never auto-charges**
13. reconciling an unknown payment → 404

### Storefront — 87/87, build exit 0

Includes the `constants.tsx` change (`pp_sim-payment_default` →
"Simulated Payment (test only)", `isTestPayment` badge) with no hard-coded
Stripe dependency.

### Migrate — 8/8

`seed-exit-code.spec.ts` + `backup-restore.spec.ts` unchanged from G10-F.

## 3. Bugs found and fixed during G2 bring-up (failure evidence preserved)

The **first** `g2-payment` run failed **5/13** (exit 1). Root causes, both
fixed with regression coverage:

1. **Journal lookup query shape.** `findEvent` passed
   `listPaymentEvents({ where: {...}, take: 1 })`. Medusa list methods are
   `list(filters, config)`: a `where` wrapper and `take` inside filters
   both throw `Trying to query by not existing property PaymentEvent.where`
   / `.take`, so every journal assertion failed and the in-flight path
   answered 500 instead of 409. Fixed to
   `listPaymentEvents({ provider, event_id }, { take: 1 })`.
2. **Duplicate classification.** Medusa's DAL `dbErrorMapper` rewrites the
   raw Postgres `23505` into a `MedusaError` (type `INVALID_DATA`,
   message `Payment event with provider: ..., event_id: ...,
   already exists.`) carrying **neither `code` nor `constraint`** — so
   `isDuplicateKeyError` missed it, `reserveWebhookEvent` rethrew, and
   duplicate/in-flight deliveries answered **500** (tests 5 and 6). Fixed
   to recognize the mapped shape too; **+5 unit tests** now pin all three
   error shapes and the no-false-positive cases.

Failure evidence preserved at
`%TEMP%\opencode\g2-http-run1-fail-5of13.out` (full first-run output,
including the server-side logs above). Second run: 13/13; full suite: 47/47.

## 4. Databases and teardown

- Suite DBs (all G2/runner-owned names, created by
  `%TEMP%\opencode\regression-prep.ps1` before the run):
  `openshop_sprint3_order_lifecycle`, `openshop_sprint3_tax_regression`,
  `openshop_sprint3_rate_limit`, `openshop_g3_tax_config`,
  `openshop_g5_dev_payment`, `openshop_g2_payment` — every one migrated
  with the app's own `pnpm run db:migrate` (checked wrapper, exit 0)
  before its suite ran.
- After the runs, `pg_database` shows **only the 8 pre-existing databases**
  (`maison_*`, `beyond_fear_local`, the two `openshop_sprint3_*_repro_*`,
  `openshop_sprint5`) plus `postgres`/templates — **all six suite databases
  self-dropped by the runner**, no leftovers, no user database touched.
- Ports 8000/9000: **0 listeners** (never bound).
- Credentials: parsed in-process only; never printed. The only env used by
  the runner is `DB_HOST=localhost` / `DB_PORT` / `DB_USERNAME` /
  `DB_PASSWORD`; `DATABASE_URL` is unset for runs (documented in
  `docs/local-development.md`).

## 5. What is NOT tested here (and must not be read as passing)

- **G2-G — real Stripe sandbox**: signed deliveries from Stripe's servers,
  real test-mode checkout/capture/refund, 3DS/redirect flows. **BLOCKED —
  no credentials exist. NOT TESTED, NOT SIMULATED.**
- Settlement, disputes, payouts (G2-H): out of scope for G2.
- Remote CI (G9): still requires explicit push authorization.

**Gate 3 (real payments safely) stays FAIL.**
