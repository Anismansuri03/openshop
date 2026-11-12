import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { updateRegionsWorkflow } from "@medusajs/core-flows"
import { buildSimEvent } from "../../src/modules/sim-payment/webhook-fixtures"
import { signSimPayload } from "../../src/modules/sim-payment/webhook-signature"

/**
 * Payment integration suite (G2): webhooks, dedup, and reconciliation,
 * end to end through HTTP against a real backend and a disposable database.
 *
 * This suite exercises the PROVIDER-NEUTRAL webhook pipeline
 * (POST /webhooks/:provider), the payment-events journal, and the admin
 * reconciliation endpoint using the local payment simulator
 * (`pp_sim-payment_default`). The simulator cannot move money, and this
 * suite makes no claim about real-provider readiness: everything requiring
 * Stripe test-mode credentials (G2-G) is BLOCKED and NOT counted here (see
 * docs/G2_SANDBOX_VALIDATION.md). What is proven here is the machinery a
 * real provider plugs into:
 *
 *   1. Registration — the simulator boots registered and enabled and is
 *      offered in the store's region.
 *   2. Signature rejection — a wrong secret and a missing signature header
 *      both answer 400 and write NO journal row (unverified deliveries can
 *      never reach the journal).
 *   3. Amount mismatch — a correctly signed event describing a different
 *      amount is rejected 400 before any state is written; the persisted
 *      amount is an exact integer minor-unit value.
 *   4. Order recovery — a signed `succeeded` event for a pending (never
 *      completed) cart runs the official processPaymentWorkflow: the cart
 *      completes into an order, the payment is created and captured, and
 *      the journal records the event as processed.
 *   5. Deduplication — an identical redelivery answers 200
 *      `{received:true, duplicate:true}` and creates no second order.
 *   6. In-flight guard — an event already being processed answers 409 and
 *      is NOT applied (no order), leaving the journal row `processing`.
 *   7. Out-of-order events — a stale `processing` event after
 *      authorization is acknowledged (`not_supported`) with zero change to
 *      money state (never captured by a late intermediate event).
 *   8. Failure events — `payment_failed` is journaled and acknowledged
 *      WITHOUT running the workflow: the session turns errored, no order
 *      and no payment row are created.
 *   9. Unknown provider path — answers 404.
 *  10. Stripe without credentials — answers 404, the provider is absent
 *      from the module, and nothing is journaled: Stripe is simply
 *      unavailable (no fallback to the simulator, ever).
 *  11. Reconciliation in_sync — two runs produce identical classifications
 *      with distinct run ids, and reconciliation never moves money
 *      (no capture, no state change).
 *  12. Reconciliation capture_mismatch — provider-side drift (scenario
 *      `provider_drift`) is surfaced as a report and still never
 *      auto-charges.
 *  13. Reconciliation of an unknown payment — 404.
 *
 * Fixtures: the database `openshop_g2_payment` is pre-created and
 * pre-migrated with the app's documented clean-install step before the run
 * (two-step procedure in docs/local-development.md); the runner boots the
 * app on an ephemeral port and DROPS the suite database afterwards. It
 * reads DB_* only and never touches the developer's configured database.
 *
 * Snapshot semantics: the runner snapshots after `beforeAll` and restores
 * before every test, so each scenario below creates its own cart/order.
 */

const VARIANT_SKU = "SHIRT-S-WHITE"
const INITIAL_STOCK = 5

const SIM_PROVIDER_ID = "pp_sim-payment_default"
const SYSTEM_PROVIDER_ID = "pp_system_default"
const STRIPE_PROVIDER_ID = "pp_stripe_stripe"

/**
 * Simulator webhook signing secret — mirrors the exact fallback expression
 * in medusa-config.ts (non-production runs use a well-known LOCAL value;
 * it is not a credential and the simulator cannot move money). The test
 * process and the booted app share process.env, so both sides always
 * agree.
 */
const SIM_SECRET =
  process.env.SIM_PAYMENT_WEBHOOK_SECRET || "openshop-local-sim-webhook-secret"

/** Coerce Medusa BigNumber-ish values before numeric assertions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numOf(value: any): number {
  const direct = Number(value)
  if (Number.isFinite(direct)) {
    return direct
  }
  return Number(value?.value ?? value?.raw?.value ?? NaN)
}

/** The simulator's state-machine slice inside a session/payment data blob. */
type SimStateView = {
  simulated?: boolean
  provider?: string
  id?: string
  state?: string
  provider_view?: string
  amount_minor?: number
  currency_code?: string
  scenario?: string
  captured_minor?: number
}

function simState(data: unknown): SimStateView {
  const state = (data as { sim_payment?: SimStateView } | undefined)
    ?.sim_payment
  expect(state).toBeTruthy()
  return state as SimStateView
}

medusaIntegrationTestRunner({
  dbName: "openshop_g2_payment",
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

    function adminHeaders() {
      return { Authorization: `Bearer ${adminToken}` }
    }

    const deAddress = {
      first_name: "G2",
      last_name: "Payment",
      address_1: "Teststrasse 5",
      postal_code: "10115",
      city: "Berlin",
      country_code: "de",
      province: "BE",
      phone: "+490000000002",
    }

    beforeAll(async () => {
      container = getContainer()

      // Admin (merchant) session for the reconciliation admin routes, using
      // the documented pattern (same as the G5/G3 suites). Part of the
      // snapshot.
      const workflowService = container.resolve(Modules.WORKFLOW_ENGINE)
      const authService = container.resolve(Modules.AUTH)
      const email = "g2-admin@test.com"
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

      // Seeded variant + inventory item + stock location (pinned level so
      // webhook-triggered completion always has stock to reserve).
      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: [
          "id",
          "sku",
          "inventory_items",
          "inventory_items.inventory_item_id",
        ],
        filters: { sku: VARIANT_SKU },
      })
      expect(variants.length).toBe(1)
      variantId = variants[0].id
      inventoryItemId = variants[0].inventory_items[0].inventory_item_id

      const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)
      const locations = await stockLocationModule.listStockLocations({})
      expect(locations.length).toBeGreaterThan(0)
      locationId = locations[0].id

      const inventoryModule = container.resolve(Modules.INVENTORY)
      await inventoryModule.updateInventoryLevels({
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        stocked_quantity: INITIAL_STOCK,
      })

      // The simulator must be registered by the payment module boot
      // before the region can offer it.
      const paymentModule = container.resolve(Modules.PAYMENT)
      const registered = await paymentModule.listPaymentProviders({
        id: SIM_PROVIDER_ID,
        is_enabled: true,
      })
      expect(registered.length).toBe(1)

      // Offer the manual test provider alongside the simulator. The update
      // REPLACES the provider set and validates every listed provider.
      await updateRegionsWorkflow(container).run({
        input: {
          selector: { id: regionId },
          update: { payment_providers: [SYSTEM_PROVIDER_ID, SIM_PROVIDER_ID] },
        },
      })
    }, 180000)

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
          email: "g2.payment.tester@example.com",
          shipping_address: deAddress,
          billing_address: deAddress,
        },
        { headers: headers() }
      )
      return cartId
    }

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

    async function createPaymentCollection(cartId: string): Promise<string> {
      const { data } = await api.post(
        "/store/payment-collections",
        { cart_id: cartId },
        { headers: headers() }
      )
      return data.payment_collection.id
    }

    async function createPaymentSession(
      collectionId: string,
      sessionData?: Record<string, unknown>
    ) {
      const body: Record<string, unknown> = { provider_id: SIM_PROVIDER_ID }
      if (sessionData) {
        body.data = sessionData
      }
      await api.post(
        `/store/payment-collections/${collectionId}/payment-sessions`,
        body,
        { headers: headers() }
      )
    }

    async function listSessions(collectionId: string) {
      const paymentModule = container.resolve(Modules.PAYMENT)
      return await paymentModule.listPaymentSessions({
        payment_collection_id: collectionId,
      })
    }

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

    async function countPayments(collectionId: string) {
      const sessions = await listSessions(collectionId)
      if (!sessions.length) {
        return 0
      }
      const paymentModule = container.resolve(Modules.PAYMENT)
      const payments = await paymentModule.listPayments({
        payment_session_id: sessions[0].id,
      })
      return payments.length
    }

    async function countOrders(): Promise<number> {
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id"],
      })
      return orders.length
    }

    /** Journal lookup for the simulator's webhook events. */
    function journal() {
      return container.resolve("paymentEvents")
    }

    /**
     * Builds and signs a simulated webhook delivery with the exact raw
     * bytes sent over HTTP (the route verifies against those bytes), then
     * POSTs it to the provider-neutral endpoint.
     */
    async function deliverWebhook(
      event: unknown,
      options: { secret?: string; path?: string } = {}
    ) {
      const raw = JSON.stringify(event)
      const header = signSimPayload(raw, options.secret ?? SIM_SECRET)
      return await api.post(options.path ?? "/webhooks/sim-payment", raw, {
        headers: {
          "content-type": "application/json",
          "x-sim-signature": header,
        },
      })
    }

    /** A cart + collection + simulator session, awaiting its webhook. */
    async function createPendingSimPayment(sessionData?: Record<string, unknown>) {
      const cartId = await createCartWithItem(1)
      await addStandardShipping(cartId)
      const collectionId = await createPaymentCollection(cartId)
      await createPaymentSession(collectionId, sessionData)
      const sessions = await listSessions(collectionId)
      expect(sessions.length).toBe(1)
      const state = simState(sessions[0].data)
      return { cartId, collectionId, session: sessions[0], state }
    }

    /** A completed order through the simulator's default success path. */
    async function placeSimOrder(sessionData?: Record<string, unknown>) {
      const cartId = await createCartWithItem(1)
      await addStandardShipping(cartId)
      const collectionId = await createPaymentCollection(cartId)
      await createPaymentSession(collectionId, sessionData)
      const { data } = await api.post(
        `/store/carts/${cartId}/complete`,
        {},
        { headers: headers() }
      )
      expect(data.type).toBe("order")
      return { cartId, collectionId, order: data.order }
    }

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
          throw error
        }
        expect(expectedStatuses).toContain(status)
        return error
      }
      throw new Error(`${label}: expected an HTTP error, but the call succeeded`)
    }

    it("1. registers the payment simulator and offers it in the store region", async () => {
      const paymentModule = container.resolve(Modules.PAYMENT)

      const providers = await paymentModule.listPaymentProviders({
        id: SIM_PROVIDER_ID,
        is_enabled: true,
      })
      expect(providers.length).toBe(1)
      expect(providers[0].id).toBe(SIM_PROVIDER_ID)

      const manual = await paymentModule.listPaymentProviders({
        id: SYSTEM_PROVIDER_ID,
        is_enabled: true,
      })
      expect(manual.length).toBe(1)

      const { data } = await api.get(
        `/store/payment-providers?region_id=${regionId}`,
        { headers: headers() }
      )
      const offeredIds = data.payment_providers.map(
        (provider: { id: string }) => provider.id
      )
      expect(offeredIds).toContain(SIM_PROVIDER_ID)
      expect(offeredIds).toContain(SYSTEM_PROVIDER_ID)
      expect(data.count).toBeGreaterThanOrEqual(2)
    }, 120000)

    it("2. rejects unverifiable webhook deliveries with 400 and journals nothing", async () => {
      const event = buildSimEvent({
        type: "sim.payment_intent.succeeded",
        sessionId: "payses_never_verified",
        reference: "sim_intent_never_verified",
      })

      // Wrong signing secret -> signature mismatch -> 400.
      const wrongSecret = await expectHttpError(
        deliverWebhook(event, { secret: "not-the-configured-secret" }),
        [400],
        "webhook signed with the wrong secret"
      )
      expect(String(wrongSecret.response.data.error)).toMatch(/signature/i)

      // Missing signature header entirely -> 400.
      const noHeader = await expectHttpError(
        api.post("/webhooks/sim-payment", JSON.stringify(event), {
          headers: { "content-type": "application/json" },
        }),
        [400],
        "webhook without a signature header"
      )
      expect(String(noHeader.response.data.error)).toMatch(/signature/i)

      // The event id is extracted only AFTER verification, so neither
      // rejected delivery may have written a journal row.
      expect(await journal().findEvent(SIM_PROVIDER_ID, event.id)).toBeNull()
    }, 120000)

    it("3. rejects a signed amount mismatch with 400 before any state is written", async () => {
      const { collectionId, session, state } = await createPendingSimPayment({
        scenario: "pending",
      })

      // The persisted amount is an exact integer minor-unit value.
      expect(Number.isInteger(state.amount_minor)).toBe(true)
      expect(state.amount_minor).toBeGreaterThan(0)

      const event = buildSimEvent({
        type: "sim.payment_intent.succeeded",
        sessionId: session.id,
        reference: state.id!,
        amountMinor: (state.amount_minor as number) + 100,
        currencyCode: state.currency_code,
      })

      const rejected = await expectHttpError(
        deliverWebhook(event),
        [400],
        "signed webhook with a mismatched amount"
      )
      expect(String(rejected.response.data.error)).toMatch(/amount/i)

      // Nothing journaled, nothing stamped: the session is untouched.
      expect(await journal().findEvent(SIM_PROVIDER_ID, event.id)).toBeNull()
      const after = await listSessions(collectionId)
      expect(after.length).toBe(1)
      const afterState = simState(after[0].data)
      expect(afterState.state).toBe("initiated")
      expect(afterState.state).not.toBe("authorized")
      expect(await countOrders()).toBe(0)
    }, 120000)

    it("4. recovers a pending cart into an order when a signed succeeded event arrives", async () => {
      const { collectionId, session, state } = await createPendingSimPayment({
        scenario: "pending",
      })
      // Before the webhook: a pending cart with no order and no payment.
      expect(await countOrders()).toBe(0)
      expect(await countPayments(collectionId)).toBe(0)

      const event = buildSimEvent({
        type: "sim.payment_intent.succeeded",
        sessionId: session.id,
        reference: state.id!,
        amountMinor: state.amount_minor,
        currencyCode: state.currency_code,
      })

      const response = await deliverWebhook(event)
      // SUCCESSFUL normalizes to the value "captured" (PaymentActions).
      expect(response.data).toMatchObject({
        received: true,
        action: "captured",
      })

      // The official processPaymentWorkflow authorized the session (via the
      // simulator's webhook stamp), captured the payment, and completed the
      // cart into an order.
      expect(await countOrders()).toBe(1)
      const payment = await getPayment(collectionId)
      expect(payment.captured_at).toBeTruthy()
      const paymentState = simState(payment.data)
      expect(paymentState.simulated).toBe(true)
      expect(paymentState.provider).toBe("simulated")

      // The journal recorded the event as processed with the applied action.
      const row = await journal().findEvent(SIM_PROVIDER_ID, event.id)
      expect(row).toBeTruthy()
      expect(row.status).toBe("processed")
      expect(row.action).toBe("captured")
    }, 180000)

    it("5. acknowledges an identical redelivery without creating a second order", async () => {
      const { collectionId, session, state } = await createPendingSimPayment({
        scenario: "pending",
      })
      const event = buildSimEvent({
        type: "sim.payment_intent.succeeded",
        sessionId: session.id,
        reference: state.id!,
        amountMinor: state.amount_minor,
        currencyCode: state.currency_code,
      })

      const first = await deliverWebhook(event)
      expect(first.data).toMatchObject({ received: true, action: "captured" })
      expect(await countOrders()).toBe(1)

      // Same event, delivered again: acknowledged as a duplicate WITHOUT
      // reprocessing — still exactly one order.
      const second = await deliverWebhook(event)
      expect(second.data).toEqual({ received: true, duplicate: true })
      expect(await countOrders()).toBe(1)

      // One journal row, still processed (the duplicate wrote nothing).
      const row = await journal().findEvent(SIM_PROVIDER_ID, event.id)
      expect(row.status).toBe("processed")
      expect(await journal().listPaymentEvents({
        provider: SIM_PROVIDER_ID,
        event_id: event.id,
      })).toHaveLength(1)
    }, 180000)

    it("6. answers 409 for an event already being processed and does not apply it", async () => {
      const { session, state } = await createPendingSimPayment({
        scenario: "pending",
      })
      const event = buildSimEvent({
        type: "sim.payment_intent.succeeded",
        sessionId: session.id,
        reference: state.id!,
        amountMinor: state.amount_minor,
        currencyCode: state.currency_code,
      })

      // Another delivery of this exact event is mid-flight (row inserted,
      // apply not finished): simulate by reserving the journal row first.
      const reservation = await journal().reserveWebhookEvent({
        provider: SIM_PROVIDER_ID,
        event_id: event.id,
        payload: { staged_by: "g2-test-in-flight" },
      })
      expect(reservation.outcome).toBe("reserved")

      const conflict = await expectHttpError(
        deliverWebhook(event),
        [409],
        "in-flight event redelivery"
      )
      expect(conflict.response.data.received).toBe(false)
      expect(String(conflict.response.data.error)).toMatch(/already being processed/i)

      // NOT applied: no order was created, and the journal row is still
      // `processing` (its payload was not overwritten by the rejected
      // delivery).
      expect(await countOrders()).toBe(0)
      const row = await journal().findEvent(SIM_PROVIDER_ID, event.id)
      expect(row.status).toBe("processing")
      expect(row.payload).toMatchObject({ staged_by: "g2-test-in-flight" })
    }, 180000)

    it("7. acknowledges a stale out-of-order event without touching money state", async () => {
      const { collectionId } = await placeSimOrder()
      const payment = await getPayment(collectionId)
      expect(payment.captured_at).toBeFalsy()
      const sessions = await listSessions(collectionId)
      expect(sessions[0].status).toBe("authorized")
      const state = simState(sessions[0].data)

      // A late intermediate event arriving after authorization: stale.
      const event = buildSimEvent({
        type: "sim.payment_intent.processing",
        sessionId: sessions[0].id,
        reference: state.id!,
        amountMinor: state.amount_minor,
        currencyCode: state.currency_code,
        eventId: "sim_evt_g2_stale_processing",
      })

      const response = await deliverWebhook(event)
      expect(response.data).toMatchObject({
        received: true,
        action: "not_supported",
      })

      // Money state unchanged: not captured, session still authorized.
      const afterPayment = await getPayment(collectionId)
      expect(afterPayment.captured_at).toBeFalsy()
      const afterSessions = await listSessions(collectionId)
      expect(afterSessions[0].status).toBe("authorized")

      // Journaled as processed (acknowledged), NOT applied.
      const row = await journal().findEvent(SIM_PROVIDER_ID, event.id)
      expect(row.status).toBe("processed")
      expect(row.action).toBe("not_supported")
    }, 120000)

    it("8. journals a payment_failed event without running the workflow", async () => {
      const { collectionId, session, state } = await createPendingSimPayment({
        scenario: "pending",
      })

      const event = buildSimEvent({
        type: "sim.payment_intent.payment_failed",
        sessionId: session.id,
        reference: state.id!,
        amountMinor: state.amount_minor,
        currencyCode: state.currency_code,
        failureReason: "g2_declined",
      })

      const response = await deliverWebhook(event)
      expect(response.data).toMatchObject({ received: true, action: "failed" })

      // FAILED is a non-applied action (same guard list as Medusa's own
      // subscriber): the session turns errored via the provider stamp, but
      // no workflow ran — no order, no payment row.
      const sessions = await listSessions(collectionId)
      expect(sessions[0].status).toBe("pending")
      expect(simState(sessions[0].data).state).toBe("error")
      expect(await countOrders()).toBe(0)
      expect(await countPayments(collectionId)).toBe(0)

      const row = await journal().findEvent(SIM_PROVIDER_ID, event.id)
      expect(row.status).toBe("processed")
      expect(row.action).toBe("failed")
    }, 120000)

    it("9. answers 404 for an unknown webhook provider path", async () => {
      const event = buildSimEvent({
        type: "sim.payment_intent.succeeded",
        sessionId: "payses_unknown_path",
        reference: "sim_intent_unknown_path",
      })
      const error = await expectHttpError(
        deliverWebhook(event, { path: "/webhooks/not-a-provider" }),
        [404],
        "unknown provider webhook path"
      )
      expect(String(error.response.data.error)).toMatch(/unknown payment provider/i)
    }, 120000)

    it("10. answers 404 for Stripe webhooks when Stripe is not configured", async () => {
      // No STRIPE_API_KEY exists (never has) -> the official Stripe
      // provider never registers, and there is deliberately no fallback to
      // the simulator.
      const paymentModule = container.resolve(Modules.PAYMENT)
      const stripeProviders = await paymentModule.listPaymentProviders({
        id: STRIPE_PROVIDER_ID,
      })
      expect(stripeProviders.length).toBe(0)

      const event = buildSimEvent({
        type: "sim.payment_intent.succeeded",
        sessionId: "payses_stripe_absent",
        reference: "sim_intent_stripe_absent",
        eventId: "evt_g2_stripe_unregistered",
      })
      const error = await expectHttpError(
        deliverWebhook(event, { path: "/webhooks/stripe" }),
        [404],
        "Stripe webhook without credentials"
      )
      expect(String(error.response.data.error)).toMatch(/not registered/i)

      // Verification failed before the journal was reachable: no row.
      expect(
        await journal().findEvent(STRIPE_PROVIDER_ID, event.id)
      ).toBeNull()
    }, 120000)

    it("11. reconciles an in-sync payment repeat-safely and never auto-charges", async () => {
      const { collectionId } = await placeSimOrder()
      const payment = await getPayment(collectionId)
      expect(payment.captured_at).toBeFalsy()

      const url = `/admin/payments/${payment.id}/reconcile`

      const run1 = await api.post(url, {}, { headers: adminHeaders() })
      expect(run1.status).toBe(200)
      expect(run1.data.classification).toBe("in_sync")
      expect(run1.data.provider_view.status).toBe("authorized")
      expect(run1.data.run_id).toMatch(/^rec_/)
      expect(run1.data.journal_id).toBeTruthy()

      // Repeat-safe: a second run compares the same way (identical
      // classification), records its OWN run id, and changes nothing.
      const run2 = await api.post(url, {}, { headers: adminHeaders() })
      expect(run2.status).toBe(200)
      expect(run2.data.classification).toBe("in_sync")
      expect(run2.data.run_id).not.toBe(run1.data.run_id)
      expect(run2.data.local).toEqual(run1.data.local)

      // Both runs are journaled with distinct run ids.
      const rows = await journal().listPaymentEvents({
        kind: "reconciliation",
        payment_id: payment.id,
      })
      expect(rows.length).toBeGreaterThanOrEqual(2)
      const runIds = rows.map((r: { event_id: string }) => r.event_id)
      expect(runIds).toContain(run1.data.run_id)
      expect(runIds).toContain(run2.data.run_id)

      // Reconciliation never moves money: still not captured, session
      // unchanged, no capture transactions.
      const after = await getPayment(collectionId)
      expect(after.captured_at).toBeFalsy()
      const sessions = await listSessions(collectionId)
      expect(sessions[0].status).toBe("authorized")
      const orderModule = container.resolve(Modules.ORDER)
      const captureTransactions = await orderModule.listOrderTransactions({
        reference: "capture",
      })
      expect(captureTransactions.length).toBe(0)
    }, 180000)

    it("12. surfaces provider-side capture drift as capture_mismatch without auto-charging", async () => {
      // scenario "provider_drift": locally authorized, provider view says
      // captured (e.g. the merchant captured in the provider dashboard).
      const { collectionId } = await placeSimOrder({
        scenario: "provider_drift",
      })
      const payment = await getPayment(collectionId)
      expect(payment.captured_at).toBeFalsy()

      const url = `/admin/payments/${payment.id}/reconcile`
      const run1 = await api.post(url, {}, { headers: adminHeaders() })
      expect(run1.status).toBe(200)
      expect(run1.data.classification).toBe("capture_mismatch")
      expect(run1.data.provider_view.status).toBe("captured")
      expect(run1.data.local.session_status).toBe("authorized")
      expect(String(run1.data.details.join(" "))).toMatch(/captured_at/)

      // The report is repeat-safe and purely a report: the drift is still
      // there after a second run, and reconciliation did NOT capture the
      // payment (no silent money movement — a human decides).
      const run2 = await api.post(url, {}, { headers: adminHeaders() })
      expect(run2.status).toBe(200)
      expect(run2.data.classification).toBe("capture_mismatch")
      expect(run2.data.run_id).not.toBe(run1.data.run_id)

      const after = await getPayment(collectionId)
      expect(after.captured_at).toBeFalsy()
      const orderModule = container.resolve(Modules.ORDER)
      const captureTransactions = await orderModule.listOrderTransactions({
        reference: "capture",
      })
      expect(captureTransactions.length).toBe(0)
    }, 180000)

    it("13. answers 404 when reconciling an unknown payment", async () => {
      const error = await expectHttpError(
        api.post(
          "/admin/payments/pay_does_not_exist_g2/reconcile",
          {},
          { headers: adminHeaders() }
        ),
        [404],
        "reconcile unknown payment"
      )
      expect(error.response.status).toBe(404)
    }, 120000)
  },
})
