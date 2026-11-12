import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

/**
 * G3 merchant tax configuration suite (openshop-master-roadmap.md G3).
 *
 * While tax-calculation.spec.ts proves the ENGINE is sound once a rate exists
 * (F1 regression), this suite walks the MERCHANT path end to end: every rate
 * and setting is applied exactly the way an operator does it — through the
 * stock admin HTTP API (`POST /admin/tax-rates`, `POST /admin/tax-regions`,
 * `POST /admin/regions/{id}`) — and then the public store checkout is verified
 * to consume that configuration. It covers the roadmap G3 test matrix:
 *
 *  - no tax configuration        -> 0 tax, no tax lines written
 *  - a valid configured rate     -> correct item/shipping/order totals
 *  - multiple rates              -> product-scoped rate beats the country
 *                                   default; shipping keeps the default
 *  - province override           -> province tax-region rate beats the
 *                                   country default rate
 *  - inclusive pricing           -> tax extracted from the gross price, the
 *                                   shelf price is NOT marked up at checkout
 *  - shipping tax                -> shipping methods are taxed by the same
 *                                   configured rates
 *  - address/region matching     -> a DE rate is NOT applied to an FR address
 *                                   (no universal rate is assumed anywhere)
 *  - missing/invalid config      -> understandable 400/404 errors instead of
 *                                   silently storing a nonsense rate
 *  - tax changes                 -> prospective only; historical orders keep
 *                                   their persisted tax lines and totals
 *  - automatic_taxes off         -> region switch disables automatic tax
 *
 * Nothing here configures a default rate on the merchant's behalf: the seed
 * deliberately creates tax regions WITHOUT rates and logs a warning
 * (initial-data-seed.ts), and every rate in this suite is created explicitly
 * by the "merchant" (the admin API) before checkout. Configuration is not tax
 * or legal advice — see docs/TAX.md.
 *
 * Isolation: `medusaIntegrationTestRunner` creates the named disposable
 * database from the DB_* environment variables (never DATABASE_URL), boots the
 * full app (admin HTTP API included) on an ephemeral port, and drops the
 * database afterwards. The documented two-step run is in
 * docs/local-development.md: pre-migrate the named database, then run
 * `pnpm run test:integration:http`.
 *
 * Per-test data: the runner snapshots the database after the suite's
 * beforeAll and RESTORES it before every test, so each `it()` is
 * self-contained: it configures its own rates and runs its own checkout via
 * `completeCheckout()`.
 */

const VAT_RATE = 19
const REDUCED_RATE = 5
const VARIANT_SKU = "SHIRT-S-WHITE"

// Exclusive-mode tax math on a 10.00 item + 10.00 Standard Shipping.
const EXCLUSIVE_ITEM_TAX = 1.9 // 10 * 0.19
const EXCLUSIVE_SHIPPING_TAX = 1.9
const EXCLUSIVE_TAX_TOTAL = 3.8 // 1.90 + 1.90
const EXCLUSIVE_TOTAL = 23.8 // 10 + 10 + 3.80
const ZERO_TAX_TOTAL = 20 // 10 + 10 + 0

/**
 * Numeric values come back from module-level queries as Medusa BigNumber
 * instances (they only look like plain numbers after JSON serialization), so
 * coerce to a finite number before comparing.
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
  dbName: "openshop_g3_tax_config",
  testSuite: ({ api, getContainer }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let container: any
    let adminToken: string
    let publishableKey: string
    let regionId: string
    let variantId: string
    let productId: string
    let deTaxRegionId: string

    beforeAll(async () => {
      container = getContainer()

      // --- Admin (merchant) session, created exactly like `medusa user` +
      // a dashboard login: user workflow -> emailpass registration ->
      // identity link -> token via the public auth route. ---
      const workflowService = container.resolve(Modules.WORKFLOW_ENGINE)
      const authService = container.resolve(Modules.AUTH)
      const email = "g3-admin@test.com"
      const password = "supersecret"

      const { result: users } = await workflowService.run(
        "create-users-workflow",
        { input: { users: [{ email }] } }
      )
      const user = users[0]
      expect(user?.id).toBeTruthy()
      const { authIdentity, error } = await authService.register("emailpass", {
        body: { email, password },
      })
      expect(error).toBeFalsy()
      await authService.updateAuthIdentities({
        id: authIdentity!.id,
        app_metadata: { user_id: user.id },
      })
      const login = await api.post("/auth/user/emailpass", { email, password })
      adminToken = login.data?.token
      expect(adminToken).toBeTruthy()

      // --- Store fixtures seeded by the documented clean install. ---
      const apiKeyModule = container.resolve(Modules.API_KEY)
      const publishableKeys = await apiKeyModule.listApiKeys({
        type: "publishable",
      })
      expect(publishableKeys.length).toBeGreaterThan(0)
      publishableKey = publishableKeys[0].token

      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: regions } = await query.graph({
        entity: "region",
        fields: ["id"],
      })
      regionId = regions[0].id

      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: ["id", "sku", "product_id"],
        filters: { sku: VARIANT_SKU },
      })
      expect(variants.length).toBe(1)
      variantId = variants[0].id
      productId = variants[0].product_id

      // The clean-install seed creates tax regions (one per country) but no
      // rates — that gap is finding F1 and is asserted by test 1 below.
      const taxModule = container.resolve(Modules.TAX)
      const deTaxRegions = await taxModule.listTaxRegions({
        country_code: "de",
      })
      expect(deTaxRegions.length).toBeGreaterThan(0)
      deTaxRegionId = deTaxRegions[0].id
    }, 180000)

    function adminHeaders() {
      return { Authorization: `Bearer ${adminToken}` }
    }

    /** Creates a tax rate through the admin API (the merchant path). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function createTaxRate(body: Record<string, any>) {
      const { data } = await api.post("/admin/tax-rates", body, {
        headers: adminHeaders(),
      })
      expect(data?.tax_rate?.id).toBeTruthy()
      return data.tax_rate
    }

    /**
     * Runs a full store checkout and returns the raw completion payload.
     * Every test calls this itself because the runner restores the database
     * snapshot before each test.
     */
    async function completeCheckout(opts?: {
      countryCode?: string
      province?: string
    }) {
      const countryCode = opts?.countryCode ?? "de"
      const province = opts?.province
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const address: Record<string, any> = {
        first_name: "Tax",
        last_name: "Tester",
        address_1: "Teststrasse 1",
        postal_code: countryCode === "de" ? "10115" : "75001",
        city: countryCode === "de" ? "Berlin" : "Paris",
        country_code: countryCode,
        phone: "+490000000000",
      }
      if (province) {
        address.province = province
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
      const standard = options.shipping_options.find((o: { name: string }) =>
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

    /**
     * Loads a stored order together with its persisted per-item data.
     *
     * The order module splits an item across two rows: quantity lives on the
     * order ITEM (order_item), while unit_price and tax_lines live on the
     * linked line item (`OrderItem.item hasOne OrderLineItem`). The HTTP API
     * merges both into one object; raw query.graph does not, so this helper
     * performs the same merge and exposes a uniform `items` array of
     * `{ unit_price, quantity, tax_lines }`.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function loadStoredOrder(orderId: string): Promise<any> {
      // Raw remote-query `fields` use plain relation paths; the
      // `*items.tax_lines` expansion syntax belongs to the HTTP query-config
      // layer and is silently dropped by query.graph.
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: orders } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "tax_total",
          "total",
          "shipping_methods",
          "shipping_methods.amount",
          "shipping_methods.tax_lines",
        ],
        filters: { id: orderId },
      })
      expect(orders.length).toBe(1)

      const { data: itemRows } = await query.graph({
        entity: "order_item",
        fields: ["id", "quantity", "item", "item.unit_price", "item.tax_lines"],
        filters: { order_id: orderId },
      })
      const items = (itemRows ?? []).map(
        (row: { quantity: unknown; item?: Record<string, unknown> }) => ({
          ...row.item,
          quantity: row.quantity,
        })
      )
      return { ...orders[0], items }
    }

    /**
     * Awaits a request that MUST fail and returns the error response body so
     * the caller can assert on message quality. Rethrows unexpected successes
     * and transport-level failures (no response).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function expectAdminError(request: Promise<unknown>, status: number) {
      try {
        await request
        throw new Error(`expected the request to fail with HTTP ${status}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (!e.response) {
          throw e
        }
        expect(e.response.status).toBe(status)
        return e.response.data
      }
    }

    it("computes zero tax and writes no tax lines when no rates are configured", async () => {
      // No rate is created here on purpose: this is the clean-install state
      // (F1). Checkout must charge NO tax rather than assume a default rate.
      const completion = await completeCheckout()
      expect(completion.type).toBe("order")
      const order = completion.order

      expect(numOf(order.tax_total ?? 0)).toBeCloseTo(0, 2)
      expect(numOf(order.item_tax_total ?? 0)).toBeCloseTo(0, 2)
      expect(numOf(order.shipping_tax_total ?? 0)).toBeCloseTo(0, 2)
      // Total is items + shipping only: 10 + 10 = 20.00.
      expect(numOf(order.total)).toBeCloseTo(ZERO_TAX_TOTAL, 2)

      const storedOrder = await loadStoredOrder(order.id)
      const itemTaxLines = (storedOrder.items ?? []).flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (li: any) => li.tax_lines ?? []
      )
      const shippingTaxLines = (storedOrder.shipping_methods ?? []).flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sm: any) => sm.tax_lines ?? []
      )
      expect(itemTaxLines).toHaveLength(0)
      expect(shippingTaxLines).toHaveLength(0)
    }, 120000)

    it("applies a rate configured through the admin API to items, shipping, and the order total", async () => {
      // The merchant adds the missing configuration step explicitly.
      const rate = await createTaxRate({
        name: "VAT",
        rate: VAT_RATE,
        code: "VAT",
        is_default: true,
        tax_region_id: deTaxRegionId,
      })
      expect(numOf(rate.rate)).toBe(VAT_RATE)

      const completion = await completeCheckout()
      expect(completion.type).toBe("order")
      const order = completion.order
      expect(order.status).toBe("pending")
      expect(order.currency_code).toBe("eur")

      // 19% on the 10.00 item and on 10.00 shipping = 1.90 + 1.90 = 3.80.
      expect(numOf(order.item_tax_total)).toBeCloseTo(EXCLUSIVE_ITEM_TAX, 2)
      expect(numOf(order.shipping_tax_total)).toBeCloseTo(
        EXCLUSIVE_SHIPPING_TAX,
        2
      )
      expect(numOf(order.tax_total)).toBeCloseTo(EXCLUSIVE_TAX_TOTAL, 2)
      expect(numOf(order.total)).toBeCloseTo(EXCLUSIVE_TOTAL, 2)
    }, 120000)

    it("persists order tax lines that reconcile with the order tax total", async () => {
      await createTaxRate({
        name: "VAT",
        rate: VAT_RATE,
        code: "VAT",
        is_default: true,
        tax_region_id: deTaxRegionId,
      })

      const completion = await completeCheckout()
      expect(completion.type).toBe("order")

      const storedOrder = await loadStoredOrder(completion.order.id)
      const itemTaxLines = (storedOrder.items ?? []).flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (li: any) => li.tax_lines ?? []
      )
      const shippingTaxLines = (storedOrder.shipping_methods ?? []).flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sm: any) => sm.tax_lines ?? []
      )

      expect(itemTaxLines.length).toBeGreaterThan(0)
      for (const line of itemTaxLines) {
        expect(numOf(line.rate)).toBeCloseTo(VAT_RATE, 2)
        expect(line.code).toBe("VAT")
      }
      expect(shippingTaxLines.length).toBeGreaterThan(0)
      for (const line of shippingTaxLines) {
        expect(numOf(line.rate)).toBeCloseTo(VAT_RATE, 2)
        expect(line.code).toBe("VAT")
      }

      // Reconciliation from persisted data: order tax lines carry `rate` and
      // `code` but no amount column — the taxable amounts live on the item's
      // `unit_price` x `quantity` and the shipping method's `amount`.
      // Applying the persisted rates to the persisted amounts must reproduce
      // the persisted order.tax_total exactly.
      // items (10.00 x 19%) + shipping (10.00 x 19%) = 1.90 + 1.90 = 3.80.
      const itemSum = (storedOrder.items ?? []).reduce(
        (
          acc: number,
          li: { unit_price: unknown; quantity: unknown; tax_lines?: unknown[] }
        ) => {
          const rateSum = (li.tax_lines ?? []).reduce<number>(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (r: number, l: any) => r + numOf(l.rate),
            0
          )
          return acc + (numOf(li.unit_price) * numOf(li.quantity) * rateSum) / 100
        },
        0
      )
      const shippingSum = (storedOrder.shipping_methods ?? []).reduce(
        (acc: number, sm: { amount: unknown; tax_lines?: unknown[] }) => {
          const rateSum = (sm.tax_lines ?? []).reduce<number>(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (r: number, l: any) => r + numOf(l.rate),
            0
          )
          return acc + (numOf(sm.amount) * rateSum) / 100
        },
        0
      )
      expect(itemSum).toBeCloseTo(EXCLUSIVE_ITEM_TAX, 2)
      expect(shippingSum).toBeCloseTo(EXCLUSIVE_SHIPPING_TAX, 2)
      expect(numOf(storedOrder.tax_total)).toBeCloseTo(EXCLUSIVE_TAX_TOTAL, 2)
      expect(itemSum + shippingSum).toBeCloseTo(
        numOf(storedOrder.tax_total),
        2
      )
    }, 120000)

    it("prefers a province tax-region rate over the country default rate", async () => {
      // Country-wide default...
      await createTaxRate({
        name: "VAT",
        rate: VAT_RATE,
        code: "VAT",
        is_default: true,
        tax_region_id: deTaxRegionId,
      })
      // ...and a more granular province region (Berlin) with its own default
      // rate, created through the admin API with an inline default rate. The
      // province region must reference its country parent explicitly.
      const { data: provinceCreated } = await api.post(
        "/admin/tax-regions",
        {
          country_code: "de",
          province_code: "BE",
          parent_id: deTaxRegionId,
          default_tax_rate: {
            name: "VAT Berlin",
            rate: REDUCED_RATE,
            code: "VAT-BE",
          },
        },
        { headers: adminHeaders() }
      )
      expect(provinceCreated?.tax_region?.id).toBeTruthy()

      const completion = await completeCheckout({ province: "BE" })
      expect(completion.type).toBe("order")
      const order = completion.order

      // The province rate (priority 3) beats the country default (priority 6)
      // for BOTH the item and shipping: 5% on 10 + 5% on 10 = 1.00.
      expect(numOf(order.item_tax_total)).toBeCloseTo(0.5, 2)
      expect(numOf(order.shipping_tax_total)).toBeCloseTo(0.5, 2)
      expect(numOf(order.tax_total)).toBeCloseTo(1, 2)
      expect(numOf(order.total)).toBeCloseTo(21, 2)

      const storedOrder = await loadStoredOrder(order.id)
      const itemTaxLines = (storedOrder.items ?? []).flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (li: any) => li.tax_lines ?? []
      )
      expect(itemTaxLines.length).toBeGreaterThan(0)
      for (const line of itemTaxLines) {
        expect(numOf(line.rate)).toBeCloseTo(REDUCED_RATE, 2)
        expect(line.code).toBe("VAT-BE")
      }
    }, 120000)

    it("applies a product-scoped rate to matching items while shipping keeps the default rate", async () => {
      await createTaxRate({
        name: "VAT",
        rate: VAT_RATE,
        code: "VAT",
        is_default: true,
        tax_region_id: deTaxRegionId,
      })
      // A second, more specific rate restricted by a product rule.
      await createTaxRate({
        name: "Reduced",
        rate: REDUCED_RATE,
        code: "RED",
        tax_region_id: deTaxRegionId,
        rules: [{ reference: "product", reference_id: productId }],
      })

      const completion = await completeCheckout()
      expect(completion.type).toBe("order")
      const order = completion.order

      // Item: the product rule (priority 4) beats the country default
      // (priority 6) -> 5% on 10.00 = 0.50.
      expect(numOf(order.item_tax_total)).toBeCloseTo(0.5, 2)
      // Shipping matches no product rule -> default rate -> 19% on 10.00.
      expect(numOf(order.shipping_tax_total)).toBeCloseTo(
        EXCLUSIVE_SHIPPING_TAX,
        2
      )
      expect(numOf(order.tax_total)).toBeCloseTo(2.4, 2)
      expect(numOf(order.total)).toBeCloseTo(22.4, 2)

      // The persisted lines prove which rate was picked per line type.
      const storedOrder = await loadStoredOrder(order.id)
      const itemCodes = (storedOrder.items ?? [])
        .flatMap((li: { tax_lines?: unknown[] }) => li.tax_lines ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((l: any) => l.code)
      const shippingCodes = (storedOrder.shipping_methods ?? [])
        .flatMap((sm: { tax_lines?: unknown[] }) => sm.tax_lines ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((l: any) => l.code)
      expect(itemCodes).toContain("RED")
      expect(shippingCodes).toContain("VAT")
      expect(shippingCodes).not.toContain("RED")
    }, 120000)

    it("extracts tax from gross prices when the region is tax-inclusive", async () => {
      // Merchant flips the region to tax-inclusive pricing via the admin API
      // (the same toggle the dashboard exposes on the region screen). That
      // toggle updates the price preference scoped to the REGION id, which
      // makes REGION-priced amounts tax-inclusive (here: the shipping
      // option's region price). The variant's EUR price is a CURRENCY price,
      // and the store setup already created a currency_code/eur preference
      // (is_tax_inclusive false) — the merchant flips THAT through the stock
      // admin price-preferences API so the shelf price is inclusive too.
      const { data: regionUpdated } = await api.post(
        `/admin/regions/${regionId}`,
        { is_tax_inclusive: true },
        { headers: adminHeaders() }
      )
      expect(regionUpdated?.region?.id).toBe(regionId)

      const { data: prefs } = await api.get(
        "/admin/price-preferences?attribute=currency_code&value=eur",
        { headers: adminHeaders() }
      )
      const eurPreference = prefs?.price_preferences?.[0]
      expect(eurPreference?.id).toBeTruthy()
      const { data: prefUpdated } = await api.post(
        `/admin/price-preferences/${eurPreference.id}`,
        { is_tax_inclusive: true },
        { headers: adminHeaders() }
      )
      expect(prefUpdated?.price_preference?.is_tax_inclusive).toBe(true)

      await createTaxRate({
        name: "VAT",
        rate: VAT_RATE,
        code: "VAT",
        is_default: true,
        tax_region_id: deTaxRegionId,
      })

      const completion = await completeCheckout()
      expect(completion.type).toBe("order")
      const order = completion.order

      // The 10.00 shelf prices already INCLUDE 19% VAT: the customer pays the
      // shelf price for item + shipping (20.00 total, NOT 23.80), and the tax
      // is extracted from it rather than added on top.
      expect(numOf(order.total)).toBeCloseTo(ZERO_TAX_TOTAL, 2)
      // Tax = 20 * 19/119 = 3.19 (per-line rounding may yield 3.20).
      const taxTotal = numOf(order.tax_total)
      expect(taxTotal).toBeGreaterThan(0)
      expect(taxTotal).toBeLessThan(3.25)
      expect(numOf(order.item_tax_total) + numOf(order.shipping_tax_total))
        .toBeCloseTo(taxTotal, 2)
    }, 120000)

    it("does not apply one country's rate to a different country's address", async () => {
      // A rate exists for Germany only. France HAS a tax region (seeded) but
      // no configured rate — an FR checkout must therefore charge 0 tax, not
      // fall back to the German rate or any universal default.
      await createTaxRate({
        name: "VAT",
        rate: VAT_RATE,
        code: "VAT",
        is_default: true,
        tax_region_id: deTaxRegionId,
      })

      const completion = await completeCheckout({ countryCode: "fr" })
      expect(completion.type).toBe("order")
      const order = completion.order

      expect(numOf(order.tax_total ?? 0)).toBeCloseTo(0, 2)
      expect(numOf(order.item_tax_total ?? 0)).toBeCloseTo(0, 2)
      expect(numOf(order.shipping_tax_total ?? 0)).toBeCloseTo(0, 2)
      expect(numOf(order.total)).toBeCloseTo(ZERO_TAX_TOTAL, 2)

      const storedOrder = await loadStoredOrder(order.id)
      const itemTaxLines = (storedOrder.items ?? []).flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (li: any) => li.tax_lines ?? []
      )
      expect(itemTaxLines).toHaveLength(0)
    }, 120000)

    it("changes rates prospectively without rewriting historical orders", async () => {
      const rate = await createTaxRate({
        name: "VAT",
        rate: VAT_RATE,
        code: "VAT",
        is_default: true,
        tax_region_id: deTaxRegionId,
      })

      // First order at 19%.
      const first = await completeCheckout()
      expect(first.type).toBe("order")
      expect(numOf(first.order.tax_total)).toBeCloseTo(EXCLUSIVE_TAX_TOTAL, 2)
      expect(numOf(first.order.total)).toBeCloseTo(EXCLUSIVE_TOTAL, 2)

      // The merchant amends the rate through the admin API.
      const { data: updated } = await api.post(
        `/admin/tax-rates/${rate.id}`,
        { rate: REDUCED_RATE },
        { headers: adminHeaders() }
      )
      expect(numOf(updated?.tax_rate?.rate)).toBe(REDUCED_RATE)

      // The historical order is untouched: same persisted lines, same total.
      const storedOrder = await loadStoredOrder(first.order.id)
      const itemTaxLines = (storedOrder.items ?? []).flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (li: any) => li.tax_lines ?? []
      )
      expect(itemTaxLines.length).toBeGreaterThan(0)
      for (const line of itemTaxLines) {
        expect(numOf(line.rate)).toBeCloseTo(VAT_RATE, 2)
        expect(line.code).toBe("VAT")
      }
      expect(numOf(storedOrder.tax_total)).toBeCloseTo(EXCLUSIVE_TAX_TOTAL, 2)
      expect(numOf(storedOrder.total)).toBeCloseTo(EXCLUSIVE_TOTAL, 2)

      // A NEW checkout uses the amended rate: 5% on 10 + 5% on 10 = 1.00.
      const second = await completeCheckout()
      expect(second.type).toBe("order")
      expect(numOf(second.order.tax_total)).toBeCloseTo(1, 2)
      expect(numOf(second.order.total)).toBeCloseTo(21, 2)
    }, 120000)

    it("rejects invalid tax configuration with clear errors", async () => {
      // Negative rate -> bounded by the G3 validation middleware, HTTP 400
      // with the accepted range and the offending value in the message.
      let body = await expectAdminError(
        api.post(
          "/admin/tax-rates",
          {
            name: "Bad",
            rate: -5,
            code: "BAD",
            tax_region_id: deTaxRegionId,
          },
          { headers: adminHeaders() }
        ),
        400
      )
      expect(body.message).toContain("between 0 and 100")
      expect(body.message).toContain("-5")

      // Rate above 100 -> likewise rejected.
      body = await expectAdminError(
        api.post(
          "/admin/tax-rates",
          {
            name: "Bad",
            rate: 150,
            code: "BAD",
            tax_region_id: deTaxRegionId,
          },
          { headers: adminHeaders() }
        ),
        400
      )
      expect(body.message).toContain("between 0 and 100")

      // Inline default rate on tax-region create is bounded too.
      body = await expectAdminError(
        api.post(
          "/admin/tax-regions",
          {
            country_code: "de",
            province_code: "HE",
            parent_id: deTaxRegionId,
            default_tax_rate: { name: "Bad", rate: 250, code: "BAD" },
          },
          { headers: adminHeaders() }
        ),
        400
      )
      expect(body.message).toContain("250")

      // Unknown tax region -> the admin API refuses with a 404 that names the
      // offending relationship instead of storing an orphan rate.
      body = await expectAdminError(
        api.post(
          "/admin/tax-rates",
          {
            name: "Orphan",
            rate: VAT_RATE,
            code: "ORPH",
            tax_region_id: "treg_missing",
          },
          { headers: adminHeaders() }
        ),
        404
      )
      expect(body.message).toContain("treg_missing")

      // Control: legitimate values still work — 0 (zero-rated/exempt) and an
      // omitted rate (no rate at all) are valid configurations.
      const zeroRated = await createTaxRate({
        name: "Zero rated",
        rate: 0,
        code: "ZERO",
        tax_region_id: deTaxRegionId,
      })
      expect(numOf(zeroRated.rate)).toBe(0)
      const noRate = await createTaxRate({
        name: "Exempt",
        code: "EXEMPT",
        tax_region_id: deTaxRegionId,
      })
      expect(noRate.id).toBeTruthy()
    }, 120000)

    it("charges no automatic tax when the region has automatic taxes disabled", async () => {
      // A rate IS configured, but the merchant turned the region's automatic
      // taxes off — checkout must not tax automatically.
      const { data: regionUpdated } = await api.post(
        `/admin/regions/${regionId}`,
        { automatic_taxes: false },
        { headers: adminHeaders() }
      )
      expect(regionUpdated?.region?.automatic_taxes).toBe(false)

      await createTaxRate({
        name: "VAT",
        rate: VAT_RATE,
        code: "VAT",
        is_default: true,
        tax_region_id: deTaxRegionId,
      })

      const completion = await completeCheckout()
      expect(completion.type).toBe("order")
      const order = completion.order

      expect(numOf(order.tax_total ?? 0)).toBeCloseTo(0, 2)
      expect(numOf(order.total)).toBeCloseTo(ZERO_TAX_TOTAL, 2)
    }, 120000)
  },
})
