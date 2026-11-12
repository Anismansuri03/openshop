# G2 — Completion Report (Global Payment Integration & Provider-Neutral Architecture)

> **Date:** 2026-11-12 (local, Windows/PowerShell).
> **Environment:** Node v24.17.0, pnpm 10.11.1, Medusa 2.21.2 (pinned — no
> upgrade), PostgreSQL 17.
> **HEAD:** `ef471159eb9cdc58c22f2d325ac4d24e00bf12ac` (= origin/main,
> unchanged by G2).
>
> **Truthfulness rules applied throughout:** no Stripe credentials exist
> anywhere — no credential was invented, no real or simulated-sandbox
> transaction is claimed, **G2-G is BLOCKED / NOT TESTED**, and **Gate 3
> stays FAIL**. No test was skipped, disabled, or weakened; every command
> below was executed and its exit code recorded; failure evidence from the
> first failing run is preserved.

## 1. Gate verdicts G2-A … G2-H

| Gate | Scope | Verdict | Evidence |
| --- | --- | --- | --- |
| **G2-A** | Read-only architecture audit + provider strategy | **PASS** | `docs/G2_PAYMENT_ARCHITECTURE_AUDIT.md` (component map, gap assessment, official Stripe support verified in installed 2.21.2 packages, 16-area contract, approved 9-item plan) and `docs/G2_PROVIDER_SUPPORT_MATRIX.md` (Stripe/PayPal/Adyen/Razorpay/Cashfree from dated official sources, India eligibility noted, no universal-availability claims) — both written **before any code**, per the audit-first rule |
| **G2-B** | Official Medusa Stripe provider wired (offline) | **PASS (offline only)** | `@medusajs/payment-stripe@2.21.2` direct dep of `apps/backend` at the exact installed version (no upgrade, no unrelated version change); registered in `medusa-config.ts` only when `STRIPE_API_KEY` is set (container key `pp_stripe_stripe`); **no simulator fallback in any code path**; `validate-env.ts` payment rules (live key ⇒ production + `STRIPE_MODE=live`, API key without webhook secret ⇒ hard boot error, production + `ENABLE_SIM_PAYMENT_PROVIDER` without secret ⇒ hard error); `.env.template` payment block; offline unit coverage (identifier `stripe`, constructor does no I/O, `validateOptions` behavior, signature failure ⇒ HTTP 400) |
| **G2-C** | Credential-free payment simulator | **PASS** | Separate module `sim-payment` (`pp_sim-payment_default`), not a modification of G5's `dev-payment`; same `AbstractPaymentProvider` contract; integer minor-unit money math only (no floats); `simulated: true` / `provider: "simulated"` stamps; deterministic scenarios (decline / pending / timeout / requires_more / provider_drift); Stripe-style `t=…,v1=…` HMAC signed webhooks over exact raw body with 300 s replay window; production refusal; storefront label **"Simulated Payment (test only)"** via `isTestPayment`/`isSimPayment`; unit + HTTP coverage below |
| **G2-D** | Provider-neutral webhook pipeline (idempotent, replay/dedup/out-of-order) | **PASS (local)** | `POST /webhooks/:provider` via Medusa's own `getWebhookActionAndData` (no competing payment engine): raw body preserved → verify-first (400 bad signature / 404 unknown provider, nothing journaled) → insert-first dedup on unique `(provider, event_id)` in the new `payment-events` journal → official `processPaymentWorkflow` → finalize. Duplicate ⇒ 200 `{received, duplicate}`; in-flight ⇒ 409 not applied; out-of-order/stale ⇒ acknowledged `not_supported` with **zero** money-state change; apply failure ⇒ journal `failed` + 500 (retryable). Proven over HTTP by `g2-payment.spec.ts` tests 1–10 |
| **G2-E** | Reconciliation (repeat-safe, never auto-charges) | **PASS (local)** | `POST /admin/payments/:id/reconcile` + `src/lib/payment-reconcile.ts`: pure `classifyReconcile`, exact string compare of integer minor-unit amounts, every run journaled with unique `rec_*` run id (repeat-safe), **never mutates payment state and never charges anything**; missing payment ⇒ 404. HTTP tests 11–13 (in_sync twice with distinct run ids; induced capture drift ⇒ `capture_mismatch` report, repeat-safe, still never auto-charges; unknown payment ⇒ 404) |
| **G2-F** | Storefront/admin wiring, tests, docs | **PASS (local)** | Storefront: sim entry in `constants.tsx` + `isSimPayment` included in `isTestPayment` badge; provider list stays region-scoped and fetched from the backend; **no hard-coded Stripe, no secrets in admin/frontend**. Tests: 313/313 (§2). Docs: `docs/PAYMENTS.md` §G2, `docs/G2_PAYMENT_TESTING.md`, `docs/G2_SANDBOX_VALIDATION.md`, roadmap §16, readiness report Gate 3/9 + stage log updated, milestone history preserved |
| **G2-G** | Real Stripe sandbox validation (checkout, signed delivery from Stripe, capture/refund, failure card, live reconciliation) | **BLOCKED / NOT TESTED** | **No Stripe credentials exist** — nothing executed, nothing simulated, nothing claimed. Unblock items enumerated in `docs/G2_SANDBOX_VALIDATION.md`. This gate is the sole remaining G2 item |
| **G2-H** | Settlement, disputes, payouts | **OUT OF SCOPE** | Excluded from G2 by definition (audit §"Out of scope"); not attempted, not claimed |

## 2. Exact commands and exit codes (all local)

| # | Command (cwd) | Exit | Result |
| --- | --- | --- | --- |
| 1 | `pnpm exec tsc --noEmit -p tsconfig.json` (`apps/backend`) | **0** | 0 errors |
| 2 | `pnpm run test:unit` (`apps/backend`) | **0** | **171/171**, 12 suites (baseline 90 → +81) |
| 3 | `powershell -File %TEMP%\opencode\regression-prep.ps1` (repo root) | **0** | six suite DBs created + migrated + seeded |
| 4 | `pnpm run test:integration:http` (`apps/backend`, `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD` from `.env`, `DATABASE_URL` unset) | **0** | **47/47**, 6 suites (baseline 34 → +13) |
| 5 | `pnpm run test:integration:migrate` (`apps/backend`, same DB_* env) | **0** | **8/8**, 2 suites |
| 6 | `pnpm run test` (`apps/storefront`) | **0** | **87/87**, 7 files |
| 7 | `pnpm run lint` (repo root, turbo → both apps) | **0** | backend 0 errors / 22 warnings (advisory: 1 pre-existing + 21 documented G2 design — plain `Error` throws that must map to 500, never 400); storefront 2 warnings (pre-existing) |
| 8 | `NEXT_PUBLIC_BASE_URL=https://ci-build.example pnpm run build` (`apps/storefront`) | **0** | production build complete |

**Source-tree total: 313/313** (171 unit + 87 storefront + 47 HTTP + 8
migrate) — the 219 G10-F baseline plus **94 new G2 tests**. No unexecuted
test is counted as passing.

Full suite-by-suite detail, the `g2-payment.spec.ts` 13-test list, and the
teardown record: `docs/G2_PAYMENT_TESTING.md`.

## 3. Bugs found and fixed during bring-up (failure evidence preserved)

The **first** `g2-payment` HTTP run failed **5/13** (exit 1). Two real bugs
were fixed — never papered over:

1. **Invalid Medusa list shape.** `findEvent` called
   `listPaymentEvents({ where: {...}, take: 1 })`. Medusa list methods are
   `list(filters, config)`: a `where` wrapper and `take` inside filters
   both throw `Trying to query by not existing property PaymentEvent.where`
   / `.take`. Fixed to `listPaymentEvents({ provider, event_id }, { take: 1 })`.
2. **Duplicate classification missed DAL's error rewrite.** Medusa's
   `dbErrorMapper` rewrites the raw Postgres `23505` into a `MedusaError`
   (type `INVALID_DATA`, message `Payment event with provider: ...,
   event_id: ..., already exists.`) carrying **neither `code` nor
   `constraint`** — so `isDuplicateKeyError` missed it and duplicate /
   in-flight deliveries answered **500** instead of 200-duplicate / 409.
   Fixed to recognize the mapped shape too; **+5 unit tests** pin all three
   error shapes plus no-false-positive cases.

Failure output preserved at `%TEMP%\opencode\g2-http-run1-fail-5of13.out`.
After the fixes: targeted 13/13, then full suite 47/47.

## 4. Safety and teardown record

- **No credential printed or committed**; `.env` values parsed in-process
  only; `.env.template` documents the new payment variables (no secrets).
- **Live mode disabled throughout G2**; no network call to any payment
  provider was made by any test.
- **Databases:** all six suite DBs (`openshop_sprint3_order_lifecycle`,
  `openshop_sprint3_tax_regression`, `openshop_sprint3_rate_limit`,
  `openshop_g3_tax_config`, `openshop_g5_dev_payment`, `openshop_g2_payment`)
  self-dropped by the runner — `pg_database` shows only the **8
  pre-existing** databases plus `postgres`/templates. No user database
  touched; G2 used only its own uniquely named DB.
- **Ports 8000/9000:** 0 listeners.
- **Git:** HEAD unchanged `ef471159eb9cdc58c22f2d325ac4d24e00bf12ac`;
  tracked changes still 27 modified + 1 deleted (identical set to the
  pre-G2 baseline); untracked 46 → 70 (+24 G2 files); nothing staged,
  nothing committed, no tag/stash/reset/push. G10-F evidence untouched.
- **Prior evidence preserved:** first-run failure output, G10-F records,
  and all prior stage-log rows intact; milestone history not rewritten.

## 5. Gate impact and verdict

- **Gate 3 (real payments safely): FAIL** — the official provider is wired
  but never validated (G2-G BLOCKED); checkout still runs on
  simulated/test providers only; a simulated success is not a payment
  integration.
- **Gate 9: PASS (local)** — 313 tests (was 219); remote CI still
  unverified (**G9** — push authorization required).
- Gates 1/5/6/7 PASS (local), 2/4/11 PARTIAL, 8/12 UNVERIFIED,
  10 PARTIAL — unchanged by G2.
- **Overall verdict: NOT LAUNCH-READY.**

## 6. What remains for G2

1. **G2-G** — provision Stripe test-mode credentials (never commit; local
   env only) and execute the six items in
   `docs/G2_SANDBOX_VALIDATION.md`, attaching real evidence. Until then
   every report must keep G2-G as **BLOCKED / NOT TESTED** and Gate 3 as
   **FAIL**.
2. **G9** — remote CI verification of the working copy (needs explicit
   push authorization for `https://github.com/Anismansuri03/openshop.git`).
3. **G14** — CODE_OF_CONDUCT.md (deferred by user; blocks the release
   checklist).
