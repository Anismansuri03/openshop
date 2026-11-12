# OpenShop ↔ Shopify Capability Parity Matrix

Date: 2026-10-27 · HEAD `ef47115` · evidence base: `docs/PRODUCT_AUDIT.md` (same session).

**How to read this.** Shopify is used strictly as a *comparison target* — the capability list of a mature hosted commerce platform. This document does **not** claim affiliation with Shopify, does not claim current parity, and no proprietary Shopify code, assets, or branding are used. Shopify column = what the hosted product does at a category level (general public knowledge, not copied material). OpenShop column = only what this repository actually has, per audit evidence labels ([RUN] executed / [SRC] read in source / [FRAMEWORK] Medusa framework behaviour / [NOT RUN] not executed).

**Status key:** ✅ present-and-evidenced · 🟡 partial · ❌ missing · 🔌 depends on Medusa or a third-party provider (not wired today).

Each row ends with a **measurable acceptance test** — a pass/fail check that can be executed, not an aspiration.

---

## 1. Store creation and onboarding

| | |
| --- | --- |
| **Shopify target** | Hosted signup → store live in minutes; guided setup; no server ops. |
| **OpenShop has** | Documented PowerShell quick-start: install → create DB → env templates → `medusa db:migrate` (auto-seeds region/channel/products/key) → admin user → `local-dev.ps1 start` [SRC/DOC]; Windows-native, no Docker [DOC]. CI proves frozen install on Linux [DOC]. |
| **Missing** | One-command installer; non-Windows first-class path (bash documented but secondary); interactive env generator; any hosted option. |
| **Dependency** | Medusa CLI (`db:migrate`, `user`) [FRAMEWORK]; local PostgreSQL is operator-provided. |
| **Acceptance test** | Fresh `git clone` on a clean machine + documented steps → backend `/health` 200, admin login works, storefront loads with seeded catalog, **without editing any file not listed in the README**. (Executed in Stage 5 of this sprint.) |

## 2. Storefront, themes and content management

| | |
| --- | --- |
| **Shopify target** | Theme store, drag-and-drop theme editor, CMS pages/blogs, OS 2.0 sections. |
| **OpenShop has** | One distinctive Next.js storefront: locale routing, hero/campaign/featured rails hardcoded in components [SRC]; 6 verified screenshots `docs/screenshots/` [RUN]; dynamic OG/twitter images [SRC]. |
| **Missing** | Theme system, visual editor, CMS/blogs, editable content (audit M-class gap; ROADMAP lists content-as-data as future [DOC]). |
| **Dependency** | Next.js; a CMS (Sanity/Contentful etc.) would be a third-party optional dependency — none added. |
| **Acceptance test** | Merchant can change homepage hero copy **without editing source**, and the change renders after reload. Today: fails (content is code) → tracked as P2. |

## 3. Products, variants, catalogues, pricing and promotions

| | |
| --- | --- |
| **Shopify target** | Variants (up to 2000 combinations), price lists, markets pricing, discounts/codes/gift cards, metafields. |
| **OpenShop has** | Full product/variant/collection/category/tag model via Medusa [SRC]; deterministic 54-product demo seed, rerun-safe [SRC]; inventory levels seeded + idempotent re-seed script [SRC]; 12/13 unit tests around variant logic [RUN]; admin CRUD via stock dashboard [FRAMEWORK]. |
| **Missing** | Promotions/discount engine usage (zero promotion code in repo) [SRC]; price lists not configured; bulk import UI. Metafields exist in Medusa but unused. |
| **Dependency** | Medusa `promotion` module ships unused [FRAMEWORK]; bulk editor would be repo work. |
| **Acceptance test** | Create a product with 2 options (8 variants) in admin → visible on storefront with correct prices; create a 10% discount code → applies at checkout and reduces order total. First half [NOT RUN this sprint], second half fails today (no promotion configured). |

## 4. Cart, checkout, payments, refunds and returns

| | |
| --- | --- |
| **Shopify target** | Hosted Checkout (Shop Pay, cards via Shopify Payments), one-page/accelerated checkout, refunds/returns/exchanges in admin. |
| **OpenShop has** | Multi-step checkout route group (address → delivery → payment → review) [SRC]; `getCheckoutStep` unit-tested [RUN]; cart flows with tested stock logic [RUN]; manual **test** provider only (`pp_system_default`) [SRC]; returns/refunds/cancellations provided by stock Medusa admin [FRAMEWORK]. |
| **Missing** | Real payment provider (Stripe etc.) — explicitly "Not wired" [DOC]; test-badge hidden in production builds (audit **H2**); zero backend tests over refund/cancel/capture. |
| **Dependency** | 🔌 Stripe/PayPal are third-party; must remain **optional** per project rules. No paid service may become a mandatory dependency. |
| **Acceptance test** | On an isolated DB: place an order with the test provider → order persisted, inventory decremented, then refund it in admin → order/payment state transitions correct, all verified by automated backend tests. |

## 5. Orders, inventory, shipping, fulfilment and tax

| | |
| --- | --- |
| **Shopify target** | Full order lifecycle, draft orders, fulfillment locations, shipping profiles/rates, automatic tax by jurisdiction, partial fulfillments. |
| **OpenShop has** | Order placement in storefront [SRC]; full admin order workflow (stock dashboard) [FRAMEWORK]; seeded stock location + fulfillment set + 2 shipping options + tax regions for 7 countries [SRC]; idempotent inventory seeding + `verify-local-state.ts` invariant checker [SRC]. |
| **Missing** | Repo-level order-state code and **tests** (H3); no reservations/stock-movement layer in repo [SRC]; no shipping-carrier integration (rates are static seeded options). |
| **Dependency** | Medusa fulfillment/tax engines [FRAMEWORK]; carriers (DHL/UPS) would be third-party. |
| **Acceptance test** | Automated: create cart → add variant → select shipping → place order → assert `fulfillment_status`, tax line, shipping line, and `stocked_quantity` decremented exactly once; then cancel → stock restored. None exists today → P0/P1. |

## 6. Customers, accounts, email and notifications

| | |
| --- | --- |
| **Shopify target** | Customer accounts, segmentation, transactional + marketing email (Shopify Email), abandoned-cart automation. |
| **OpenShop has** | Register/login/email-verification/address CRUD/order history in storefront [SRC]; guest checkout path [DOC]; order-transfer accept/decline routes [SRC]. |
| **Missing** | **Any deliverable email** — no notification module configured, no mail env vars [SRC]; no segmentation; no marketing automation; verification mails are requested but undelivered. |
| **Dependency** | 🔌 SendGrid/Postmark/Resend (third-party, optional) or Medusa's local file notification provider for dev. |
| **Acceptance test** | Configure a dev notification provider → register a customer → verification email lands (or is written to the dev provider's sink) → assert delivery; order confirmation emitted on placement. Blocked today on provider choice → P1. |

## 7. Analytics, SEO and marketing

| | |
| --- | --- |
| **Shopify target** | Built-in analytics/reports, live view, SEO fields + auto sitemap, discounts as marketing, integrations. |
| **OpenShop has** | Per-page metadata + OG images [SRC]; verified screenshots [RUN]; catalog/feed-free basics. |
| **Missing** | Sitemap/robots entirely (dead `next-sitemap` config, audit M11) [SRC]; all analytics (OTel commented out) [SRC]; marketing channels. |
| **Dependency** | Sitemap = repo work only; analytics = optional third-party (Plausible/GA) — must stay optional. |
| **Acceptance test** | `GET /sitemap.xml` and `/robots.txt` return 200 with correct references, and product URLs in the sitemap return 200. Fails today → P1. |

## 8. Staff, roles and permissions

| | |
| --- | --- |
| **Shopify target** | Staff accounts with granular permission sets (8+ predefined roles), store-associate plans. |
| **OpenShop has** | Single admin users created via CLI `medusa user` [SRC]; Medusa ships RBAC endpoints + `check-permissions` middleware — unused [FRAMEWORK]. |
| **Missing** | Any role/permission enforcement in repo (audit M10); no staff UI usage; no audit log. |
| **Dependency** | Medusa RBAC [FRAMEWORK] — no new dependency needed. |
| **Acceptance test** | Create a limited role (orders read-only) → its JWT receives an order-write request → 403; full admin → 200. Fails today (no policies configured) → P1. |

## 9. Multiple regions, currencies and sales channels

| | |
| --- | --- |
| **Shopify target** | Markets: many countries/currencies/languages on one store, duties/taxes per market. |
| **OpenShop has** | 1 region with 7 EU countries, currency-agnostic cart plumbing, publishable API keys, middleware country resolution (URL → geo header → default) [SRC]; sales channel seeded [SRC]. |
| **Missing** | Multiple currencies in one region, multi-region storefront selection UI beyond country select, duties/customs, per-market catalogs. |
| **Dependency** | Medusa regions/currencies [FRAMEWORK]. |
| **Acceptance test** | Add a second region + currency → storefront shows converted prices and checkout completes in that currency with correct totals. Partially plausible today; untested [NOT RUN]. |

## 10. Import, export and migration

| | |
| --- | --- |
| **Shopify target** | CSV product/order import-export, Shopify → platform importers, admin export of nearly everything. |
| **OpenShop has** | Framework CSV export endpoints for orders/products/inventory-items [FRAMEWORK] (unexecuted [NOT RUN]); deterministic seeds as an import substitute [SRC]. |
| **Missing** | Import tooling of any kind, Shopify-catalog migration guide, verified export flow, backup/restore (audit M8). |
| **Dependency** | Export = Medusa [FRAMEWORK]; Shopify import = repo build on their public CSV format (no proprietary code). |
| **Acceptance test** | Export products CSV from admin → re-import into a fresh DB → product count and a spot-checked price match. Blocked today: no importer → P2. |

## 11. Plugins, integrations, APIs and webhooks

| | |
| --- | --- |
| **Shopify target** | App Store (thousands of apps), Admin/Storefront APIs, webhooks with signed payloads, custom apps. |
| **OpenShop has** | Medusa's full REST/store API [FRAMEWORK]; file-based custom routes + middleware pattern documented (`src/api/README.md`) [SRC]; publishable-key auth [FRAMEWORK]; inbound generic payment hook [FRAMEWORK]. |
| **Missing** | Outbound webhooks and signature verification (none configured — audit §5.3); any custom module/workflow example to copy (all extension dirs README-only); API versioning policy; plugin docs beyond boilerplate. |
| **Dependency** | Medusa event bus + module system [FRAMEWORK]; no marketplace can be assumed. |
| **Acceptance test** | Emit an order-created webhook to a local receiver → receiver verifies HMAC signature and rejects a tampered body (401). Fails today: feature absent → P1. |

## 12. Security, backup, upgrades, deployment and support

| | |
| --- | --- |
| **Shopify target** | PCI-DSS Level 1 hosting, automatic backups, forced upgrades, 24/7 support, bug bounty. |
| **OpenShop has** | SECURITY.md + private reporting workflow + issue templates [RUN]; CI gates (lint/tsc/test/build) [SRC]; publishable-key + admin session auth [FRAMEWORK]; git hygiene verified (no secrets/DBs tracked) [RUN]; rerun-safe scripts [SRC]. |
| **Missing** | Backup/restore tooling and docs; upgrade guide/changelog/versioning; rate limiting (M6); secret redaction (M5); env validation (M7); production hardening guide; 20 high dependency advisories (M4); support channel (GitHub Discussions enabled [DOC]). |
| **Dependency** | Self-hosting implies the operator owns TLS/DB/backups/PCI scope — stated in README [DOC]. Real payments would pull in a PCI-relevant third party. |
| **Acceptance test** | (a) tampered webhook/admin request rejected; (b) `pg_dump` + restore procedure documented and drill succeeds into a fresh DB with row counts matching; (c) `pnpm audit --prod` high-severity count reduced or individually triaged. (a) partially framework-proven [FRAMEWORK], (b)(c) fail today. |

## 13. B2B, subscriptions, digital products and POS

| | |
| --- | --- |
| **Shopify target** | Shopify Plus B2B (company catalogs, price lists, payment terms), Selling Plans (subscriptions), digital goods, POS retail hardware. |
| **OpenShop has** | Nothing in any of these four areas [SRC]. Price lists exist in the stock dashboard [FRAMEWORK] but are unconfigured. |
| **Missing** | All four. |
| **Dependency** | Medusa has some building blocks (price lists, gift-card module) [FRAMEWORK]; B2B/subscriptions/POS would be large builds or third-party. |
| **Acceptance test** | Deferred by design — per project rules, large features get a documented design + acceptance tests instead of stubs. Any B2B/subscription work starts with a design doc (P4). |

---

## Summary

| Category | Status today | Fastest path to next level |
| --- | --- | --- |
| 1 Onboarding | 🟡 documented, manual | Stage-5-verified clean install; one-command script |
| 2 Storefront/themes | 🟡 one hardcoded theme | content-as-data (P2) |
| 3 Catalog/pricing/promo | 🟡 catalog strong, promos absent | wire Medusa `promotion` module + test |
| 4 Checkout/payments | 🟡 test-only payments, badge bug | fix H2 + backend checkout tests |
| 5 Orders/shipping/tax | 🟡 framework-complete, untested | order-lifecycle integration tests |
| 6 Customers/email | 🔌 accounts yes, no delivery | optional dev mail provider |
| 7 Analytics/SEO | 🟡 metadata only | sitemap/robots (cheap, P1) |
| 8 Staff/roles | ❌ | enable Medusa RBAC policies |
| 9 Regions/currencies | 🟡 one region, 7 countries | multi-currency test |
| 10 Import/export | 🔌 export exists, unverified | verify export + document |
| 11 APIs/webhooks | 🟡 API strong, no outbound webhooks | signed webhook + test |
| 12 Security/ops | 🟡 auth solid, ops thin | redaction, rate limit, backup doc |
| 13 B2B/subscriptions/POS | ❌ | design doc first (P4) |

No row above may be reported as "parity achieved"; six categories are partial on borrowed Medusa capability, four are missing outright, and every acceptance test that has not been executed is marked as such.
