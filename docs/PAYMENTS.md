# Payments

> **Honesty first.** This repository does not process real money. Checkout
> runs on simulated/test providers; the official Stripe provider is wired in
> but **registers only when real credentials are present** — and none exist
> in this repository or environment. A simulated successful payment is
> **not** a payment integration: **Gate 3 (payments) stays FAIL** until a
> real gateway is integrated and verified against its sandbox (roadmap
> **G2**, gate **G2-G — BLOCKED on external credentials**). Nothing in this
> document changes that status.

## What exists today

| Provider ID | What it is | Real money? |
| --- | --- | --- |
| `pp_dev-payment_default` | The **OpenShop development payment provider** (roadmap **G5**) — a clearly labelled, self-contained provider that simulates the full payment lifecycle in the database | **Never** |
| `pp_sim-payment_default` | The **OpenShop payment simulator** (roadmap **G2**) — deterministic, credential-free, signed-webhook simulator implementing the provider-neutral contract (decline/pending/timeout/out-of-order scenarios) | **Never** |
| `pp_system_default` | Medusa's built-in **manual test payment provider** — the "Test" option in checkout | **Never** |
| `pp_stripe_stripe` | The **official `@medusajs/payment-stripe@2.21.2`** provider — registered **only when `STRIPE_API_KEY` is set**; absent ⇒ the provider does not exist in the module (no simulator fallback, ever) | Not configured here — **never registered in this repository** |

There is no card processing and no external payment API call anywhere in
this repository. A provider-neutral webhook endpoint does exist (G2, see
below): it verifies signatures, journals deliveries, and drives state — but
with no Stripe credentials configured it only ever processes events from the
local simulator, which cannot move money.

## Architecture (G5 development payment provider)

The provider lives in `apps/backend/src/modules/dev-payment/`:

- `services/dev-payment-provider.ts` — extends Medusa's
  `AbstractPaymentProvider` and implements the full payment interface:
  `initiatePayment`, `authorizePayment`, `capturePayment`, `refundPayment`,
  `cancelPayment`, `getPaymentStatus`, `retrievePayment`, `updatePayment`,
  `deletePayment`, plus the account-holder methods (no-ops — this provider
  holds no external resource) and `getWebhookActionAndData`, which always
  returns `not_supported` because **this provider has no webhooks**.
- `index.ts` — module entry exporting the service; registered in
  `medusa-config.ts` under the payment module's `providers` list.

Container key: `pp_dev-payment_default` (Medusa's `pp_{identifier}_{id}`
formula: identifier `dev-payment`, config id `default`).

### State machine

All provider state is stored in the payment session/payment `data` blob under
`data.dev_payment`, always stamped `simulated: true` and
`provider: "development"` so any inspector (API, admin, database, test) can
see at a glance that it is not real:

```
initiated ──authorize──▶ authorized ──capture──▶ captured ──refund──▶ refunded
    │                       │                      │
    │                       └──cancel──▶ canceled ◀─┘ (uncaptured only)
    └──decline──▶ error (failure_reason: "simulated_decline")
```

- **Amounts** are rounded to 6 decimals; comparisons use a 1e-6 epsilon so
  sums never drift.
- **Capture is assignment, not addition**: `captured_amount` is set to the
  payment amount, so repeated captures can never double-count.
- **Refunds** accumulate in `refunds[]` with the module-supplied idempotency
  key as `id`; the state flips to `refunded` when the refunded total reaches
  the captured amount.

### Simulation directives

A session can be created with `data.simulate` (store
`POST /store/payment-collections/:id/payment-sessions`):

| Value | Behavior |
| --- | --- |
| *(absent)* | Happy path: authorization succeeds, capture/refund/cancel behave as above |
| `"decline"` | Authorization fails: session → `error` with `failure_reason: "simulated_decline"`; checkout returns HTTP 400 and **no order is created** (the workflow compensates) |
| `"auto-capture"` | Authorization returns `captured` (Medusa captures immediately; the provider state reflects the capture) |

Any other value is rejected with `INVALID_DATA` naming the supported values.

### Idempotency and duplicate requests

- **Initiation**: a repeated `initiatePayment` with the same
  `context.idempotency_key` returns the current state instead of creating a
  new one.
- **Authorization**: authorizing an already-`authorized`/`captured` payment is
  a no-op; a declined payment stays declined on retry (idempotent failure).
- **Capture**: the module deduplicates captures by `reference_id`; the
  provider additionally no-ops on a repeated capture idempotency key
  (`capture_keys[]`).
- **Refunds**: a repeated refund idempotency key is a no-op; the module also
  deduplicates order transactions by `reference_id`.
- **Session creation**: the create-payment-sessions workflow deletes
  existing sessions as it creates the replacement, so a cart never holds two
  active sessions; completing a cart twice never duplicates the order.
- **Cancellation**: canceling an already-canceled payment is a no-op.
- **Concurrency**: none of the above depends on request ordering. The HTTP
  suite fires simultaneous duplicate capture and refund requests at the
  same instant (test 9) and asserts exactly one capture transaction and
  exactly one full refund land — the order and the provider never exceed
  the captured amount, even when requests race.

### Where the safeguards are

The provider cannot be mistaken for a production integration:

1. **Production boot refusal** — `validateOptions` throws (unless
   `ENABLE_DEV_PAYMENT_PROVIDER=true` explicitly acknowledges simulated
   payments) when `NODE_ENV=production`, naming the variable and
   `docs/PAYMENTS.md`. This runs when the payment module loads, i.e. before
   any request can be served.
2. **Boot warning on every start** — a `[OpenShop] Development payment
   provider (pp_dev-payment_default) registered: payments are simulated and
   no real money is ever processed.` line is printed on every boot and every
   migration run.
3. **No provider options** — the provider accepts none; any `options` entry
   in `medusa-config.ts` fails validation.
4. **State stamps** — every stored state carries `simulated: true` /
   `provider: "development"`.
5. **Storefront labelling** — the checkout payment option renders as
   "Development Payment (test only)" with a test badge
   (`isTestPayment`/`isDevPayment` helpers in
   `apps/storefront/src/lib/constants.tsx`).
6. **Config notice** — `medusa-config.ts` prints a payment notice on boot
   stating that checkout runs on simulated/test providers only.
7. **No webhooks** — `getWebhookActionAndData` always returns
   `not_supported`; there is no webhook endpoint to spoof.

## Merchant walkthrough (development checkout)

Prerequisites: backend running locally (`pnpm run backend:dev`), storefront
running (`pnpm run storefront:dev`), seeded database (`pnpm run db:migrate`).

1. **Configure the provider for your region.** In the admin dashboard open
   *Settings → Regions* → your region → *Payment providers*, and enable
   **Development Payment (test only)** (and/or *Manual Test*). Via API:

   ```http
   POST /admin/regions/:id
   { "payment_providers": ["pp_dev-payment_default"] }
   ```

   The provider must be registered (it is, by `medusa-config.ts`) and
   enabled before a region can offer it; `updateRegionsWorkflow` replaces the
   region's provider set and validates each entry exists and is enabled.

2. **Confirm test mode.** There is no separate "test mode" switch: the
   provider is *always* test-only. Enablement is the region step above, and
   the boot log confirms registration with the simulated-payments warning.

3. **Place a test order.** In the storefront: add an item to the cart,
   proceed through address → delivery, select **Development Payment (test
   only)** at the payment step, and place the order. To exercise the decline
   path, create the payment session with
   `{ "data": { "simulate": "decline" } }` instead — checkout then fails
   with HTTP 400 and no order is created.

4. **Inspect the payment status.** After a successful order:

   ```http
   GET /admin/orders/:id
   ```

   shows the order with its payment collection; the payment's `data`
   .`dev_payment` block shows the state machine
   (`authorized` after checkout, `captured` after capture, `refunded` after
   refunds) with `simulated: true`. Session status is also visible on the
   payment collection:

   ```http
   GET /store/payment-collections/:id
   ```

   Raw database inspection works too: `payment_session.data` /
   `payment.data` → `dev_payment`.

5. **Capture / refund / cancel** (admin): the admin order actions drive
   `capturePaymentWorkflow` / `refundPaymentWorkflow` / `cancelOrderWorkflow`
   exactly as they would for a real provider — the difference is that the
   provider only updates `data.dev_payment`; no money moves.

## Testing

- **Unit** — `apps/backend/src/modules/dev-payment/__tests__/dev-payment-provider.unit.spec.ts`
  (41 tests): state machine, idempotency, decline/auto-capture, amounts,
  production guard, no-options guard, webhook refusal.
- **HTTP integration** — `apps/backend/integration-tests/http/dev-payment.spec.ts`
  (9 tests): registration/region offering, full walkthrough with exact
  totals, capture + duplicate-capture idempotency, partial + over-refund
  rejection, cancellation, decline (400, no order, errored session),
  duplicate session/completion, region guard, and simultaneous duplicate
  capture/refund (4 identical captures + 4 identical full refunds fired at
  the same instant through the admin routes — exactly one capture and one
  refund land; money invariants hold under concurrency, not just sequential
  retries).

Both run under the standard suites (`pnpm run test:unit`,
`pnpm run test:integration:http` — see `docs/local-development.md` for the
two-step database procedure).

## G2 — payment integration layer (2026-11-12)

G2 built the **provider-neutral machinery** a real gateway plugs into, plus
the official Stripe adapter in a credential-free configuration. Everything
below is locally verifiable; the one thing that is not — running a real
Stripe sandbox — is explicitly **BLOCKED** (no credentials exist; it is
never simulated or claimed).

### Official Stripe provider (offline-validated)

- `@medusajs/payment-stripe@2.21.2` is a **direct dependency** of
  `apps/backend` at the exact installed Medusa version — no upgrade, no
  version drift in the lockfile.
- Registered in `medusa-config.ts` **only when `STRIPE_API_KEY` is set**,
  container key `pp_stripe_stripe`. With no key (today's state) the provider
  is absent from the payment module: `GET`-style lookups and `/webhooks/stripe`
  answer "not registered"/404. **There is no code path that falls back from
  Stripe to the simulator.**
- Config validation (`src/config/validate-env.ts`): a live API key requires
  `NODE_ENV=production` + `STRIPE_MODE=live`; an API key without
  `STRIPE_WEBHOOK_SECRET` is a hard boot error; production +
  `ENABLE_SIM_PAYMENT_PROVIDER` without a simulator secret is a hard error.
- Offline unit coverage: provider identifier (`stripe`), constructor performs
  no I/O, `validateOptions` rejects a missing key / warns on a missing
  webhook secret, and a signature-verification failure maps to HTTP 400
  (never an acknowledgment).

### Payment simulator (`pp_sim-payment_default`)

Separate module `apps/backend/src/modules/sim-payment/` — **not** a
modification of `dev-payment` (G5 evidence untouched):

- Same `AbstractPaymentProvider` contract; integer minor-unit money math
  only (no floats); every state stamped `simulated: true`,
  `provider: "simulated"`; production refusal identical in spirit to G5
  (secret rules enforced by `validateOptions` and `validate-env.ts`).
- Scenario directives (`decline`, `pending`, `timeout`, `requires_more`,
  `provider_drift`, …) drive deterministic outcomes, including honest
  declines (stay failed on retry) and uncertain timeouts (stay pending —
  never a false success, never a false failure).
- Signed webhooks: `x-sim-signature` = `t=…,v1=…` HMAC over the exact raw
  body (Stripe-style), 300 s replay window, wrong/missing signature ⇒ 400
  with nothing journaled.
- Storefront labels it **"Simulated Payment (test only)"** with the test
  badge (`isTestPayment`/`isSimPayment` in
  `apps/storefront/src/lib/constants.tsx`); the provider list stays
  region-scoped and is fetched from the backend — nothing is hard-coded to
  Stripe or to the simulator.

### Provider-neutral webhook pipeline

`POST /webhooks/:provider` (`src/api/webhooks/[provider]/route.ts` +
`src/lib/payment-webhooks.ts`), using Medusa's own
`PaymentModuleService.getWebhookActionAndData` (no competing payment
engine):

1. Raw body preserved (`preserveRawBody` middleware) — verification runs
   over the exact bytes received.
2. **Verify first** — provider `getWebhookActionAndData`; failures ⇒ 400
   (bad signature) or 404 (unknown/unregistered provider); unverified
   deliveries never reach the journal.
3. **Reserve** — insert-first dedup on unique `(provider, event_id)` in the
   `payment-events` journal (same database, no new platform): reserved /
   duplicate (200 `{received, duplicate}`) / in-flight (409, not applied).
4. **Apply** — applied actions run the official `processPaymentWorkflow`
   (order recovery from pending carts, authorization, capture). Failure ⇒
   journal `failed` + HTTP 500 (retryable; never a silent success).
5. **Finalize** — journal `processed` with the applied action.
   Out-of-order/stale events (e.g. `processing` after `authorized`) are
   acknowledged `not_supported` with **zero** money-state change; a failed
   `payment_failed` repeats as an acknowledged no-write.

### Reconciliation

`POST /admin/payments/:id/reconcile` (`src/lib/payment-reconcile.ts`):
reads local payment/session state, asks the provider for its view
(`getStatus`), and classifies `in_sync` / `status_mismatch` /
`capture_mismatch` / `amount_mismatch` / `provider_error`. Every run is
journaled with a unique `rec_*` run id (repeat-safe), amounts compare as
exact integer minor units, and the endpoint **never mutates payment state
and never charges anything** — drift is reported for a human to decide.

### Provider-neutral contract suite

`src/modules/payment-contract/contract.ts` — `runPaymentProviderContract`
executes 13 ordered checks (identifier, integer-minor-unit initiation,
authorize success/idempotency, status reflects authorization/capture,
no-double-count capture, refund-over-capture and non-positive-refund
rejection, cancel-after-capture and capture-before-authorize rejection,
honest decline, unverifiable-webhook rejection). It runs **full** against
the simulator; deliberately broken providers (double-counting capture,
declining-but-succeeding) prove each guard fails loudly; Stripe runs the
offline subset only — its end-to-end run belongs to G2-G.

### G2 test coverage (details: `docs/G2_PAYMENT_TESTING.md`)

- Backend unit **171/171** (G2 adds simulator webhook, signature,
  pipeline, reconciliation, journal redaction/classification, contract,
  Stripe-offline, and validate-env payment cases).
- HTTP integration **47/47** incl. the 13-test `g2-payment.spec.ts`
  (registration, signature/amount rejection, order recovery, dedup,
  in-flight 409, out-of-order, failure events, unknown-provider 404,
  Stripe-unregistered 404, reconciliation repeat-safety and
  never-auto-charge, unknown-payment 404).
- Storefront **87/87**, migrate **8/8**, lint exit 0, storefront build
  exit 0.

### What G2 does NOT claim

- **G2-G — real Stripe sandbox validation: BLOCKED / NOT TESTED** (no
  credentials; see `docs/G2_SANDBOX_VALIDATION.md`). No sandbox checkout,
  no real signed delivery from Stripe, no real capture/refund is claimed
  anywhere.
- Settlement, disputes, payouts: out of scope (G2-H).
- **Gate 3 stays FAIL.** Until G2-G runs with real credentials, do not
  describe this project as payment-ready.

## Relationship to G5 (development payment provider)

G5 remains deliberately **not** a step toward claiming payment readiness:

- It proves the *integration surface* works end-to-end (session →
  authorization → capture → refund → cancel, idempotency, order-state
  consistency) against Medusa's real payment interfaces.
- It proves **nothing** about real money: no card data, no gateway, no
  settlement, no dispute handling, no PCI scope.

**Gate 3 stays FAIL.** The remaining payments step is **G2-G**: verify the
already-wired official Stripe provider against a real Stripe sandbox
account with credentials, then record signed-webhook and checkout/refund
tests. Until that lands, do not describe this project as payment-ready.
