import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

/**
 * Regression test for finding F1 (Sprint 2, PRODUCT_AUDIT.md §4 / STAGE5_JOURNEY.md):
 * the documented clean install seeds seven tax REGIONS but zero tax RATES, so a
 * checkout silently computes `tax_total = 0` and writes no tax lines. The fix is
 * a documented configuration step (add a rate per region). This suite proves that
 * once a rate is explicitly configured, the store checkout computes the correct
 * tax lines and order total — i.e. the calculation engine is sound and only the
 * seeded configuration was missing.
 *
 * Fixtures: the disposable database is pre-migrated with the app's own
 * documented clean-install step (`medusa db:migrate`), which seeds the region,
 * tax regions, products, publishable key, shipping options, and inventory. The
 * suite applies only the MISSING step (a tax rate) and exercises the public
 * store checkout. See docs/local-development.md for the two-step run:
 * pre-migrate the named database, then `pnpm run test:integration:http`.
 *
 * Isolation: `medusaIntegrationTestRunner` reuses the pre-migrated database
 * derived from the DB_* environment variables (NOT DATABASE_URL), boots the app
 * on an ephemeral port, and drops the database afterwards. It never touches the
 * developer's configured DATABASE_URL database.
 *
 * Per-test data: the runner snapshots the database after the suite's
 * beforeAll and RESTORES that snapshot before every subsequent test (its
 * beforeEach hooks run pg_terminate_backend + drop/recreate from the
 * template). Data created inside one test is therefore wiped before the
 * next. Each test here runs its own complete checkout through the shared
 * `completeCheckout()` helper instead of relying on state left behind by a
 * previous test.
 */

const VAT_RATE = 19
const VARIANT_SKU = "SHIRT-S-WHITE"
const EXPECTED_ITEM_TAX = 1.9 // 10 * 0.19
const EXPECTED_SHIPPING_TAX = 1.9 // 10 * 0.19
const EXPECTED_TAX_TOTAL = 3.8 // 1.90 + 1.90
const EXPECTED_TOTAL = 23.8 // 10 + 10 + 3.80

/**
 * Numeric values (tax rates, totals) come back from module-level queries as
 * Medusa BigNumber instances (they only look like plain numbers after JSON
 * serialization), so coerce to a finite number before comparing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numOf(value: any): number {
  const direct = Number(value)
  if (Number.isFinite(direct)) {
    return direct
  }
  return Number(value?.value ?? value?.raw?.value ?? NaN)
}

medusaIntegrationTestRunner({
  dbName: "openshop_sprint3_tax_regression",
  testSuite: ({ api, getContainer }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let container: any
    let publishableKey: string
    let regionId: string
    let variantId: string

    beforeAll(async () => {
      container = getContainer()

      // Apply the MISSING configuration step explicitly, through the
      // supported tax module service (fastest path here; the merchant-path
      // variant via the admin API is covered by tax-configuration.spec.ts).
      // The seed created tax regions for seven countries but no rates
      // (finding F1).
      const taxModule = container.resolve(Modules.TAX)
      const deTaxRegions = await taxModule.listTaxRegions({
        country_code: "de",
      })
      expect(deTaxRegions.length).toBeGreaterThan(0)
      await taxModule.createTaxRates([
        {
          name: "VAT",
          rate: VAT_RATE,
          code: "VAT",
          is_default: true,
          tax_region_id: deTaxRegions[0].id,
        },
      ])

      // Publishable key required by the store API boundary.
      const apiKeyModule = container.resolve(Modules.API_KEY)
      const publishableKeys = await apiKeyModule.listApiKeys({
        type: "publishable",
      })
      expect(publishableKeys.length).toBeGreaterThan(0)
      publishableKey = publishableKeys[0].token

      // Region + a published variant to purchase.
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: regions } = await query.graph({
        entity: "region",
        fields: ["id"],
      })
      regionId = regions[0].id

      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: ["id", "sku"],
        filters: { sku: VARIANT_SKU },
      })
      expect(variants.length).toBe(1)
      variantId = variants[0].id
    }, 180000)

    /**
     * Runs a full store checkout and returns the raw completion payload.
     *
     * IMPORTANT: the runner snapshots the database after the suite's
     * beforeAll and RESTORES it before every subsequent test (its beforeEach
     * calls pg_terminate_backend + drop/recreate from the template). Data
     * created inside one test is therefore wiped before the next one — every
     * test that needs an order must call this helper itself.
     */
    async function completeCheckout() {
      const headers = { "x-publishable-api-key": publishableKey }

      const { data: cartCreated } = await api.post(
        "/store/carts",
        { region_id: regionId },
        { headers }
      )
      const cartId = cartCreated.cart.id

      await api.post(
        `/store/carts/${cartId}/line-items`,
        { variant_id: variantId, quantity: 1 },
        { headers }
      )

      const address = {
        first_name: "Tax",
        last_name: "Tester",
        address_1: "Teststrasse 1",
        postal_code: "10115",
        city: "Berlin",
        country_code: "de",
        province: "BE",
        phone: "+490000000000",
      }
      await api.post(
        `/store/carts/${cartId}`,
        {
          email: "tax.tester@example.com",
          shipping_address: address,
          billing_address: address,
        },
        { headers }
      )

      const { data: options } = await api.get(
        `/store/shipping-options?cart_id=${cartId}`,
        { headers }
      )
      const standard = options.shipping_options.find((o: any) =>
        o.name.includes("Standard")
      )
      expect(standard).toBeTruthy()
      await api.post(
        `/store/carts/${cartId}/shipping-methods`,
        { option_id: standard.id },
        { headers }
      )

      const { data: pcCreated } = await api.post(
        "/store/payment-collections",
        { cart_id: cartId },
        { headers }
      )
      await api.post(
        `/store/payment-collections/${pcCreated.payment_collection.id}/payment-sessions`,
        { provider_id: "pp_system_default" },
        { headers }
      )

      const { data: completion } = await api.post(
        `/store/carts/${cartId}/complete`,
        {},
        { headers }
      )
      return completion
    }

    it("computes the correct tax and order totals when a rate is explicitly configured", async () => {
      const completion = await completeCheckout()

      expect(completion.type).toBe("order")
      const order = completion.order
      expect(order.status).toBe("pending")
      expect(order.currency_code).toBe("eur")

      // Tax math: 19% on the 10.00 item + 10.00 shipping = 1.90 + 1.90 = 3.80.
      expect(order.item_tax_total).toBeCloseTo(EXPECTED_ITEM_TAX, 2)
      expect(order.shipping_tax_total).toBeCloseTo(EXPECTED_SHIPPING_TAX, 2)
      expect(order.tax_total).toBeCloseTo(EXPECTED_TAX_TOTAL, 2)
      // Total = items (10) + shipping (10) + tax (3.80) = 23.80.
      expect(order.total).toBeCloseTo(EXPECTED_TOTAL, 2)
    }, 120000)

    it("persists matching tax lines on the order for both items and shipping", async () => {
      const completion = await completeCheckout()
      expect(completion.type).toBe("order")
      const order = completion.order

      // Persisted tax lines on the stored order. Note: raw remote-query
      // `fields` use plain relation paths here — the `*items.tax_lines`
      // expansion syntax belongs to the HTTP query-config layer and is
      // SILENTLY DROPPED by query.graph (verified empirically against an
      // order that has tax lines: the returned object then lacks `items`
      // entirely).
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: orders } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "tax_total",
          "items",
          "items.tax_lines",
          "shipping_methods",
          "shipping_methods.tax_lines",
        ],
        filters: { id: order.id },
      })
      expect(orders.length).toBe(1)
      const storedOrder = orders[0]

      const itemTaxLines = (storedOrder.items ?? []).flatMap(
        (li: any) => li.tax_lines ?? []
      )
      expect(itemTaxLines.length).toBeGreaterThan(0)
      for (const line of itemTaxLines) {
        expect(numOf(line.rate)).toBeCloseTo(VAT_RATE, 2)
        expect(line.code).toBe("VAT")
      }

      const shippingTaxLines = (storedOrder.shipping_methods ?? []).flatMap(
        (sm: any) => sm.tax_lines ?? []
      )
      expect(shippingTaxLines.length).toBeGreaterThan(0)
      for (const line of shippingTaxLines) {
        expect(numOf(line.rate)).toBeCloseTo(VAT_RATE, 2)
        expect(line.code).toBe("VAT")
      }

      expect(numOf(storedOrder.tax_total)).toBeCloseTo(EXPECTED_TAX_TOTAL, 2)
    }, 120000)
  },
})
