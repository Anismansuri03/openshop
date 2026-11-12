# G2-G — Stripe Sandbox Validation: BLOCKED / NOT TESTED

> **Status: BLOCKED — NOT TESTED.** No Stripe credentials (test-mode or
> live) exist in this repository, its environment, or any CI configuration.
> This document exists so that the gap is recorded explicitly and cannot be
> mistaken for a passing result. Nothing below has been executed; nothing
> below may be reported as verified.

## Why it is blocked

G2 wired the **official `@medusajs/payment-stripe@2.21.2` provider** end
to end (registration gated on `STRIPE_API_KEY`, webhook pipeline,
reconciliation, config validation, offline unit coverage). Running it
against Stripe requires an external artifact that does not exist and will
not be fabricated:

- a Stripe account (test mode) and its **secret key** (`sk_test_…`);
- a webhook endpoint secret (`whsec_…`) for signed deliveries;
- per G2 safety rules: no invented credentials, no simulated claim of a
  real transaction, no live-mode operation at any point in G2.

## What "G2-G complete" will require (all items currently NOT DONE)

Executed against a real Stripe **test-mode** account, with evidence
(recorded request/response pairs, event ids, dashboard screenshots)
attached to this document:

1. **Configuration** — `STRIPE_API_KEY` + `STRIPE_WEBHOOK_SECRET` present
   in local env only; `validate-env.ts` accepts them; provider registers as
   `pp_stripe_stripe`; **no** simulator fallback present in any code path.
2. **Checkout** — test-mode payment session → authorization → capture
   through the storefront, producing a real `pi_…`/`pm_…` reference on the
   payment.
3. **Signed webhook** — a delivery **originating from Stripe** verified by
   the pipeline (bad signature still rejected), journaled exactly once
   under Stripe's event id (`evt_…`), state advanced idempotently; redeliver
   answered as duplicate; out-of-order delivery not regressing state.
4. **Refund** — test-mode full refund against the captured payment,
   observed on both sides; reconciliation run classifying it `in_sync`.
5. **Failure path** — a declining test card produces `failed` with **no**
   order and no false success.
6. **Reconciliation** — provider view fetched live from Stripe; at least
   one induced drift surfaced as a mismatch report with **no** automatic
   money movement.

## What is verified locally instead (and its exact limits)

Local verification covers only the **machinery** a provider plugs into,
using the credential-free simulator and offline inspection of the official
adapter (details: `docs/G2_PAYMENT_TESTING.md`):

- the same webhook pipeline, journal, dedup, and reconciliation code paths
  run for the simulator over HTTP (13/13);
- the Stripe adapter's identifier, option validation, and signature-failure
  → HTTP 400 mapping are asserted **offline** (no network, dummy key);
- the provider-neutral 13-check contract runs **full** only against the
  simulator; for Stripe it is an offline subset by design.

**None of that is a Stripe transaction.** No test in this repository talks
to Stripe's API; no recorded event originates from Stripe.

## Gate impact

- **G2-G: BLOCKED / NOT TESTED** (external authorization required —
  account/credentials the repository owner must provision).
- **Gate 3 (real payments safely): stays FAIL.** A simulated success is
  not a payment integration, and the simulator must never be presented as
  evidence of provider readiness.
- Verdict unchanged: **NOT LAUNCH-READY** on payments grounds.

## If/when credentials exist

Unblock by provisioning Stripe test-mode credentials (never commit them;
local env only per `docs/local-development.md`), then execute items 1–6
above and replace the status line at the top of this document with the
recorded evidence. Until then every report must keep this section as
**BLOCKED / NOT TESTED**.
