import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/core-flows"

/**
 * Order-lifecycle integration suite (Sprint 3, Task 4).
 *
 * Deterministic end-to-end coverage of the core commerce lifecycle against a
 * real backend and a disposable database, using only supported APIs (store
 * HTTP routes, module services, and core workflows — no direct DB mutation):
 *
 *   1. Product/variant availability — the seeded catalogue variant is
 *      purchasable through the store API; a product that is NOT linked to
 *      the sales channel (the publishable key's scope) is rejected when
 *      adding its variant to a cart.
 *   2. Cart totals — item subtotal, tax, and grand total track line-item
 *      quantity changes (add then remove).
 *   3. Shipping + tax — after an address (DE) and a shipping method are set,
 *      the cart totals include the shipping price and its 19% tax.
 *   4. Test-provider checkout — a full store checkout with the built-in
 *      `pp_system_default` test provider creates a pending order with the
 *      exact totals and an authorized payment session. No real payment
 *      network is involved.
 *   5. Inventory reservation — completing a checkout reserves exactly the
 *      purchased quantity from the seeded stock level (available drops).
 *   6. Cancel + invalid transitions — `cancelOrderWorkflow` cancels a
 *      pending order (status/canceled_at set) and releases its inventory
 *      reservation; cancelling the same order again is rejected.
 *   7. Auth boundaries — the store API requires a publishable key (missing
 *      and bogus keys are rejected), the admin API requires authentication,
 *      and customer login rejects a wrong password while accepting the
 *      correct one.
 *   8. Retry/duplicate protection — completing the same cart twice produces
 *      exactly one order. The core workflow is idempotent (a retry returns
 *      the same order rather than failing); either way, no second order is
 *      ever created, and the completed cart cannot be mutated.
 *
 * Fixtures: the database is pre-migrated with the app's documented
 * clean-install step (`pnpm run db:migrate`), which seeds the store, region,
 * tax regions (no rates — the suite configures one explicitly, mirroring the
 * documented step), products, publishable key, shipping options, stock
 * location, and inventory. See docs/local-development.md ("HTTP
 * integration tests") for the two-step run:
 *
 *   1. create + migrate the database named below (DATABASE_URL)
 *   2. pnpm run test:integration:http   (runner reads DB_* only)
 *
 * Isolation: `medusaIntegrationTestRunner` derives its connection from
 * DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD (deliberately NOT DATABASE_URL),
 * boots the app on an ephemeral port, and drops the database afterwards. It
 * never touches the developer's configured database.
 *
 * Per-test data: the runner snapshots the database after the suite's
 * beforeAll and RESTORES it before every subsequent test (its beforeEach
 * hooks terminate connections and recreate the database from the template).
 * Every test below therefore creates its own cart/order through the shared
 * helpers; no test depends on state left by another. Configuration done in
 * beforeAll (tax rate, fixed inventory level) is part of the snapshot and
 * persists for every test.
 */

const VAT_RATE = 19
const VARIANT_SKU = "SHIRT-S-WHITE"
const ITEM_PRICE = 10
const SHIPPING_PRICE = 10
const INITIAL_STOCK = 5

const EXPECTED_ITEM_TAX = 1.9 // 10 * 0.19
const EXPECTED_SHIPPING_TAX = 1.9 // 10 * 0.19

/** Numeric values from module-level queries arrive as Medusa BigNumber
 * instances; coerce before comparing. HTTP responses are already plain. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numOf(value: any): number {
  const direct = Number(value)
  if (Number.isFinite(direct)) {
    return direct
  }
  return Number(value?.value ?? value?.raw?.value ?? NaN)
}

medusaIntegrationTestRunner({
  dbName: "openshop_sprint3_order_lifecycle",
  testSuite: ({ api, getContainer }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let container: any
    let publishableKey: string
    let regionId: string
    let variantId: string
    let inventoryItemId: string
    let locationId: string

    function headers() {
      return { "x-publishable-api-key": publishableKey }
    }

    const deAddress = {
      first_name: "Life",
      last_name: "Cycle",
      address_1: "Teststrasse 2",
      postal_code: "10115",
      city: "Berlin",
      country_code: "de",
      province: "BE",
      phone: "+490000000001",
    }

    beforeAll(async () => {
      container = getContainer()

      // Explicit tax rate for Germany (finding F1: regions are seeded, rates
      // are not). Part of the snapshot template, so every test sees it.
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

      // Store API credential (publishable key) + region.
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

      // Seeded variant + its inventory item and stock location, so tests 5
      // and 6 can make exact reserve/release assertions against a known
      // level instead of a moving baseline.
      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: ["id", "sku", "inventory_items", "inventory_items.inventory_item_id"],
        filters: { sku: VARIANT_SKU },
      })
      expect(variants.length).toBe(1)
      variantId = variants[0].id
      inventoryItemId = variants[0].inventory_items[0].inventory_item_id

      const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)
      const locations = await stockLocationModule.listStockLocations({})
      expect(locations.length).toBeGreaterThan(0)
      locationId = locations[0].id

      // Pin the inventory level so reserve/release assertions are exact.
      const inventoryModule = container.resolve(Modules.INVENTORY)
      await inventoryModule.updateInventoryLevels({
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        stocked_quantity: INITIAL_STOCK,
      })
    }, 180000)

    /** Creates a cart with the seeded variant (qty) and the DE address. */
    async function createCartWithItem(quantity: number) {
      const { data: cartCreated } = await api.post(
        "/store/carts",
        { region_id: regionId },
        { headers: headers() }
      )
      const cartId = cartCreated.cart.id

      await api.post(
        `/store/carts/${cartId}/line-items`,
        { variant_id: variantId, quantity },
        { headers: headers() }
      )
      await api.post(
        `/store/carts/${cartId}`,
        {
          email: "lifecycle.tester@example.com",
          shipping_address: deAddress,
          billing_address: deAddress,
        },
        { headers: headers() }
      )
      return cartId
    }

    /** Adds the Standard shipping method to a cart. */
    async function addStandardShipping(cartId: string) {
      const { data: options } = await api.get(
        `/store/shipping-options?cart_id=${cartId}`,
        { headers: headers() }
      )
      const standard = options.shipping_options.find((o: any) =>
        o.name.includes("Standard")
      )
      expect(standard).toBeTruthy()
      await api.post(
        `/store/carts/${cartId}/shipping-methods`,
        { option_id: standard.id },
        { headers: headers() }
      )
    }

    /** Runs the payment step and completes the cart into an order. */
    async function completeCheckout(cartId: string) {
      const { data: pcCreated } = await api.post(
        "/store/payment-collections",
        { cart_id: cartId },
        { headers: headers() }
      )
      await api.post(
        `/store/payment-collections/${pcCreated.payment_collection.id}/payment-sessions`,
        { provider_id: "pp_system_default" },
        { headers: headers() }
      )
      const { data: completion } = await api.post(
        `/store/carts/${cartId}/complete`,
        {},
        { headers: headers() }
      )
      return completion
    }

    /** Full happy-path checkout: cart, item, address, shipping, completion. */
    async function placeOrder(quantity: number) {
      const cartId = await createCartWithItem(quantity)
      await addStandardShipping(cartId)
      const completion = await completeCheckout(cartId)
      expect(completion.type).toBe("order")
      return { cartId, order: completion.order }
    }

    /** Awaits a promise expected to fail with an HTTP error status. */
    async function expectHttpError(
      promise: Promise<unknown>,
      expectedStatuses: number[],
      label: string
    ) {
      try {
        await promise
      } catch (error: any) {
        const status = error?.response?.status
        if (typeof status !== "number") {
          // Not an HTTP-layer failure (e.g. connection refused) — rethrow so
          // the test reports the real problem.
          throw error
        }
        expect({ label, status }).toEqual({
          label,
          status: expect.any(Number),
        })
        expect(expectedStatuses).toContain(status)
        return error
      }
      throw new Error(
        `${label}: expected an HTTP error, but the call succeeded`
      )
    }

    it("1. sells the sales-channel variant and rejects an unlisted product's variant", async () => {
      // The seeded variant is linked to the sales channel the publishable
      // key is scoped to: adding it works.
      const cartId = await createCartWithItem(1)
      const { data: cartWithItem } = await api.get(`/store/carts/${cartId}`, {
        headers: headers(),
      })
      expect(cartWithItem.cart.items.length).toBe(1)
      expect(cartWithItem.cart.items[0].variant_id).toBe(variantId)

      // A product NOT linked to any sales channel is invisible to the store
      // API: its variant must not be addable to a cart.
      const productModule = container.resolve(Modules.PRODUCT)
      const hidden = await productModule.createProducts([
        {
          title: "Unlisted product (availability test)",
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            {
              title: "Unlisted M",
              options: { Size: "M" },
              prices: [{ amount: 1500, currency_code: "eur" }],
            },
          ],
        },
      ])
      const hiddenVariantId = hidden[0].variants[0].id

      await expectHttpError(
        api.post(
          `/store/carts/${cartId}/line-items`,
          { variant_id: hiddenVariantId, quantity: 1 },
          { headers: headers() }
        ),
        [400, 404],
        "add unlisted variant to cart"
      )

      // The rejected line did not change the cart.
      const { data: after } = await api.get(`/store/carts/${cartId}`, {
        headers: headers(),
      })
      expect(after.cart.items.length).toBe(1)
    }, 120000)

    it("2. keeps cart item totals exact when quantity changes", async () => {
      const cartId = await createCartWithItem(2)

      // 2 x 10.00 = 20.00 subtotal, 19% DE tax = 3.80, no shipping yet.
      const { data: two } = await api.get(`/store/carts/${cartId}`, {
        headers: headers(),
      })
      expect(two.cart.items.length).toBe(1)
      expect(numOf(two.cart.items[0].quantity)).toBe(2)
      expect(numOf(two.cart.item_subtotal)).toBeCloseTo(20, 2)
      expect(numOf(two.cart.tax_total)).toBeCloseTo(3.8, 2)
      expect(numOf(two.cart.total)).toBeCloseTo(23.8, 2)

      // Remove the line (DELETE takes the LINE ITEM id, not the variant id).
      const lineItemId = two.cart.items[0].id
      await api.delete(`/store/carts/${cartId}/line-items/${lineItemId}`, {
        headers: headers(),
      })

      // Re-add a single unit and expect totals back at one-item scale.
      await api.post(
        `/store/carts/${cartId}/line-items`,
        { variant_id: variantId, quantity: 1 },
        { headers: headers() }
      )
      const { data: one } = await api.get(`/store/carts/${cartId}`, {
        headers: headers(),
      })
      expect(one.cart.items.length).toBe(1)
      expect(numOf(one.cart.items[0].quantity)).toBe(1)
      expect(numOf(one.cart.item_subtotal)).toBeCloseTo(10, 2)
      expect(numOf(one.cart.tax_total)).toBeCloseTo(EXPECTED_ITEM_TAX, 2)
      expect(numOf(one.cart.total)).toBeCloseTo(11.9, 2)
    }, 120000)

    it("3. includes shipping price and shipping tax in the cart totals", async () => {
      const cartId = await createCartWithItem(1)
      await addStandardShipping(cartId)

      const { data } = await api.get(`/store/carts/${cartId}`, {
        headers: headers(),
      })
      const cart = data.cart
      // Pre-tax shipping price, tax-inclusive shipping total, and both tax
      // components: 10 + 10 + 3.80 = 23.80.
      expect(numOf(cart.shipping_subtotal)).toBeCloseTo(SHIPPING_PRICE, 2)
      expect(numOf(cart.shipping_total)).toBeCloseTo(11.9, 2)
      expect(numOf(cart.item_tax_total)).toBeCloseTo(EXPECTED_ITEM_TAX, 2)
      expect(numOf(cart.shipping_tax_total)).toBeCloseTo(
        EXPECTED_SHIPPING_TAX,
        2
      )
      expect(numOf(cart.tax_total)).toBeCloseTo(3.8, 2)
      expect(numOf(cart.total)).toBeCloseTo(23.8, 2)
    }, 120000)

    it("4. creates a pending order with exact totals via the test payment provider", async () => {
      const { order } = await placeOrder(1)

      expect(order.status).toBe("pending")
      expect(order.currency_code).toBe("eur")
      // `item_total`/`shipping_total` are tax-inclusive; subtotals are not.
      expect(numOf(order.item_subtotal)).toBeCloseTo(10, 2)
      expect(numOf(order.item_total)).toBeCloseTo(11.9, 2)
      expect(numOf(order.shipping_subtotal)).toBeCloseTo(SHIPPING_PRICE, 2)
      expect(numOf(order.shipping_total)).toBeCloseTo(11.9, 2)
      expect(numOf(order.tax_total)).toBeCloseTo(3.8, 2)
      expect(numOf(order.total)).toBeCloseTo(23.8, 2)

      // The order links to its payment collection through the
      // order_payment_collection table (the entity exposes the
      // `payment_collections` relation, not a scalar id), and the store
      // cart-complete response only includes default store fields — so
      // fetch the collection and its session through an explicit query.
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: orderRows } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "payment_collections",
          "payment_collections.id",
          "payment_collections.amount",
          "payment_collections.payment_sessions",
          "payment_collections.payment_sessions.provider_id",
          "payment_collections.payment_sessions.status",
        ],
        filters: { id: order.id },
      })
      expect(orderRows.length).toBe(1)

      // The payment session was created with the built-in test provider and
      // is authorized — no external payment network involved.
      const collections = orderRows[0].payment_collections ?? []
      expect(collections.length).toBe(1)
      const sessions = collections[0].payment_sessions ?? []
      expect(sessions.length).toBe(1)
      expect(sessions[0].provider_id).toBe("pp_system_default")
      expect(sessions[0].status).toBe("authorized")
      expect(numOf(collections[0].amount)).toBeCloseTo(23.8, 2)
    }, 120000)

    it("5. reserves exactly the purchased quantity from the stock level", async () => {
      const inventoryModule = container.resolve(Modules.INVENTORY)

      const before = await inventoryModule.retrieveInventoryLevelByItemAndLocation(
        inventoryItemId,
        locationId
      )
      expect(numOf(before.stocked_quantity)).toBeCloseTo(INITIAL_STOCK, 2)

      const { order } = await placeOrder(2)
      expect(order.status).toBe("pending")

      const reserved = await inventoryModule.retrieveReservedQuantity(
        inventoryItemId,
        [locationId]
      )
      const available = await inventoryModule.retrieveAvailableQuantity(
        inventoryItemId,
        [locationId]
      )
      expect(numOf(reserved)).toBeCloseTo(2, 2)
      expect(numOf(available)).toBeCloseTo(INITIAL_STOCK - 2, 2)
    }, 120000)

    it("6. cancels a pending order once, releasing its reservation, and rejects a second cancel", async () => {
      const inventoryModule = container.resolve(Modules.INVENTORY)

      const { order } = await placeOrder(1)
      expect(numOf(await inventoryModule.retrieveReservedQuantity(
        inventoryItemId,
        [locationId]
      ))).toBeCloseTo(1, 2)

      // Cancel through the supported core workflow, invoked exactly like the
      // admin cancel route does (`cancelOrderWorkflow(scope).run(...)`).
      await cancelOrderWorkflow(container).run({
        input: { order_id: order.id },
      })

      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: canceled } = await query.graph({
        entity: "order",
        fields: ["id", "status", "canceled_at"],
        filters: { id: order.id },
      })
      expect(canceled.length).toBe(1)
      expect(canceled[0].status).toBe("canceled")
      expect(canceled[0].canceled_at).toBeTruthy()

      // The reservation was released with the cancel.
      expect(numOf(await inventoryModule.retrieveReservedQuantity(
        inventoryItemId,
        [locationId]
      ))).toBeCloseTo(0, 2)
      expect(numOf(await inventoryModule.retrieveAvailableQuantity(
        inventoryItemId,
        [locationId]
      ))).toBeCloseTo(INITIAL_STOCK, 2)

      // Invalid transition: cancelling an already-canceled order must be
      // rejected. Capture the rejection whether the workflow surfaces it by
      // throwing or through the returned `errors` array, then assert the
      // reason is the already-canceled guard.
      let rejection: unknown
      try {
        const secondRun = (await cancelOrderWorkflow(container).run({
          input: { order_id: order.id },
        })) as { errors?: Array<{ error?: Error }> }
        rejection = secondRun?.errors?.[0]?.error
      } catch (error) {
        rejection = error
      }
      expect(rejection).toBeTruthy()
      expect(String((rejection as Error).message)).toMatch(
        /has been canceled/
      )

      // The order remains canceled exactly once (no state corruption from
      // the rejected attempt).
      const { data: afterRejected } = await query.graph({
        entity: "order",
        fields: ["id", "status", "canceled_at"],
        filters: { id: order.id },
      })
      expect(afterRejected.length).toBe(1)
      expect(afterRejected[0].status).toBe("canceled")
    }, 120000)

    it("7. enforces publishable-key, admin, and customer-auth boundaries", async () => {
      // Store API without a publishable key: rejected.
      await expectHttpError(
        api.post("/store/carts", { region_id: regionId }, {}),
        [400, 401],
        "store cart without publishable key"
      )

      // Store API with a bogus publishable key: rejected.
      await expectHttpError(
        api.post(
          "/store/carts",
          { region_id: regionId },
          { headers: { "x-publishable-api-key": "pk_bogus_key_value" } }
        ),
        [400, 401],
        "store cart with bogus publishable key"
      )

      // Admin API without authentication: rejected.
      await expectHttpError(
        api.get("/admin/orders"),
        [401, 403, 404],
        "admin orders without auth"
      )

      // Customer registration uses the v2 auth flow with the default
      // `emailpass` provider: register the credentials at the auth route to
      // obtain an actorless token, then create the customer actor with it.
      // Store routes also require the publishable key header.
      const customerEmail = "auth.boundary@example.com"
      const customerPassword = "correct-horse-battery"
      const { data: registration } = await api.post(
        "/auth/customer/emailpass/register",
        {
          email: customerEmail,
          password: customerPassword,
        }
      )
      expect(registration.token).toBeTruthy()

      const { data: registered } = await api.post(
        "/store/customers",
        {
          email: customerEmail,
          first_name: "Auth",
          last_name: "Boundary",
        },
        {
          headers: {
            ...headers(),
            Authorization: `Bearer ${registration.token}`,
          },
        }
      )
      expect(registered.customer.id).toBeTruthy()
      expect(registered.customer.email).toBe(customerEmail)

      // Login rejects a wrong password with 401.
      await expectHttpError(
        api.post("/auth/customer/emailpass", {
          email: customerEmail,
          password: "wrong-password",
        }),
        [401],
        "login with wrong password"
      )

      // Login with the correct password returns an actor token.
      const { data: login } = await api.post("/auth/customer/emailpass", {
        email: customerEmail,
        password: customerPassword,
      })
      expect(login.token).toBeTruthy()

      // The returned token authenticates the customer on the store API.
      const { data: me } = await api.get("/store/customers/me", {
        headers: {
          ...headers(),
          Authorization: `Bearer ${login.token}`,
        },
      })
      expect(me.customer.id).toBe(registered.customer.id)
    }, 120000)

    it("8. completes a cart only once — a retry never duplicates the order", async () => {
      const cartId = await createCartWithItem(1)
      await addStandardShipping(cartId)

      const first = await completeCheckout(cartId)
      expect(first.type).toBe("order")
      const orderId = first.order.id

      // Retrying completion must not create a second order. The core
      // complete-cart workflow is idempotent (documented): a retry either
      // returns the same order with a 200 or fails — but it never
      // duplicates. Capture whichever outcome occurs, then assert the
      // invariant.
      let retrySucceeded = false
      let retryOrderId: string | undefined
      try {
        const { data: retry } = await api.post(
          `/store/carts/${cartId}/complete`,
          {},
          { headers: headers() }
        )
        retrySucceeded = true
        retryOrderId = retry?.order?.id
      } catch (error: any) {
        const status = error?.response?.status
        expect([400, 404, 409]).toContain(status)
      }
      if (retrySucceeded) {
        // Idempotent success must return the SAME order, not a new one.
        expect(retryOrderId).toBe(orderId)
      }

      // Exactly one order exists either way. The order entity does not
      // expose the cart link as a queryable filter, but the runner restores
      // the pre-suite database snapshot before each test (and the clean
      // install seeds no orders), so the complete set of orders in this
      // database is exactly the one this test placed.
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id"],
      })
      expect(orders.length).toBe(1)
      expect(orders[0].id).toBe(orderId)

      // The completed cart cannot be mutated either.
      await expectHttpError(
        api.post(
          `/store/carts/${cartId}/line-items`,
          { variant_id: variantId, quantity: 1 },
          { headers: headers() }
        ),
        [400, 404, 409],
        "add item to completed cart"
      )
    }, 120000)
  },
})
