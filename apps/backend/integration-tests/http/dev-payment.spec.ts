import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  cancelOrderWorkflow,
  capturePaymentWorkflow,
  refundPaymentWorkflow,
  updateRegionsWorkflow,
} from "@medusajs/core-flows"

/**
 * Development payment provider integration suite (G5).
 *
 * Deterministic end-to-end coverage of the OpenShop development payment
 * provider (`pp_dev-payment_default`) through Medusa's supported payment
 * interfaces — store HTTP routes, the payment module service, and core
 * workflows — against a real backend and a disposable database. The
 * provider only ever simulates payments: no network call, no real money.
 * See docs/PAYMENTS.md.
 *
 *   1. Registration — the provider boots registered and enabled, and the
 *      store API offers it (alongside the manual test provider) for the
 *      cart's region.
 *   2. Merchant walkthrough — a payment session is created (pending,
 *      stamped `simulated: true`), the cart completes into an order with
 *      exact totals, and the session/payment flip to `authorized` with the
 *      provider state machine visible in `data.dev_payment`.
 *   3. Capture — `capturePaymentWorkflow` stamps the provider state
 *      `captured`, sets `captured_at`, records exactly one capture
 *      transaction, and a duplicate capture is an idempotent no-op.
 *   4. Refunds — partial refunds accumulate to the captured amount (state
 *      `refunded`), each refund becomes an order transaction, and a refund
 *      beyond the captured amount is rejected before it reaches the
 *      provider.
 *   5. Cancellation — `cancelOrderWorkflow` cancels the uncaptured payment
 *      through the provider (state `canceled`, `canceled_at` set).
 *   6. Declined authorization — `data.simulate: "decline"` fails checkout
 *      with HTTP 400, creates zero orders, and leaves the session errored
 *      with `failure_reason: "simulated_decline"`.
 *   7. Duplicate requests — creating the same session twice leaves exactly
 *      one session; completing the cart twice never duplicates the order.
 *   8. Region guard — removing the provider from the region rejects its
 *      payment sessions (HTTP 400) while the manual test provider keeps
 *      working for the same cart.
 *   9. Simultaneous duplicates — four identical capture requests and four
 *      identical full-refund requests fired at the same instant must not
 *      double-count: exactly one capture transaction, and refunds never in
 *      excess of the captured amount on either the order or the provider
 *      side. Tests 3-4 only cover sequential retries.
 *
 * This suite deliberately makes no claim about real-payment readiness: a
 * simulated success is not a payment integration, and Gate 3 stays FAIL
 * until a real gateway is integrated (G2). The tests exist to prove the
 * development provider's lifecycle, safeguards, and order-state
 * consistency — nothing more.
 *
 * Fixtures: the database is pre-migrated with the app's documented
 * clean-install step (`pnpm run db:migrate`), which seeds the store,
 * region, tax regions (no rates — the suite configures one explicitly,
 * mirroring the documented step), products, publishable key, shipping
 * options, stock location, and inventory. See docs/local-development.md
 * ("HTTP integration tests") for the two-step run:
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
 * beforeAll and RESTORES it before every subsequent test. Every test below
 * therefore creates its own cart/order through the shared helpers; no test
 * depends on state left by another. Configuration done in beforeAll (tax
 * rate, fixed inventory level, region payment providers) is part of the
 * snapshot and persists for every test.
 */

const VAT_RATE = 19
const VARIANT_SKU = "SHIRT-S-WHITE"
const ITEM_PRICE = 10
const SHIPPING_PRICE = 10
const INITIAL_STOCK = 5

const DEV_PROVIDER_ID = "pp_dev-payment_default"
const SYSTEM_PROVIDER_ID = "pp_system_default"

/** 10 item + 10 shipping + 3.80 tax (19% DE) = 23.80. */
const ORDER_TOTAL = 23.8

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

/** The provider's state-machine slice inside a session/payment `data` blob. */
type DevPaymentStateView = {
  simulated?: boolean
  provider?: string
  state?: string
  amount?: number
  currency_code?: string
  captured_amount?: number
  refunded_amount?: number
  refunds?: Array<{ id?: string; amount?: number }>
  capture_keys?: string[]
  failure_reason?: string
  simulation?: string
}

/** Reads `data.dev_payment`, failing the test when the stamp is absent. */
function devState(data: unknown): DevPaymentStateView {
  const state = (data as { dev_payment?: DevPaymentStateView } | undefined)
    ?.dev_payment
  expect(state).toBeTruthy()
  return state as DevPaymentStateView
}

medusaIntegrationTestRunner({
  dbName: "openshop_g5_dev_payment",
  testSuite: ({ api, getContainer }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let container: any
    let adminToken: string
    let publishableKey: string
    let regionId: string
    let variantId: string
    let inventoryItemId: string
    let locationId: string

    function headers() {
      return { "x-publishable-api-key": publishableKey }
    }

    /** Admin (merchant) session headers for the payment admin routes. */
    function adminHeaders() {
      return { Authorization: `Bearer ${adminToken}` }
    }

    const deAddress = {
      first_name: "Dev",
      last_name: "Payment",
      address_1: "Teststrasse 5",
      postal_code: "10115",
      city: "Berlin",
      country_code: "de",
      province: "BE",
      phone: "+490000000005",
    }

    beforeAll(async () => {
      container = getContainer()

      // Admin (merchant) session for test 9's payment admin routes, created
      // exactly like `medusa user` + a dashboard login: user workflow ->
      // emailpass registration -> identity link -> token via the public auth
      // route (same documented pattern as the G3 suite). Part of the
      // snapshot, so every test can use it.
      const workflowService = container.resolve(Modules.WORKFLOW_ENGINE)
      const authService = container.resolve(Modules.AUTH)
      const email = "g5-admin@test.com"
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

      // Seeded variant + its inventory item and stock location, so checkout
      // can reserve stock against a known level in every test.
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

      // Pin the inventory level so every completion has stock to reserve.
      const inventoryModule = container.resolve(Modules.INVENTORY)
      await inventoryModule.updateInventoryLevels({
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        stocked_quantity: INITIAL_STOCK,
      })

      // G5: the provider must have been registered by the payment module
      // boot (the medusa-config providers list) before the region can
      // offer it. The loader upserts `is_enabled: true` for every loaded
      // provider, so a missing row means the module config is wrong.
      const paymentModule = container.resolve(Modules.PAYMENT)
      const registered = await paymentModule.listPaymentProviders({
        id: DEV_PROVIDER_ID,
        is_enabled: true,
      })
      expect(registered.length).toBe(1)

      // Offer BOTH the manual test provider and the development provider in
      // the seeded region. `updateRegionsWorkflow` REPLACES the region's
      // provider set (and validates each listed provider exists and is
      // enabled), so the manual provider is written back alongside the
      // development one. Test 8 narrows the set again on its own snapshot.
      await updateRegionsWorkflow(container).run({
        input: {
          selector: { id: regionId },
          update: { payment_providers: [SYSTEM_PROVIDER_ID, DEV_PROVIDER_ID] },
        },
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
          email: "dev.payment.tester@example.com",
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

    /** Creates (or reuses) the cart's payment collection; returns its id. */
    async function createPaymentCollection(cartId: string): Promise<string> {
      const { data } = await api.post(
        "/store/payment-collections",
        { cart_id: cartId },
        { headers: headers() }
      )
      return data.payment_collection.id
    }

    /** Initializes a payment session for a provider on the collection. */
    async function createPaymentSession(
      collectionId: string,
      providerId: string,
      sessionData?: Record<string, unknown>
    ) {
      const body: Record<string, unknown> = { provider_id: providerId }
      if (sessionData) {
        body.data = sessionData
      }
      await api.post(
        `/store/payment-collections/${collectionId}/payment-sessions`,
        body,
        { headers: headers() }
      )
    }

    /** The collection's payment sessions as stored by the payment module. */
    async function listSessions(collectionId: string) {
      const paymentModule = container.resolve(Modules.PAYMENT)
      return await paymentModule.listPaymentSessions({
        payment_collection_id: collectionId,
      })
    }

    /**
     * The single payment row created when the session was authorized
     * (payments are created by authorization, so declined sessions have
     * none).
     */
    async function getPayment(collectionId: string) {
      const sessions = await listSessions(collectionId)
      expect(sessions.length).toBe(1)
      const paymentModule = container.resolve(Modules.PAYMENT)
      const payments = await paymentModule.listPayments({
        payment_session_id: sessions[0].id,
      })
      expect(payments.length).toBe(1)
      return payments[0]
    }

    /** Completes the cart into an order (happy path). */
    async function completeCart(cartId: string) {
      const { data } = await api.post(
        `/store/carts/${cartId}/complete`,
        {},
        { headers: headers() }
      )
      return data
    }

    /**
     * Full happy-path checkout with the development payment provider:
     * cart, item, address, shipping, payment collection, dev session,
     * completion. Returns the collection id (for payment/session
     * inspection) and the order.
     */
    async function placeDevOrder(quantity: number) {
      const cartId = await createCartWithItem(quantity)
      await addStandardShipping(cartId)
      const collectionId = await createPaymentCollection(cartId)
      await createPaymentSession(collectionId, DEV_PROVIDER_ID)
      const completion = await completeCart(cartId)
      expect(completion.type).toBe("order")
      return { cartId, collectionId, order: completion.order }
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
        expect(expectedStatuses).toContain(status)
        return error
      }
      throw new Error(
        `${label}: expected an HTTP error, but the call succeeded`
      )
    }

    it("1. registers the development payment provider and offers it in the store region", async () => {
      const paymentModule = container.resolve(Modules.PAYMENT)

      // Boot registration: the provider row exists and is enabled. The
      // container key follows Medusa's `pp_{identifier}_{id}` formula with
      // identifier "dev-payment" and config id "default".
      const providers = await paymentModule.listPaymentProviders({
        id: DEV_PROVIDER_ID,
        is_enabled: true,
      })
      expect(providers.length).toBe(1)
      expect(providers[0].id).toBe(DEV_PROVIDER_ID)
      expect(providers[0].is_enabled).toBe(true)

      // The manual test provider stays registered alongside it (the payment
      // module loader always registers the system provider, then appends
      // the configured ones).
      const manual = await paymentModule.listPaymentProviders({
        id: SYSTEM_PROVIDER_ID,
        is_enabled: true,
      })
      expect(manual.length).toBe(1)

      // The store API lists both providers for the region carts use, so a
      // merchant following the walkthrough sees the provider to select.
      const { data } = await api.get(
        `/store/payment-providers?region_id=${regionId}`,
        { headers: headers() }
      )
      const offeredIds = data.payment_providers.map(
        (provider: { id: string }) => provider.id
      )
      expect(offeredIds).toContain(DEV_PROVIDER_ID)
      expect(offeredIds).toContain(SYSTEM_PROVIDER_ID)
      expect(data.count).toBeGreaterThanOrEqual(2)
    }, 120000)

    it("2. walks a test order through session creation, authorization, and exact totals", async () => {
      const cartId = await createCartWithItem(1)
      await addStandardShipping(cartId)
      const collectionId = await createPaymentCollection(cartId)

      // The merchant selects the development provider: the session starts
      // pending and carries the provider's simulation stamps.
      await createPaymentSession(collectionId, DEV_PROVIDER_ID)
      const sessions = await listSessions(collectionId)
      expect(sessions.length).toBe(1)
      expect(sessions[0].provider_id).toBe(DEV_PROVIDER_ID)
      expect(sessions[0].status).toBe("pending")
      expect(numOf(sessions[0].amount)).toBeCloseTo(ORDER_TOTAL, 2)

      const initiated = devState(sessions[0].data)
      expect(initiated.simulated).toBe(true)
      expect(initiated.provider).toBe("development")
      expect(initiated.state).toBe("initiated")
      expect(numOf(initiated.amount)).toBeCloseTo(ORDER_TOTAL, 2)
      expect(initiated.currency_code).toBe("eur")
      expect(numOf(initiated.captured_amount)).toBe(0)
      expect(numOf(initiated.refunded_amount)).toBe(0)
      expect(initiated.refunds).toEqual([])
      expect(initiated.failure_reason).toBeUndefined()

      // Completing the cart authorizes the session and creates the order
      // with exact totals (item and shipping are tax-inclusive; subtotals
      // are not).
      const completion = await completeCart(cartId)
      expect(completion.type).toBe("order")
      const order = completion.order
      expect(order.status).toBe("pending")
      expect(order.currency_code).toBe("eur")
      expect(numOf(order.item_subtotal)).toBeCloseTo(ITEM_PRICE, 2)
      expect(numOf(order.item_total)).toBeCloseTo(11.9, 2)
      expect(numOf(order.shipping_subtotal)).toBeCloseTo(SHIPPING_PRICE, 2)
      expect(numOf(order.shipping_total)).toBeCloseTo(11.9, 2)
      expect(numOf(order.tax_total)).toBeCloseTo(3.8, 2)
      expect(numOf(order.total)).toBeCloseTo(ORDER_TOTAL, 2)

      // The session flipped to authorized (no real network was involved).
      const authorizedSessions = await listSessions(collectionId)
      expect(authorizedSessions.length).toBe(1)
      expect(authorizedSessions[0].status).toBe("authorized")

      // The payment row exists, is not captured yet, and the provider's
      // state machine advanced to `authorized` — inspectable anywhere the
      // payment data is shown (API, admin, database).
      const payment = await getPayment(collectionId)
      expect(payment.provider_id).toBe(DEV_PROVIDER_ID)
      expect(payment.captured_at).toBeFalsy()
      expect(payment.canceled_at).toBeFalsy()
      const state = devState(payment.data)
      expect(state.simulated).toBe(true)
      expect(state.provider).toBe("development")
      expect(state.state).toBe("authorized")
      expect(numOf(state.amount)).toBeCloseTo(ORDER_TOTAL, 2)
    }, 120000)

    it("3. captures an authorized payment and records the capture exactly once", async () => {
      const { collectionId, order } = await placeDevOrder(1)
      const payment = await getPayment(collectionId)
      expect(payment.captured_at).toBeFalsy()
      expect(devState(payment.data).state).toBe("authorized")

      await capturePaymentWorkflow(container).run({
        input: { payment_id: payment.id },
      })

      const captured = await getPayment(collectionId)
      expect(captured.captured_at).toBeTruthy()
      const state = devState(captured.data)
      expect(state.state).toBe("captured")
      expect(numOf(state.captured_amount)).toBeCloseTo(ORDER_TOTAL, 2)
      // One idempotency key: the capture ran once through the provider.
      expect(state.capture_keys?.length).toBe(1)

      // A duplicate capture request is an idempotent no-op: no second
      // provider call, no double-counted state, no second transaction.
      await capturePaymentWorkflow(container).run({
        input: { payment_id: payment.id },
      })
      const afterDuplicate = await getPayment(collectionId)
      expect(afterDuplicate.captured_at).toBeTruthy()
      const duplicateState = devState(afterDuplicate.data)
      expect(duplicateState.state).toBe("captured")
      expect(numOf(duplicateState.captured_amount)).toBeCloseTo(ORDER_TOTAL, 2)
      expect(duplicateState.capture_keys?.length).toBe(1)

      // The order recorded exactly one capture transaction for the full
      // amount.
      const orderModule = container.resolve(Modules.ORDER)
      const captureTransactions = await orderModule.listOrderTransactions({
        order_id: order.id,
        reference: "capture",
      })
      expect(captureTransactions.length).toBe(1)
      expect(numOf(captureTransactions[0].amount)).toBeCloseTo(
        ORDER_TOTAL,
        2
      )
    }, 120000)

    it("4. refunds a captured payment in parts and rejects refunds beyond it", async () => {
      const { collectionId, order } = await placeDevOrder(1)
      const payment = await getPayment(collectionId)
      await capturePaymentWorkflow(container).run({
        input: { payment_id: payment.id },
      })

      // Partial refund of 5.00: still captured, refund tracked in state.
      await refundPaymentWorkflow(container).run({
        input: { payment_id: payment.id, amount: 5 },
      })
      const partiallyRefunded = await getPayment(collectionId)
      const partialState = devState(partiallyRefunded.data)
      expect(partialState.state).toBe("captured")
      expect(numOf(partialState.refunded_amount)).toBeCloseTo(5, 2)
      expect(partialState.refunds?.length).toBe(1)
      expect(numOf(partialState.refunds?.[0]?.amount)).toBeCloseTo(5, 2)

      // The remaining 18.80 completes the refund: state `refunded`.
      await refundPaymentWorkflow(container).run({
        input: { payment_id: payment.id, amount: 18.8 },
      })
      const refunded = await getPayment(collectionId)
      const refundState = devState(refunded.data)
      expect(refundState.state).toBe("refunded")
      expect(numOf(refundState.refunded_amount)).toBeCloseTo(ORDER_TOTAL, 2)
      expect(refundState.refunds?.length).toBe(2)
      expect(numOf(refundState.refunds?.[1]?.amount)).toBeCloseTo(18.8, 2)

      // Both refunds are recorded on the order as negative transactions.
      const orderModule = container.resolve(Modules.ORDER)
      const refundTransactions = await orderModule.listOrderTransactions({
        order_id: order.id,
        reference: "refund",
      })
      expect(refundTransactions.length).toBe(2)

      // Refunding beyond the captured amount is rejected by the workflow's
      // validation step BEFORE it reaches the provider. Capture the
      // rejection whether the workflow surfaces it by throwing or through
      // the returned `errors` array (same pattern as the order-lifecycle
      // suite).
      let rejection: unknown
      try {
        const outcome = (await refundPaymentWorkflow(container).run({
          input: { payment_id: payment.id, amount: 1 },
        })) as { errors?: Array<{ error?: Error }> }
        rejection = outcome?.errors?.[0]?.error
      } catch (error) {
        rejection = error
      }
      expect(rejection).toBeTruthy()
      expect(String((rejection as Error).message)).toMatch(
        /not allowed to refund more than the captured amount/
      )

      // The rejected attempt changed nothing.
      const afterRejected = await getPayment(collectionId)
      const afterState = devState(afterRejected.data)
      expect(afterState.state).toBe("refunded")
      expect(numOf(afterState.refunded_amount)).toBeCloseTo(ORDER_TOTAL, 2)
      expect(afterState.refunds?.length).toBe(2)
    }, 120000)

    it("5. cancels an uncaptured order through the provider", async () => {
      const { collectionId, order } = await placeDevOrder(1)
      const payment = await getPayment(collectionId)
      expect(payment.captured_at).toBeFalsy()

      // Invoked exactly like the admin cancel route does.
      await cancelOrderWorkflow(container).run({
        input: { order_id: order.id },
      })

      // The provider recorded the cancel and Medusa stamped canceled_at.
      const canceledPayment = await getPayment(collectionId)
      expect(canceledPayment.canceled_at).toBeTruthy()
      const state = devState(canceledPayment.data)
      expect(state.state).toBe("canceled")

      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: canceledOrders } = await query.graph({
        entity: "order",
        fields: ["id", "status", "canceled_at"],
        filters: { id: order.id },
      })
      expect(canceledOrders.length).toBe(1)
      expect(canceledOrders[0].status).toBe("canceled")
      expect(canceledOrders[0].canceled_at).toBeTruthy()
    }, 120000)

    it("6. declines a simulated payment, leaving no order and an errored session", async () => {
      const cartId = await createCartWithItem(1)
      await addStandardShipping(cartId)
      const collectionId = await createPaymentCollection(cartId)

      // The storefront (or a test) asks the provider to decline.
      await createPaymentSession(collectionId, DEV_PROVIDER_ID, {
        simulate: "decline",
      })
      const sessions = await listSessions(collectionId)
      expect(sessions.length).toBe(1)
      expect(sessions[0].status).toBe("pending")
      const initiated = devState(sessions[0].data)
      expect(initiated.state).toBe("initiated")
      expect(initiated.simulation).toBe("decline")

      // Authorization fails: the module reports the session was not
      // authorized (MedusaError NOT_ALLOWED), which the complete-cart route
      // rethrows as HTTP 400 — not the 2xx-with-error soft path reserved
      // for PAYMENT_AUTHORIZATION_ERROR.
      const error = await expectHttpError(
        api.post(
          `/store/carts/${cartId}/complete`,
          {},
          { headers: headers() }
        ),
        [400],
        "complete cart with declined development payment"
      )
      expect(String(error?.response?.data?.message)).toMatch(
        /not authorized with the provider/
      )

      // No order exists: the workflow compensated its creation, so a
      // declined payment never leaves an order behind.
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id"],
      })
      expect(orders.length).toBe(0)

      // The session is errored and keeps the simulated failure reason for
      // inspection; no payment row was ever created.
      const erroredSessions = await listSessions(collectionId)
      expect(erroredSessions.length).toBe(1)
      expect(erroredSessions[0].status).toBe("error")
      const state = devState(erroredSessions[0].data)
      expect(state.state).toBe("error")
      expect(state.failure_reason).toBe("simulated_decline")

      const paymentModule = container.resolve(Modules.PAYMENT)
      const payments = await paymentModule.listPayments({
        payment_session_id: erroredSessions[0].id,
      })
      expect(payments.length).toBe(0)
    }, 120000)

    it("7. keeps one payment session and one order across duplicate requests", async () => {
      const cartId = await createCartWithItem(1)
      await addStandardShipping(cartId)
      const collectionId = await createPaymentCollection(cartId)

      // Creating the same session twice leaves exactly one session: the
      // create-payment-sessions workflow deletes existing sessions as it
      // creates the replacement (no split payments).
      await createPaymentSession(collectionId, DEV_PROVIDER_ID)
      await createPaymentSession(collectionId, DEV_PROVIDER_ID)
      const sessions = await listSessions(collectionId)
      expect(sessions.length).toBe(1)
      expect(sessions[0].provider_id).toBe(DEV_PROVIDER_ID)
      expect(sessions[0].status).toBe("pending")

      const first = await completeCart(cartId)
      expect(first.type).toBe("order")
      const orderId = first.order.id

      // A repeated completion never duplicates the order: it either
      // returns the same order (idempotent) or fails — never a second
      // order.
      let retryOrderId: string | undefined
      try {
        const { data: retry } = await api.post(
          `/store/carts/${cartId}/complete`,
          {},
          { headers: headers() }
        )
        retryOrderId = retry?.order?.id
      } catch (error: any) {
        expect([400, 404, 409]).toContain(error?.response?.status)
      }
      if (retryOrderId) {
        expect(retryOrderId).toBe(orderId)
      }

      // Exactly one order exists either way (the runner restores the
      // pre-suite snapshot before this test, so the order set is exactly
      // what this test created).
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id"],
      })
      expect(orders.length).toBe(1)
      expect(orders[0].id).toBe(orderId)
    }, 120000)

    it("8. rejects the development provider when it is not enabled in the cart's region", async () => {
      // Narrow the region to the manual test provider only.
      // `updateRegionsWorkflow` replaces the provider set.
      await updateRegionsWorkflow(container).run({
        input: {
          selector: { id: regionId },
          update: { payment_providers: [SYSTEM_PROVIDER_ID] },
        },
      })

      const cartId = await createCartWithItem(1)
      await addStandardShipping(cartId)
      const collectionId = await createPaymentCollection(cartId)

      // A session for the development provider is rejected with HTTP 400
      // (INVALID_DATA) before any session row is written.
      const error = await expectHttpError(
        api.post(
          `/store/payment-collections/${collectionId}/payment-sessions`,
          { provider_id: DEV_PROVIDER_ID },
          { headers: headers() }
        ),
        [400],
        "create development-provider session outside its region"
      )
      expect(String(error?.response?.data?.message)).toMatch(
        /is not enabled in the cart's region/
      )
      expect((await listSessions(collectionId)).length).toBe(0)

      // The manual test provider still works for the same cart — the guard
      // is provider-specific, not a broken region.
      await createPaymentSession(collectionId, SYSTEM_PROVIDER_ID)
      const sessions = await listSessions(collectionId)
      expect(sessions.length).toBe(1)
      expect(sessions[0].provider_id).toBe(SYSTEM_PROVIDER_ID)
      expect(sessions[0].status).toBe("pending")
    }, 120000)

    it("9. holds capture and refund invariants under simultaneous duplicate requests", async () => {
      const { collectionId, order } = await placeDevOrder(1)
      const payment = await getPayment(collectionId)
      const orderModule = container.resolve(Modules.ORDER)

      // Four IDENTICAL capture requests at the same instant — the double-
      // click / retry-storm case. Tests 3-4 only prove sequential retries.
      // At least one must succeed; whatever the others do (idempotent 200
      // or a clean rejection) must not corrupt the money records.
      const captures = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          api.post(
            `/admin/payments/${payment.id}/capture`,
            {},
            { headers: adminHeaders() }
          )
        )
      )
      const capturesOk = captures.filter((r) => r.status === "fulfilled")
      expect(capturesOk.length).toBeGreaterThan(0)

      // Money invariant 1: exactly ONE capture transaction for the full
      // amount, however many requests raced.
      const captureTransactions = await orderModule.listOrderTransactions({
        order_id: order.id,
        reference: "capture",
      })
      expect(captureTransactions.length).toBe(1)
      expect(numOf(captureTransactions[0].amount)).toBeCloseTo(ORDER_TOTAL, 2)

      const captured = await getPayment(collectionId)
      expect(captured.captured_at).toBeTruthy()
      const capturedState = devState(captured.data)
      expect(capturedState.state).toBe("captured")
      expect(numOf(capturedState.captured_amount)).toBeCloseTo(ORDER_TOTAL, 2)

      // Four IDENTICAL full-amount refunds at the same instant. Each one
      // alone is a legitimate "refund everything"; four of them together
      // must still only ever move the captured amount once.
      const refunds = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          api.post(
            `/admin/payments/${payment.id}/refund`,
            { amount: ORDER_TOTAL },
            { headers: adminHeaders() }
          )
        )
      )
      const refundsOk = refunds.filter((r) => r.status === "fulfilled")
      expect(refundsOk.length).toBeGreaterThan(0)

      // Money invariant 2: the order never records more refunded than was
      // captured, no matter how many identical requests raced.
      const refundTransactions = await orderModule.listOrderTransactions({
        order_id: order.id,
        reference: "refund",
      })
      // Order transactions record refunds as NEGATIVE amounts (see test 4),
      // so the invariants compare magnitudes.
      const refundTotal = Math.abs(
        refundTransactions.reduce((sum, t) => sum + numOf(t.amount), 0)
      )
      // Money invariant: never more refunded than was captured, no matter
      // how many identical requests raced.
      expect(refundTotal).toBeLessThanOrEqual(ORDER_TOTAL + 1e-6)
      // Correct behavior on top of the floor: exactly one full refund lands.
      expect(refundTotal).toBeCloseTo(ORDER_TOTAL, 2)

      // Money invariant 3: the provider's own state agrees with the order —
      // never over-refunded, still a consistent state machine.
      const refunded = await getPayment(collectionId)
      const refundedState = devState(refunded.data)
      expect(refundedState.state).toBe("refunded")
      expect(numOf(refundedState.refunded_amount)).toBeLessThanOrEqual(
        ORDER_TOTAL + 1e-6
      )
      expect(numOf(refundedState.refunded_amount)).toBeCloseTo(
        ORDER_TOTAL,
        2
      )
      expect(refundedState.refunds?.length).toBe(1)
    }, 120000)
  },
})
