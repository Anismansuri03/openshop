# G2 — Payment Architecture Audit (read-only)

> **Status:** Complete. Read-only inspection of the working tree as of HEAD
> `ef471159eb9cdc58c22f2d325ac4d24e00bf12ac` (branch `main`, 74-entry working
> tree, nothing staged). No source code was modified while producing this
> document. Dates below refer to the audit run (2026-11-10).
>
> **Truthfulness:** No Stripe credentials exist in this repository or
> environment. Nothing in this audit implies a real payment transaction.

## 1. Scope and method

Everything below was verified against the **installed** packages and the
**actual working tree**, not against prior reports:

- `node_modules/.pnpm/@medusajs+medusa@2.21.2_*` — manifest and dist inspection
- `node_modules/.pnpm/@medusajs+payment-stripe@2.21.2_*` — full dist tree read
  (`stripe-base.js`, `stripe-provider.js`, `types/index.d.ts`)
- `node_modules/.pnpm/@medusajs+payment@2.21.2_*` and `@medusajs/types@2.21.2`
  — `PaymentModuleService`, `ProviderWebhookPayload`, `PaymentActions`,
  `WebhookActionResult` definitions
- `node_modules/.pnpm/@medusajs+framework@2.21.2_*` — `preserveRawBody`
  support (`dist/types.d.ts:20`, `dist/http/bodyparser.js:17`)
- All payment-related source under `apps/backend` and `apps/storefront`
- `pnpm-lock.yaml` importers and the `payment-stripe` resolution graph

## 2. Component map

```
┌────────────────────────────────── apps/storefront ──────────────────────────────────┐
│ checkout-form → <Payment availablePaymentMethods>                                   │
│   src/modules/checkout/templates/checkout-form/index.tsx                            │
│ listCartPaymentMethods(regionId)  ── GET /store/payment-providers?region_id=        │
│   src/lib/data/payment.ts:7-35   (fetched live — NOT hard-coded, cached w/ tag)     │
│ Payment component                                                                 │
│   src/modules/checkout/components/payment/index.tsx                                 │
│     • finds active session (status === "pending") on cart.payment_collection        │
│     • setPaymentMethod: initiates session immediately only for isStripeLike()       │
│     • otherwise session created on submit                                           │
│ payment-wrapper + stripe-wrapper (DORMANT)                                        │
│   src/modules/checkout/components/payment-wrapper/*                                 │
│   gated by isStripeLike(pp_stripe_*) && NEXT_PUBLIC_STRIPE_KEY — never activates    │
│   today (key is empty in .env.template)                                             │
│ paymentInfoMap: pp_stripe_stripe → "Stripe" (src/lib/constants.tsx)                 │
│ isStripeLike / isTestPayment predicates (src/lib/constants.tsx)                     │
│ placeOrder → sdk.store.cart.complete (src/lib/data/cart.ts)                       │
│ /api/payment-return — Stripe redirect return: validates payment_intent +            │
│   client_secret against the payment session (src/app/api/payment-return/route.ts)   │
└─────────────────────────────────────────────────────────────────────────────────────┘
                       │  store publishable key / JS SDK
                       ▼
┌────────────────────────────────── apps/backend ─────────────────────────────────────┐
│ medusa-config.ts                                                                   │
│   payment module: only provider registered = "./src/modules/dev-payment" id         │
│   "default" → container id pp_dev-payment_default                                  │
│   (no official providers registered; no webhook config)                             │
│ validate-env.ts — NO payment variables validated today                              │
│ .env.template — ENABLE_DEV_PAYMENT_PROVIDER (commented),                           │
│   NEXT_PUBLIC_STRIPE_KEY (empty, storefront)                                        │
│                                                                                      │
│ Payment Module (@medusajs/payment 2.21.2) — the ONLY payment engine                │
│   PaymentModuleService                                                             │
│     createPaymentCollections / createPaymentSessions / authorizePayment            │
│     capturePayment / refundPayment / cancelPayment / getWebhookActionAndData       │
│   provider container keys: pp_<identifier>_<id>                                     │
│                                                                                      │
│ dev-payment provider (G5)                    system provider (Medusa built-in)     │
│   src/modules/dev-payment/services/          pp_system_default — manual "Test"     │
│     dev-payment-provider.ts (534 lines)      option, no external calls              │
│   AbstractPaymentProvider full contract:                                            │
│     initiate/update/getStatus/authorize/capture/refund/cancel/delete                │
│     deleteAccountHolder/createAccountHolder/retrieveAccountHolder                   │
│     deletePaymentMethod/savePaymentMethod/listPaymentMethods                        │
│     • state machine, simulated:true stamps, production refusal,                     │
│       webhook → not_supported                                                       │
│                                                                                      │
│ Official Stripe provider — INSTALLED BUT NOT WIRED                                  │
│   @medusajs/payment-stripe@2.21.2 (58 files in .pnpm)                              │
│   pulled in as a direct dep of @medusajs/medusa@2.21.2 (same version)              │
│   NOT symlinked into apps/backend/node_modules → `resolve:` would fail today       │
│   identifier: "stripe" → container id pp_stripe_stripe                             │
│   services: stripe, stripe-oxxo, stripe-bancontact, stripe-blik,                    │
│     stripe-giropay, stripe-ideal, stripe-przelewy24, stripe-promptpay              │
│   core/stripe-base.js: official `stripe` SDK (v15/19 in lockfile),                  │
│     StripeOptions { apiKey, webhookSecret, capture, automaticPaymentMethods,        │
│     paymentMethodConfiguration, paymentDescription, oxxoExpiresDays,                │
│     asyncPaymentMethodTypes }                                                      │
│   webhook: constructWebhookEvent uses headers["stripe-signature"] +                 │
│     rawData + webhookSecret; StripeAPIError → indeterminate                         │
│     ({retry:false, indeterminate_due_to})                                           │
│                                                                                      │
│ API routes (src/api)                                                                │
│   ONLY 2 stub GET routes; ZERO webhook routes; NO raw-body handling                 │
│ Admin (src/admin) — stock dashboard only; NO payment widgets/extensions             │
│ Workflows — no custom payment workflow; capture/refund/cancel flow through          │
│   core flows (capturePaymentWorkflow, refundPaymentWorkflow, cancelOrderWorkflow)   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Payment lifecycle diagram (current reality)

```
                       storefront                          backend
  ┌───────────────────────────────────────┐   ┌──────────────────────────────────┐
  │ 1. region → GET /store/payment-       │   │                                  │
  │    providers  (live list: dev-payment, │──▶│ returns enabled provider ids     │
  │    system)                            │   │                                  │
  │ 2. user selects method                │   │                                  │
  │ 3. initiatePaymentSession ────────────┼──▶│ PaymentModule: create session    │
  │    (stripe-like: immediate;           │   │   on cart.payment_collection     │
  │     others: on submit)                │   │   → provider.initiatePayment()   │
  │ 4. placeOrder → cart.complete ────────┼──▶│ orderLifecycle:                  │
  │    NEVER trusts client success flag   │   │   provider.authorizePayment()    │
  │                                       │   │   → authorized | pending |       │
  │                                       │   │     requires_more | failed       │
  │ 5. capture (admin or auto) ───────────┼──▶│ core capturePaymentWorkflow      │
  │ 6. refund / cancel (admin) ───────────┼──▶│ core refund/cancel workflows     │
  └───────────────────────────────────────┘   └──────────────┬───────────────────┘
                                                             │ (STRIPE ONLY, not wired)
                                              external webhook ▼
                                       POST /store/webhooks/<provider>   ← DOES NOT EXIST
                                         → PaymentModuleService
                                           .getWebhookActionAndData({provider,
                                             payload:{data, rawData, headers}})
                                         → action: authorized|captured|failed|...
```

**Webhook gap:** there is currently **no** route receiving provider events.
`dev-payment` deliberately returns `not_supported` for webhooks, so all state
today flows from synchronous storefront/admin operations only. That is
acceptable for a simulated provider, and must change for Stripe (3DS, redirects,
async capture, delayed events would otherwise leave orders pending forever).

## 4. Gap assessment

### 4.1 What already works (verified)

- Provider list is **fetched per region** (`GET /store/payment-providers`) —
  checkout is not hard-coded to any provider.
- Full lifecycle on simulated providers: initiate → authorize → capture →
  refund (full/partial) → cancel → delete, with a real state machine and
  integer minor-unit money math (`BigNumber`), enforced in `dev-payment`.
- G5 idempotency invariants: duplicate/concurrent capture & refund tests exist
  (41 unit + 9 HTTP in `dev-payment.spec.ts`, 8 in `order-lifecycle.spec.ts`).
- Order completion never trusts browser-reported success
  (`cart.complete` re-authorizes server-side).
- Test/labeled indicators: `isTestPayment` badge in checkout; `simulated`
  stamps persisted by `dev-payment`; production startup refuses dev provider.
- Raw-body support exists in the framework (`preserveRawBody` option) but is
  **not enabled**.
- Storefront already ships `@stripe/stripe-js@^8.2.0` and
  `@stripe/react-stripe-js@^5.3.0` (starter leftovers, dormant).

### 4.2 What is incomplete

- No provider besides `dev-payment` registered in `medusa-config.ts`.
- `@medusajs/payment-stripe` is installed transitively but **not resolvable**
  from `apps/backend` (not in `apps/backend/node_modules`) — must be declared
  as a direct dependency at the **exact same 2.21.2** (already present in the
  lockfile; no version change, no Medusa upgrade).
- No webhook route, no `preserveRawBody`, no replay/dedup storage.
- `validate-env.ts` validates **no** payment configuration; live-mode
  misconfiguration would not fail fast.
- No reconciliation mechanism of any kind.
- No admin visibility beyond the stock dashboard order/payment screens.

### 4.3 What is simulated

- Everything today: `pp_dev-payment_default` (labeled, DB-persisted,
  production-refusing) and `pp_system_default` (Medusa manual test provider).
  Both refuse to process real money by design.

### 4.4 What requires a real external provider

- Actual authorization/capture/refund against Stripe (G2-G) — **BLOCKED: no
  credentials available; will not be simulated or claimed.**
- Real webhook delivery and signature verification against Stripe's servers.
- 3DS/redirect/async payment-method flows end-to-end.
- Settlement, disputes, payouts — outside G2 entirely (G2-H).

### 4.5 What is missing for global merchant use

- Region-scoped multi-provider configuration (only one provider id can serve a
  region today).
- Provider availability rules by merchant country/region (no eligibility model).
- Settlement-currency and payment-method visibility per provider.
- Provider-neutral status: storefront badges only know `pp_stripe_*` and
  `isTestPayment`; no generic provider metadata channel.
- Multi-currency refund semantics verification beyond current tests.

### 4.6 What requires provider-specific behavior

- Webhook signature verification (per provider algorithm — Stripe HMAC via
  `stripe-signature`, others differ).
- Redirect/3DS return URLs and provider-specific reference ids.
- Provider-specific configuration keys (`apiKey`, `webhookSecret`, …) kept out
  of core commerce logic.

### 4.7 What must remain provider-neutral

- Payment session/collection lifecycle and the order lifecycle (Medusa core).
- Amount/currency math (integer minor units) and reconciliation invariants.
- The contract test suite (section 6).
- Storefront provider listing/selection (already region-driven).

## 5. Existing Medusa Stripe support discovered (1.2 findings)

| Question | Verified answer |
| --- | --- |
| Does installed Medusa ship an official Stripe provider? | **Yes.** `@medusajs/medusa@2.21.2` declares `@medusajs/payment-stripe: 2.21.2` as a **direct dependency**. |
| Installed on disk? | Yes: `node_modules/.pnpm/@medusajs+payment-stripe@2._fb9f02ed…` — 58 files, `main=dist/index.js`, version 2.21.2. |
| Resolvable from `apps/backend`? | **No.** No symlink in `apps/backend/node_modules` or root `node_modules`; not declared by any workspace importer. Adding it as a direct dep at `2.21.2` reuses the exact lockfile resolution (`stripe@19.1.0` already resolved) — **no upgrade, no lockfile version change**. |
| Provider registration | `resolve: "@medusajs/payment-stripe"` + identifier `stripe` → container key **`pp_stripe_stripe`** (already present in storefront `paymentInfoMap` and matched by `isStripeLike`). |
| Options | `StripeOptions { apiKey, webhookSecret, capture?, automaticPaymentMethods?, paymentMethodConfiguration?, paymentDescription?, oxxoExpiresDays?, asyncPaymentMethodTypes? }`; validator warns when `webhookSecret` missing (async flows won't update orders without it). |
| Webhook support in provider | `getWebhookActionAndData` → `constructWebhookEvent(rawData, headers["stripe-signature"], webhookSecret)`; errors: `StripeAPIError` → `{retry:false, indeterminate_due_to:"stripe_api_error"}`. |
| Medusa entry point | `PaymentModuleService.getWebhookActionAndData({ provider, payload: { data, rawData, headers } })` — official; uses Medusa's webhook routing, not a competing router. |
| Raw body | Framework supports `preserveRawBody` (`framework/dist/types.d.ts:20`, `bodyparser.js:17`) — must be enabled for signature verification. |
| Alternative package | `@medusajs/payment@2.21.2` also ships a `payment-medusa` Stripe-ish provider (`medusa-payments.js` calls `stripeClient.webhooks.constructEvent`), but the canonical documented provider is `@medusajs/payment-stripe`. **Decision: use `@medusajs/payment-stripe`.** |
| Duplication risk | Building a custom Stripe provider would duplicate the official one → **prohibited by this audit**. |

**Decision (provider + architecture):** Stripe via the **official**
`@medusajs/payment-stripe@2.21.2` (first reference provider, pinned to the
installed Medusa version), plus a **separate local simulator provider** (new
module, `simulated: true`, deterministic) implementing the same
`AbstractPaymentProvider` contract. `dev-payment` stays untouched (G5 evidence
preserved); the simulator adds failure/webhook/recovery scenarios that
`dev-payment` by design does not simulate. No parallel payment engine; no
Medusa upgrade.

## 6. Provider-neutral contract (design)

A shared contract suite every provider must satisfy, layered on top of — never
replacing — G5's idempotency tests. Capability matrix per operation:
**supported / unsupported / conditionally supported / provider-specific.**
No claim of identical features across providers.

| # | Contract area | Core invariants |
| --- | --- | --- |
| 1 | Session creation | Session exists on collection; amount+currency match cart in minor units. |
| 2 | Initialization | `initiatePayment` returns provider reference; no external call for simulator. |
| 3 | Authorization | Success ⇒ `authorized`/`pending`; failure ⇒ `failed`, **never** a paid order. |
| 4 | Capture | Capture ≤ authorized amount; **no duplicate capture; no additive capture**. |
| 5 | Full refund | refund ≤ captured; total refunded never exceeds captured. |
| 6 | Partial refund | where supported: repeated partials sum ≤ captured. |
| 7 | Cancellation | cancel ⇒ released/void; capture-after-cancel rejected. |
| 8 | Status retrieval | `getStatus` idempotent and consistent with stored state. |
| 9 | Update | `updatePayment` changes only allowed fields. |
| 10 | Error normalization | Provider errors → Medusa error types, no secrets in messages. |
| 11 | Duplicate operation | Second capture/refund of same op ⇒ no double effect. |
| 12 | Concurrent duplicates | Parallel identical ops ⇒ exactly one effective (G5 invariant extended). |
| 13 | Delayed/out-of-order webhooks | Late/old events never regress a terminal state incorrectly. |
| 14 | Expiration | Expired session cannot authorize. |
| 15 | Interrupted request recovery | State derived from provider/local reference, not the request. |
| 16 | Reconciliation | Provider-vs-local compare; mismatch detected, never auto-charged. |

Money: integer minor units everywhere (`BigNumber`), **no float arithmetic.**

## 7. Implementation plan (approved scope)

1. **Dependency:** add `"@medusajs/payment-stripe": "2.21.2"` (exact) to
   `apps/backend/package.json` via pinned pnpm install → verifies no lockfile
   version drift (resolution already exists at L1763).
2. **Contract suite:** new provider-contract test harness covering section 6,
   run against `dev-payment`, the new simulator, and (where local-testable)
   Stripe config validation.
3. **Simulator:** new module `apps/backend/src/modules/sim-payment` (separate
   from `dev-payment`), same `AbstractPaymentProvider` contract, deterministic
   fixtures/events, failure modes (decline, insufficient funds, timeout,
   interruption, pending), signed webhook simulation with replay/duplicate/
   out-of-order/invalid-signature scenarios, persisted `simulated` indicator,
   production refusal identical to G5, dev-only checkout/admin badge.
4. **Stripe registration:** `medusa-config.ts` gains the official provider
   (env-driven `apiKey`/`webhookSecret` placeholders; absent ⇒ provider not
   registered; **never** falls back to simulator), `preserveRawBody` enabled.
5. **Webhook route:** `POST /store/webhooks/stripe` → `getWebhookActionAndData`
   with raw body; idempotent processing + event-id dedup + amount/currency
   association checks; 4xx on bad signature; no secret logging.
6. **Reconciliation:** smallest compatible mechanism (admin-queryable
   comparison endpoint/job over existing DB — no second database, no job
   platform): compare local vs provider state, classify mismatches, never
   auto-charge, flag manual-intervention cases.
7. **Storefront/admin:** region-driven provider display (no hard-coding),
   pending/failure/cancel/duplicate-submit handling, dev indicator; admin
   shows configured providers + reconciliation status; no secrets exposed.
8. **Testing:** unit → simulator integration → Medusa HTTP integration
   (isolated `openshop_g2_*` DB) → storefront → security → full regression
   (all 219 existing tests preserved).
9. **Docs:** PAYMENTS.md update + G2 audit/testing/matrix/sandbox docs; roadmap
   and readiness report updated factually; **Gate 3 stays FAIL**; G2-G stays
   BLOCKED/NOT TESTED.
