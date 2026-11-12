# Stage 5 — Isolated Merchant-Journey Test Record

Date: 2026-10-28 · Sprint branch state: `main` @ `ef47115` + uncommitted sprint changes (see final report).
Evidence labels match `PRODUCT_AUDIT.md`: **[RUN]** executed this sprint · **[SRC]** read from source · **[NOT RUN]** not executed (reason given).

## 1. Test environment (isolation rules applied)

| Aspect | Value | Evidence |
| --- | --- | --- |
| Code under test | Full working-tree copy at `%TEMP%\opencode\openshop-journey` (excludes `.git`, `node_modules`, `.next`, `.dist` build outputs) — includes this sprint's uncommitted changes | [RUN] |
| Database | **`openshop_sprint5`** — dedicated throwaway DB created for this stage; no other database was written to | [RUN] |
| Install | `pnpm install --frozen-lockfile` → **exit 0** (proves the committed lockfile is CI-compatible) | [RUN] |
| Stack | `scripts\local-dev.ps1 start` → backend `:9000` + storefront `:8000`; both listeners verified to be running from the `openshop-journey` path (an impostor Beyond Fear stack had occupied the ports earlier and was stopped first) | [RUN] |
| Payment provider | Only `pp_system_default` installed (built-in test provider) — **no real card, no paid service** | [RUN] |
| Secrets | Written to env files outside Git; never printed; log scan below confirms none leaked | [RUN] |

## 2. Journey execution — PASS

```
python tests\e2e\e2e-journey.py   →   JOURNEY_EXIT=0
E2E RESULT: OK order_01M60XA4GB2AJVYZTTTF8KCVMY
```

Steps observed end-to-end in the Playwright run [RUN]:

| # | Step | Result |
| --- | --- | --- |
| 1 | Home page loads (`/dk`, title `Clothing, cut to last - Maison`) | 200 |
| 2 | Store listing (12 hits rendered) | OK |
| 3 | Search `hoodie` → 5 hits with real titles | OK |
| 4 | PDP `demo-2-hoodie` loads; variant selector present (`Select variant` disabled until chosen, then `Add to cart` enabled) | OK |
| 5–6 | Add to cart → cart row `Relaxed Merino Hoodie` | OK |
| 7 | Checkout address step (11 inputs incl. country select, email, `same_as_billing`) → `Continue to delivery` | OK |
| 8 | Delivery step: **2 shipping options** offered (radio buttons) → `Continue to payment` | OK |
| 9 | Payment step: 2 payment radios → `Continue to review` | OK |
| 10 | Review step renders | OK |
| 11 | **Order confirmed** → `/dk/order/order_01M60XA4GB2AJVYZTTTF8KCVMY/confirmed` | OK |

Artifacts: 13 screenshots + `result.txt` in `tests\e2e\artifacts\` (git-ignored) [RUN].

## 3. Database effects verified (all in `openshop_sprint5`) [RUN]

| Check | Result |
| --- | --- |
| Order rows | **exactly 1** (`display_id=1`), status `pending` → later `canceled`, email `e2e.buyer@example.com`, currency `eur`, region set |
| Shipping address | `dk / Copenhagen / 2100`, name `E2E Buyer` (fake data) |
| Line item | `Relaxed Merino Hoodie` ×1, `variant_01M5YT1TD040X1XC7S2CMH41K0`, handle `demo-2-hoodie`, unit price 40 |
| Shipping line | `Standard Shipping` amount **10** |
| Totals | `order_summary`: original/current order total **50** (40 + 10), `paid_total 0`, `pending_difference 50` |
| Tax lines | **0 rows — see finding F1 below** |
| Inventory hold | `reservation_item` qty **1** created 0.3 s after the order, pointing at the ordered line item + stock location; the ordered variant showed `reserved=1` while **all 11 sibling variants stayed `reserved=0`, `stocked=10`** |
| Payment | payment collection `authorized` amount 50 / captured 0; single `payment` row via **`pp_system_default`** (test provider) |
| Cancellation (admin API) | `POST /admin/orders/{id}/cancel` with Bearer token → **200**, order `status=canceled`, `canceled_at` set |
| Inventory release | after cancel: `reserved_quantity` back to **0**; reservation row **soft-deleted** (`deleted_at` set) — hold released correctly |

## 4. API / authorization checks [RUN]

| Check | Result |
| --- | --- |
| `GET /health` | 200 |
| Storefront home title | `Clothing, cut to last - Maison` (correct stack) |
| `GET /store/custom` with `x-publishable-api-key` | 200 |
| `GET /store/regions` with key | 200, count 1 |
| `GET /store/products?limit=100` with key | 200, count 54 |
| `GET /store/regions` with bogus key | **400** (publishable-key boundary enforced) |
| `GET /admin/custom` anonymous | **401** (authz boundary enforced) |
| Admin login `POST /auth/user/emailpass` | 200 → Bearer token (see F2) |
| `GET /admin/products?limit=5`, `/admin/orders`, `/admin/custom`, `/admin/customers` with Bearer | all **200** |
| CSV export `POST /admin/orders/export` and `/admin/products/export` | **202** + `transaction_id`; async workflow produced files delivered by the `local` notification provider; downloads: orders CSV 200/0 bytes (0 orders at the time — correct), **products CSV 200, 443,047 bytes, 441 rows incl. header** with real catalog data |

## 5. Seed / migration idempotency (H1 fix proven live) [RUN]

- `db:migrate` run 1 seeded baseline (`store 1, region 1, product 4, variant 20, shipping 2, api_key 1, inv_level 20`); runs 2 and 3 → exit 0, no duplicate rows.
- Manual re-run of the initial-data seed → exit 0 with guard message `Initial data seed already applied — skipping`, counts unchanged (the `initial-seed-guard.ts` fix works at runtime, not just in unit tests).
- Demo seed → 54 products; inventory seed → `items=440 levels=20 → create=420`; root `backend:seed` re-run → `Every demo product already exists. Nothing to do.`

## 6. Secret-leak scan [RUN]

Searched `storefront.out.log`, `backend.out.log`, `storefront.err.log`, `backend.err.log` for 7 secret classes (admin Bearer token, admin password, DB password from both env files, `REDIS_URL`, `JWT_SECRET`, `COOKIE_SECRET`):

**28/28 searches → 0 hits.** No credential material in runtime logs.

## 7. NOT RUN (with reasons)

| Item | Reason |
| --- | --- |
| **Payment-failure path** | Only `pp_system_default` is installed and it always authorizes; Medusa 2.21 core ships no intentionally-failing test provider. Injecting a failure would require code changes beyond this sprint's bounded scope. |
| **Tax calculation with rates** | See F1 — zero tax rates exist in the seed, so checkout correctly produced 0 tax lines; the taxed path was therefore never exercised. |
| Capture / refund / fulfillment / return flows | Order was left `pending` then canceled on purpose; exercising capture+fulfillment would mutate stock for real and needs a dedicated fixture plan (roadmap P2). |
| E2E in CI | Not wired (roadmap P3-5); CI still has no DB service. |
| Beyond Fear E2E comparison | Explicitly skipped this sprint per instructions. |

## 8. Findings raised from this stage

- **F1 — no tax rates configured anywhere** (`tax_rate` table empty, 7 tax regions exist): checkout computes `tax_total = 0` and writes no tax lines. Shopify computes tax by default, so this is a real parity/data gap → recorded in `PRODUCT_AUDIT.md` §4 and roadmap.
- **F2 — admin login endpoint is `/auth/user/emailpass`, not `POST /admin/auth`**: the latter always returns `{"message":"Unauthorized"}` even with valid credentials (it is a different session route in Medusa 2.21). Documented so future testers do not misread it as a credential bug.
- **F3 — upstream `db:migrate` swallows the seed-runner exit code**: `migrate.js` does not propagate the child exit code for `db:migrate:scripts` (unlike its search variant), so a run that prints `Failed to load migration script … No default export found` still exits 0. Recorded in `PRODUCT_AUDIT.md` §3 and roadmap P1.
