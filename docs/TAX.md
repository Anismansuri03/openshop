# Tax Configuration

This guide explains how to configure taxes for an OpenShop store, what the
storefront does automatically once rates are configured, and — just as
importantly — what it does **not** do.

> **This is configuration documentation, not tax or legal advice.** OpenShop
> computes and records the numbers you configure. Deciding *which* rates
> apply to your business, your products, and your customers' locations — and
> registering for tax IDs, filing returns, or charging marketplace/platform
> taxes — is entirely your responsibility as the merchant. No part of this
> system registers you for tax anywhere or certifies compliance with any
> country's rules.

## TL;DR

A clean install seeds **tax regions** (one per country in the default
region) but **zero tax rates**. Until you add at least one rate, checkout
charges **0 tax and writes no tax lines** — on purpose. There is no
built-in default rate, because assuming one (19%? 8.875%? 0%?) would be
wrong for almost every merchant and would silently misprice every order.

Adding a rate takes one call (or a few clicks in the admin dashboard):

1. Open **Settings > Tax Regions** in the admin dashboard.
2. Select the country (e.g. Germany).
3. Add a rate (e.g. `VAT`, 19%, code `VAT`) and mark it as the
   **default** rate for that country.
4. Repeat for every country you sell to.

After that, checkout prices include the correct tax for the customer's
shipping address, tax lines are persisted on every order, and changing a
rate later affects **future orders only**.

## What the seed creates (and deliberately does not create)

`medusa db:migrate` runs `initial-data-seed.ts`, which creates:

- a **region** ("Europe") with seven countries: gb, de, dk, se, fr, es, it;
- a **tax region** per country, using the system tax provider (`tp_system`);
- **no tax rates** — and a startup warning when that is the case:

```
warn: Tax regions were seeded without any tax rates. Checkout will compute
0 tax (and write no tax lines) until a merchant configures rates in the
admin Settings > Tax Regions screen. No default tax rate is assumed.
See docs/TAX.md.
```

This is finding **F1** from Sprint 2. The warning makes the gap visible in
the logs; this document closes it operationally. A default rate is never
seeded — see the TL;DR.

## How checkout decides the rate

OpenShop uses Medusa's tax module; no separate calculation engine exists.
When a cart is priced, the tax module matches the **shipping address** to a
tax region and picks rates by these rules (all verified in
`apps/backend/integration-tests/http/tax-configuration.spec.ts`):

1. **Country match.** The address country must have a tax region. The seed
   covers the seven region countries; add more under **Settings > Tax
   Regions** if you sell elsewhere.
2. **Province override.** If a tax region exists for the address's
   province/state (e.g. a Berlin region inside Germany), its default rate
   wins over the country default.
3. **Product rules.** A rate with a product (or product-type) rule matches
   only items of that product and outranks the country default. Use this
   for reduced rates on specific categories.
4. **No match, no tax.** If the matched tax region has no applicable rate —
   or the country has no tax region — the order is computed with **0 tax
   and no tax lines**. France having a seeded tax region but no configured
   rate means French orders correctly charge 0, not "some other country's
   rate".
5. **`automatic_taxes` off.** Each region has an `automatic_taxes` toggle
   (on by default). Turning it off disables automatic tax calculation for
   that region even when rates exist — for merchants who handle tax out of
   band. The toggle is on the region screen in the admin dashboard
   (`POST /admin/regions/{id}` with `{"automatic_taxes": false}`).

Shipping is taxed by the same rules: a shipping-method-scoped rule can give
shipping its own rate; otherwise the country/province default applies to
the shipping charge as well (see the product-scoped test, where the item
was taxed 5% while shipping stayed at the 19% default).

### Rate bounds

A tax rate must be a number between **0 and 100** (percent). Requests to
the admin tax routes (`POST /admin/tax-rates`, `POST /admin/tax-regions`
with an inline default rate) that carry a negative rate, a rate above 100,
or a non-numeric value are rejected with HTTP 400 and a message naming the
accepted range and the offending value, e.g.:

```json
{ "message": "Tax rate must be between 0 and 100 (percent). Received: -5.",
  "type": "invalid_data" }
```

Omitting `rate` (or setting it to `null`) remains valid: that is how you
record a **zero-rated or exempt** line — the line exists, the rate is 0.
A reference to a non-existent tax region is rejected with 404 naming the
missing id.

This bounds check is the only tax-specific validation OpenShop adds on top
of stock Medusa; it guards the stored configuration, it does not calculate
anything.

## Prices: exclusive vs. inclusive

Two conventions exist and you must pick one **per currency/region**:

- **Tax-exclusive** (default in this seed): a 10.00 item + 10.00 shipping
  at 19% costs the customer **23.80** (tax added at checkout).
- **Tax-inclusive**: the shelf price already contains the tax; the same
  order costs **20.00** and the 19% is *extracted* from it
  (3.19 of the 20.00 is tax).

To enable tax-inclusive pricing (all through the stock admin API/dashboard):

1. Set `is_tax_inclusive: true` on the **region** (region screen in the
   dashboard). This makes **region-priced** amounts inclusive — e.g. the
   seeded shipping option's region price.
2. The store setup already created one **price preference per currency**
   (`currency_code/eur`, `currency_code/usd`). Amounts priced by currency —
   which is how the seeded product variants are priced — become inclusive
   only when the matching currency preference is inclusive. Update it:
   `POST /admin/price-preferences/{id}` with
   `{"is_tax_inclusive": true}` (or edit it via the API the dashboard
   uses).

If you skip step 2, you get a mixed state: shipping is inclusive but
product prices are not, and the totals look inconsistent. Configure both.

Changing inclusivity affects how *future* carts are priced; orders already
placed keep the totals and tax lines they were created with.

## Changing rates later

Rates can be amended at any time
(`POST /admin/tax-rates/{id}` with e.g. `{"rate": 5}`) or deleted in the
dashboard. Both behave prospectively:

- orders **already placed** keep their persisted tax lines (rate, code)
  and totals — historical records are never rewritten;
- carts completed **after** the change use the new rate.

This is covered by the "changes rates prospectively without rewriting
historical orders" test: an order placed at 19% still shows 19% and 23.80
after the rate is changed to 5%, while the next order computes 5% and
21.00.

## Where tax shows up

- **Cart and checkout**: the tax is included in the totals the customer
  sees (the storefront's cart totals and order summary render the
  `Taxes` row from the same server-computed values).
- **Order**: `tax_total`, `item_tax_total`, `shipping_tax_total` are stored
  on the order, and one tax line per applicable rate is persisted on each
  line item and shipping method (rate, code, provider, and the tax module
  rate id). These persisted rows are the source of truth for invoices and
  accounting exports.
- **Admin**: orders show their tax totals and per-item tax lines in the
  order detail screen.

All tax numbers are computed **server-side** by the tax module during cart
and order workflows. The storefront only displays them; client-submitted
tax amounts are never trusted.

## Adding tax regions for other countries

For a country outside the seeded seven:

```
POST /admin/tax-regions
{ "country_code": "us", "provider_id": "tp_system" }
```

Then add rates to it as above. For a **province-level** region (e.g. a
state with its own rate inside a country region), reference the country
region as the parent and pass an inline default rate:

```
POST /admin/tax-regions
{ "country_code": "de",
  "province_code": "BE",
  "parent_id": "<country tax region id>",
  "default_tax_rate": { "name": "VAT Berlin", "rate": 5, "code": "VAT-BE" } }
```

The province rate then outranks the country default for addresses in that
province (verified by the province-override test).

## Limitations (read before relying on this)

- **System tax provider only.** Rates are static numbers you configure.
  There is no external tax calculation service (Avalara, TaxJar, …), no
  automatic rate updates when legislation changes, and no address-level
  (city/ZIP) rate resolution. Keep rates current yourself.
- **No tax IDs, VAT numbers, B2B reverse-charge flows, or OSS/IOSS
  registration.** EU one-stop-shop reporting is not implemented.
- **No product-level tax categories.** Taxability per product is expressed
  through rate rules (product/product-type), not through tax categories
  with jurisdiction-specific mappings.
- **No tax on refunds/credits automation beyond Medusa's defaults**, no
  tax reports, no filing exports.
- **Digital-goods / place-of-supply rules** are not modeled; matching uses
  the shipping address only.
- **Mixed inclusive/exclusive states** are possible if the region toggle
  and the currency preference disagree (see "Prices" above) — configure
  both together.
- Validation of rate *plausibility* (is 19% right for this product in this
  country?) is out of scope by design; only the 0–100 bounds are enforced.

## How this is tested

- `apps/backend/integration-tests/http/tax-configuration.spec.ts` — the
  merchant path end to end: every rate/setting is created through the admin
  API exactly as an operator would, then a real store checkout is verified
  (no config = 0 tax; valid rate = correct totals; province override;
  product-scoped rate vs. shipping default; tax-inclusive extraction;
  FR address not taxed by a DE rate; invalid config rejected with clear
  400/404 errors; rate changes not retroactive; `automatic_taxes` off).
- `apps/backend/integration-tests/http/tax-calculation.spec.ts` — the
  Sprint 2 F1 regression: once a rate exists, the engine computes and
  persists the right numbers.
- `apps/backend/src/lib/__tests__/tax-rate-validation.unit.spec.ts` — unit
  tests for the 0–100 bounds middleware.
