# G2 — Global Provider Support Matrix

> **Checked:** 2026-11-10, against **official provider documentation** (links
> below). Availability, onboarding, payment methods and currencies change over
> time and vary by merchant country, customer country, account type and
> regulatory approval. **No claim of universal global availability is made.**
>
> **No credentials exist for any provider listed here.** Nothing below was
> validated against a live or sandbox account (G2-G remains BLOCKED).

## 1. Country / eligibility summary (merchant onboarding)

| Provider | Merchant-country eligibility (officially stated) | India specifically | Official source (checked 2026-11-10) |
| --- | --- | --- | --- |
| **Stripe** | 46 countries/regions with local acquiring; sell to customers in 195+ countries, 135+ currencies | **Invite-only / "Preview"** — Indian businesses cannot self-sign-up; must request an invite (export-focused businesses prioritized; IEC + RBI purpose codes may apply) | [stripe.com/global](https://stripe.com/global), [stripe.com/use-cases/global-businesses](https://stripe.com/use-cases/global-businesses), [docs.stripe.com/india-accept-international-payments](https://docs.stripe.com/india-accept-international-payments) |
| **Adyen** | Global acquiring; onboarding/coverage differs per product (online vs in-person vs platforms); settlement currencies per acquiring region incl. INR local payout for India | Available as a settlement region (INR held in India); online availability subject to Adyen onboarding | [docs.adyen.com](https://docs.adyen.com/) ([supported payout currencies](https://docs.adyen.com/account/supported-currencies), [platforms country availability](https://docs.adyen.com/platforms/)) |
| **PayPal** | Business accounts supported in a long country list (REST APIs list, developer country codes); product availability (wallet, Pay Later, Venmo, card brands) differs per country | India listed among supported REST countries; specific products vary | [developer.paypal.com/reference/country-codes](https://developer.paypal.com/reference/country-codes) (page dated 2026-10-02), [developer.paypal.com/expanded/eligibility](https://developer.paypal.com/expanded/eligibility) (37 countries / 22 currencies for Expanded Checkout) |
| **Razorpay** | **India, Malaysia, Singapore, USA** (docs country selector); core payment-gateway onboarding is built around Indian entities (PAN/GST/CKYC); international card collection aimed at Indian businesses | **Primary market** — Indian registration required for the standard gateway ("only Indian companies can register" for the India product; separate regional entities for SG/MY/US) | [razorpay.com/docs/payments/faqs](https://razorpay.com/docs/payments/faqs), [razorpay.com/docs/payments/set-up](https://razorpay.com/docs/payments/set-up), [razorpay.com/docs/llms.txt](https://razorpay.com/docs/llms.txt) |
| **Cashfree** | **Business must be registered in India** ("Does my business need to be registered in India? Yes…"); cross-border collection (170+ countries, 140+ currencies) settles in INR for Indian merchants | **India-only merchant onboarding** | [cashfree.com/docs/help/onboarding-related/onboarding-faqs](https://www.cashfree.com/docs/help/onboarding-related/onboarding-faqs), [cashfree.com/international-payment-gateway/](https://www.cashfree.com/international-payment-gateway/) |

### Takeaways for a *global* OpenShop

- A single provider cannot serve every merchant jurisdiction. India-registered
  merchants realistically choose **Razorpay/Cashfree** (domestic) or
  **Stripe (invite-only)**; US/EU merchants choose **Stripe/Adyen/PayPal**.
- Provider availability must therefore be a **region/merchant-country scoped
  configuration**, not a global constant — this is exactly why OpenShop's
  checkout must keep fetching the provider list from the backend per region
  (verified existing behavior: `GET /store/payment-providers?region_id=`).

## 2. Capability comparison (provider-level, from official docs)

| Capability | Stripe | Adyen | PayPal | Razorpay | Cashfree |
| --- | --- | --- | --- | --- | --- |
| Official Medusa provider in this repo's version | **Yes — `@medusajs/payment-stripe@2.21.2` (installed)** | No | No | No | No |
| Test/sandbox mode | Test keys (`sk_test_…`) | Test API key + Customer Area | Sandbox REST app | Test mode keys | Test keys + sandbox URL (`sandbox.cashfree.com`) |
| Card payments | Yes | Yes | Yes (Expanded Checkout) | Yes | Yes |
| Local methods (examples) | iDEAL, Bancontact, Blik, OXXO, PromptPay, Pix, UPI (customer in India), etc. (see payment-method-support table) | SEPA, iDEAL, Klarna, Pix, UPI (India), etc. per country | Wallet, Pay Later, Venmo (US), local bank redirects per country | UPI, netbanking, wallets, EMI, pay-later (India-centric) | UPI, netbanking, wallets, EMI, pay-later (India-centric) |
| Webhooks | Signed webhooks (HMAC via `stripe-signature`; raw body required) | HMAC-signed webhooks per endpoint | Webhook ID + signature verification | Signed webhooks (verify signature per docs) | Signed webhooks (verify per docs) |
| Refunds | Full + partial; async possible | Full + partial | Full + partial (method-dependent windows, e.g. 180 days) | Full + partial | Full + partial |
| 3DS / SCA | Yes (Stripe handles; redirects need webhook updates) | Yes (exemption/SCA logic) | Yes (PSD2 note in docs) | Yes (India 3DS/RBI) | Yes |
| Currency handling | 135+ presentment currencies | Per acquiring region/settlement currency | Per-country currency sets (e.g. 22 in Expanded Checkout) | INR + international cards | 140+ currencies for cross-border, settles INR |
| Delayed/pending methods | Yes (async payment method types) | Yes | Yes | Yes | Yes |

**Never assume identical feature support across providers.** Each adapter must
declare per-operation support (supported / unsupported / conditionally
supported / provider-specific) in the contract suite — see
`G2_PAYMENT_ARCHITECTURE_AUDIT.md` §6.

## 3. Adapter architecture requirements (derived)

1. **Medusa Payment Module is the only payment engine.** Future providers are
   added as Medusa payment providers (`AbstractPaymentProvider` implementations
   or official `@medusajs/payment-*` packages), registered in
   `medusa-config.ts`. No parallel engine, no duplicate abstraction layer over
   Medusa.
2. **Provider-specific configuration stays in module options / env** (e.g.
   `apiKey`, `webhookSecret`), validated at startup; never in core commerce
   logic, never in the admin/frontend bundles.
3. **Region-scoped availability:** the provider list served to checkout is
   fetched per region already; OpenShop will additionally document per-provider
   merchant-country eligibility (this matrix).
4. **Webhook verification is per-provider** and runs through Medusa's payment
   webhook routing (`PaymentModuleService.getWebhookActionAndData`), with raw
   body where the provider requires it.
5. **Provider references** (payment intent/session ids) are stored by Medusa's
   payment module; reconciliation compares them against the provider API.
6. **Safe removal/disabling:** unregistering a provider in config removes it
   from new sessions; historical orders keep their stored provider references
   (no data deletion).
7. **Test/live separation:** provider mode is explicit (`live` disabled
   throughout G2); the simulator can never be registered as a real provider.

## 4. Reference-provider decision

- **Stripe = first reference integration** (user decision), using the official
  `@medusajs/payment-stripe@2.21.2` shipped with the installed Medusa 2.21.2 —
  pinned at the exact version already resolved in `pnpm-lock.yaml`.
- Justification: official support (no custom payment-processing code), full
  lifecycle + signed webhooks + indeterminate-error semantics already
  implemented by Medusa, storefront already carries the Stripe JS SDKs, and the
  `pp_stripe_stripe` container id already matches storefront predicates.
- India caveat is documented (invite-only) — Stripe is not presented as the
  universal option for Indian merchants; Razorpay/Cashfree are the future
  India-eligible candidates, both currently **unimplemented** (no adapter, no
  claims).

## 5. Not evaluated to production depth (honesty note)

Pricing, settlement timelines, dispute/chargeback flows and KYC requirements
were **not** audited to contract depth — they require provider account access
that does not exist. The matrix above is capability/eligibility orientation
only, sourced from public official docs on the stated date.
