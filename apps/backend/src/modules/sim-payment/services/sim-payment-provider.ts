import { randomUUID } from "crypto"
import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  BigNumberValue,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CreateAccountHolderInput,
  CreateAccountHolderOutput,
  DeleteAccountHolderInput,
  DeleteAccountHolderOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrieveAccountHolderInput,
  RetrieveAccountHolderOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  SIM_SIGNATURE_HEADER,
  verifySimSignature,
} from "../webhook-signature"

/**
 * OpenShop local payment simulator (G2).
 *
 * A deterministic, credential-free payment provider that implements the same
 * `AbstractPaymentProvider` contract as real adapters (including signed
 * webhooks) so the whole payment lifecycle, failure surface, and webhook
 * machinery can be exercised with no external services, internet access, or
 * credentials. It is a development/testing tool — never a real payment
 * provider and never a production payment method.
 *
 * Why a separate module instead of extending `dev-payment` (G5): the G5
 * provider is deliberately minimal (two simulation directives, webhook =
 * not_supported) and carries frozen evidence (41 unit + 9 HTTP tests).
 * The simulator adds scenarios, signed webhooks, provider-side drift, and
 * recovery hooks; keeping them apart preserves the G5 invariants untouched
 * while both providers satisfy the same provider-neutral contract
 * (src/modules/payment-contract).
 *
 * Registered in `medusa-config.ts` as:
 *
 *   { resolve: "./src/modules/sim-payment", id: "default" }
 *
 * which Medusa turns into the container key `pp_sim-payment_default`.
 *
 * Safety (mirrors the G5 safeguards, docs/PAYMENTS.md):
 *  - `validateOptions` refuses to boot in production unless
 *    ENABLE_SIM_PAYMENT_PROVIDER=true is set explicitly.
 *  - Every returned provider `data` carries `simulated: true` and the state
 *    blob carries `simulated: true` + `provider: "simulated"`.
 *  - No network call ever happens; there is no code path that could settle
 *    real money, and the simulator can never be mistaken for a live provider
 *    (checkout shows it as test-only).
 *
 * Money: all arithmetic happens in integer minor units (currency exponent
 * table below) — the main-unit decimals Medusa passes are converted once at
 * the boundary. No floating-point money math, ever.
 *
 * Scenarios — the store payment-session route forwards request `data` to
 * `initiatePayment`; supported keys:
 *
 *   data.scenario = "success"          (default) authorize -> authorized
 *   data.scenario = "auto_capture"     authorize -> captured immediately
 *   data.scenario = "decline"          authorize -> error (simulated_decline)
 *   data.scenario = "insufficient_funds" authorize -> error
 *   data.scenario = "timeout"          authorize -> pending with an uncertain
 *                                       result (provider processed it, the
 *                                       response "was lost"); recovery via
 *                                       webhook or reconciliation
 *   data.scenario = "pending"          authorize -> pending until a signed
 *                                       provider event arrives (async method)
 *   data.scenario = "requires_more"    authorize -> requires_more (3DS-like),
 *                                       completed by a signed event
 *   data.scenario = "provider_drift"   provider-side state changes to
 *                                       captured outside the application so
 *                                       reconciliation must detect a mismatch
 */

/** Options the provider accepts. */
export type SimPaymentOptions = {
  /** Shared secret used to sign/verify simulated webhook deliveries. */
  webhookSecret: string
}

export type SimScenario =
  | "success"
  | "auto_capture"
  | "decline"
  | "insufficient_funds"
  | "timeout"
  | "pending"
  | "requires_more"
  | "provider_drift"

const SIM_SCENARIOS: readonly SimScenario[] = [
  "success",
  "auto_capture",
  "decline",
  "insufficient_funds",
  "timeout",
  "pending",
  "requires_more",
  "provider_drift",
]

/** Lifecycle states the simulator tracks for each payment. */
export type SimStateName =
  | "initiated"
  | "pending"
  | "authorized"
  | "captured"
  | "canceled"
  | "refunded"
  | "error"

/** The provider's slice of the payment `data` blob. */
export type SimPaymentState = {
  /** Stamped on every record: this payment is simulated, not real. */
  simulated: true
  provider: "simulated"
  /** Provider-side reference (models a payment intent id). */
  id: string
  state: SimStateName
  scenario: SimScenario
  /** Amount in integer minor units (e.g. cents for EUR/USD). */
  amount_minor: number
  currency_code: string
  captured_minor: number
  refunded_minor: number
  refunds: Array<{ id: string; amount_minor: number }>
  capture_keys: string[]
  authorize_key?: string
  authorize_attempts: number
  failure_reason?: string
  /**
   * What the provider side believes right now. Normally mirrors `state`;
   * the `provider_drift` scenario diverges it on purpose so reconciliation
   * has a mismatch to detect.
   */
  provider_view: SimStateName
  created_at: string
  updated_at: string
}

type SimData = Record<string, unknown> & {
  sim_payment?: SimPaymentState
  scenario?: unknown
}

/** Simulated webhook event shape (see webhook-fixtures.ts). */
export type SimWebhookEvent = {
  id: string
  type: string
  data: {
    /**
     * Medusa payment session id — the simulator's stand-in for Stripe's
     * `intent.metadata.session_id`, the field every official provider uses
     * to re-associate an external event with a local session.
     */
    session_id: string
    /** Provider-side reference (the sim_intent_* id this session created). */
    reference: string
    amount_minor?: number
    currency_code?: string
    failure_reason?: string
  }
}

/** Event types the simulator understands; anything else is NOT_SUPPORTED. */
export const SIM_WEBHOOK_EVENT_TYPES = new Set<string>([
  "sim.payment_intent.succeeded",
  "sim.payment_intent.amount_captured",
  "sim.payment_intent.payment_failed",
  "sim.payment_intent.canceled",
  "sim.payment_intent.processing",
])

/**
 * The slice of a payment session the webhook handler reads. Retrieved from
 * the payment module's internal session service via the provider cradle —
 * the same official pattern the framework documents for providers that must
 * re-associate external events with local sessions.
 */
export type SimWebhookSession = {
  id: string
  data: Record<string, unknown> | null
  provider_id: string
  amount: BigNumberValue
  currency_code: string
}

/** Internal payment-session service exposed on the provider cradle. */
export type SimSessionService = {
  retrieve(
    id: string,
    config?: Record<string, unknown>
  ): Promise<SimWebhookSession>
  update(input: {
    id: string
    data: Record<string, unknown>
  }): Promise<unknown>
}

function isNotFoundError(error: unknown): boolean {
  const err = error as { type?: string; name?: string } | null
  return (
    err?.type === MedusaError.Types.NOT_FOUND ||
    err?.name === MedusaError.Types.NOT_FOUND
  )
}

/* ------------------------------------------------------------------ *
 * Currency minor-unit helpers (integer money math)
 * ------------------------------------------------------------------ */

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
])
const THREE_DECIMAL_CURRENCIES = new Set([
  "bhd", "iqd", "jod", "kwd", "lyd", "omr", "tnd",
])

/** ISO-4217 minor-unit exponent for a currency code. */
export function currencyExponent(currencyCode: string): number {
  const code = currencyCode.toLowerCase()
  if (ZERO_DECIMAL_CURRENCIES.has(code)) {
    return 0
  }
  if (THREE_DECIMAL_CURRENCIES.has(code)) {
    return 3
  }
  return 2
}

/**
 * Convert a Medusa main-unit amount (decimal) to integer minor units.
 * This is the single boundary conversion; everything else is integer math.
 */
export function toMinorUnits(value: unknown, currencyCode: string): number {
  let numeric: number
  if (typeof value === "number") {
    numeric = value
  } else if (typeof value === "string") {
    numeric = Number(value)
  } else if (value && typeof value === "object") {
    const candidate = value as {
      raw?: { value?: unknown }
      value?: unknown
      toNumber?: () => number
    }
    if (candidate.raw?.value !== undefined) {
      return toMinorUnits(candidate.raw.value, currencyCode)
    }
    if (candidate.value !== undefined) {
      return toMinorUnits(candidate.value, currencyCode)
    }
    if (typeof candidate.toNumber === "function") {
      numeric = candidate.toNumber()
    } else {
      return NaN
    }
  } else {
    return NaN
  }
  if (!Number.isFinite(numeric)) {
    return NaN
  }
  return Math.round(numeric * 10 ** currencyExponent(currencyCode))
}

function readState(
  data: Record<string, unknown> | undefined
): SimPaymentState {
  const state = (data as SimData | undefined)?.sim_payment
  if (!state || typeof state !== "object" || typeof state.state !== "string") {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Payment simulator: payment data is missing the simulated payment state. " +
        "This payment was not created by pp_sim-payment_default."
    )
  }
  return state
}

function withState(
  data: Record<string, unknown> | undefined,
  state: SimPaymentState
): Record<string, unknown> {
  // `simulated` is stamped top-level on every provider response so any
  // consumer (API, admin, test) can tell simulated data at a glance.
  return { ...(data ?? {}), simulated: true, sim_payment: state }
}

function touch(state: SimPaymentState): void {
  state.updated_at = new Date().toISOString()
}

function statusFor(state: SimPaymentState): PaymentSessionStatus {
  switch (state.state) {
    case "initiated":
      return PaymentSessionStatus.PENDING
    case "pending":
      return PaymentSessionStatus.PENDING
    case "authorized":
      return PaymentSessionStatus.AUTHORIZED
    case "captured":
    case "refunded":
      return PaymentSessionStatus.CAPTURED
    case "canceled":
      return PaymentSessionStatus.CANCELED
    case "error":
      return PaymentSessionStatus.ERROR
    default:
      return PaymentSessionStatus.ERROR
  }
}

function readScenario(
  data: Record<string, unknown> | undefined
): SimScenario {
  const raw = (data as SimData | undefined)?.scenario
  if (raw === undefined || raw === null) {
    return "success"
  }
  if (
    typeof raw === "string" &&
    (SIM_SCENARIOS as readonly string[]).includes(raw)
  ) {
    return raw as SimScenario
  }
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `Payment simulator: unsupported scenario "${String(raw)}". ` +
      `Supported scenarios: ${SIM_SCENARIOS.join(", ")}.`
  )
}

export class SimPaymentProvider extends AbstractPaymentProvider<SimPaymentOptions> {
  static identifier = "sim-payment"

  protected options_: SimPaymentOptions

  constructor(cradle: Record<string, unknown>, config: SimPaymentOptions) {
    super(cradle, config)
    this.options_ = config
  }

  /**
   * Runs eagerly when the payment module loads the provider — the single
   * place that can fail the boot before any payment can be simulated.
   */
  static validateOptions(options?: Record<any, any>): void {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_SIM_PAYMENT_PROVIDER !== "true"
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "The payment simulator (pp_sim-payment_default) only simulates payments and " +
          "never processes real money, so it refuses to run in production. Either remove it " +
          "from the payment providers list in medusa-config.ts, or set " +
          "ENABLE_SIM_PAYMENT_PROVIDER=true to acknowledge that payments are simulated. " +
          "See docs/PAYMENTS.md."
      )
    }
    const secret = options?.webhookSecret
    if (typeof secret !== "string" || secret.trim().length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment simulator: options.webhookSecret must be a non-empty string. " +
          "Set SIM_PAYMENT_WEBHOOK_SECRET (see .env.template)."
      )
    }
    console.warn(
      "[OpenShop] Payment simulator (pp_sim-payment_default) registered: " +
        "payments are simulated and no real money is ever processed. See docs/PAYMENTS.md."
    )
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const amountMinor = toMinorUnits(input.amount, input.currency_code)
    if (!Number.isFinite(amountMinor)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Payment simulator: invalid amount for initiation (${String(
          input.amount
        )}).`
      )
    }

    const idempotencyKey = input.context?.idempotency_key
    const existing = (input.data as SimData | undefined)?.sim_payment
    if (existing && idempotencyKey && existing.id === idempotencyKey) {
      // Duplicate initiation for the same session: return the current state.
      return {
        id: existing.id,
        data: withState(input.data, existing),
        status: statusFor(existing),
      }
    }

    const scenario = readScenario(input.data)
    const now = new Date().toISOString()
    const state: SimPaymentState = {
      simulated: true,
      provider: "simulated",
      id: idempotencyKey ?? `sim_intent_${randomUUID()}`,
      state: "initiated",
      scenario,
      amount_minor: amountMinor,
      currency_code: input.currency_code.toLowerCase(),
      captured_minor: 0,
      refunded_minor: 0,
      refunds: [],
      capture_keys: [],
      authorize_attempts: 0,
      provider_view: "initiated",
      created_at: now,
      updated_at: now,
    }

    return {
      id: state.id,
      data: withState(input.data, state),
      status: PaymentSessionStatus.PENDING,
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const state = readState(input.data)
    const idempotencyKey = input.context?.idempotency_key

    if (state.state === "authorized" || state.state === "captured") {
      // Duplicate authorization for an already-authorized payment: no-op.
      return { data: withState(input.data, state), status: statusFor(state) }
    }
    if (state.state === "canceled" || state.state === "refunded") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Payment simulator: cannot authorize a ${state.state} payment.`
      )
    }
    if (state.state === "error") {
      // A declined payment stays declined on retries: idempotent failure.
      return {
        data: withState(input.data, state),
        status: PaymentSessionStatus.ERROR,
      }
    }
    if (state.state === "pending" && state.scenario === "timeout") {
      // Retry after an uncertain timeout: the provider already processed
      // the first attempt (see below); a second attempt must not create a
      // second payment. Resolve through the original reference instead.
      return {
        data: withState(input.data, state),
        status: PaymentSessionStatus.PENDING,
      }
    }

    state.authorize_attempts += 1
    if (idempotencyKey) {
      state.authorize_key = idempotencyKey
    }
    touch(state)

    switch (state.scenario) {
      case "decline":
        state.state = "error"
        state.failure_reason = "simulated_decline"
        state.provider_view = "error"
        return {
          data: withState(input.data, state),
          status: PaymentSessionStatus.ERROR,
        }
      case "insufficient_funds":
        state.state = "error"
        state.failure_reason = "simulated_insufficient_funds"
        state.provider_view = "error"
        return {
          data: withState(input.data, state),
          status: PaymentSessionStatus.ERROR,
        }
      case "auto_capture":
        // Medusa captures immediately when authorize returns `captured`
        // (it does not call capturePayment in that path), so the state
        // must reflect the capture here.
        state.state = "captured"
        state.captured_minor = state.amount_minor
        state.capture_keys.push("auto-capture")
        state.provider_view = "captured"
        return {
          data: withState(input.data, state),
          status: PaymentSessionStatus.CAPTURED,
        }
      case "timeout":
        // The provider processed the charge but the response "was lost":
        // from the application's view the result is uncertain, so the
        // session stays pending — never a false success, never a false
        // failure. Recovery: the signed provider event (webhook) or
        // reconciliation against the provider reference.
        state.state = "pending"
        state.provider_view = "authorized"
        return {
          data: withState(input.data, state),
          status: PaymentSessionStatus.PENDING,
        }
      case "pending":
        // Asynchronous payment method: awaiting a signed provider event.
        state.state = "pending"
        state.provider_view = "pending"
        return {
          data: withState(input.data, state),
          status: PaymentSessionStatus.PENDING,
        }
      case "requires_more":
        // Customer must finish extra authentication (3DS-like); a signed
        // provider event completes or fails the payment afterwards.
        state.state = "pending"
        state.provider_view = "pending"
        return {
          data: withState(input.data, state),
          status: PaymentSessionStatus.REQUIRES_MORE,
        }
      case "provider_drift":
        // Locally authorized, but the provider side is captured (e.g. the
        // merchant captured in the provider dashboard) — reconciliation
        // must detect this mismatch.
        state.state = "authorized"
        state.provider_view = "captured"
        return {
          data: withState(input.data, state),
          status: PaymentSessionStatus.AUTHORIZED,
        }
      case "success":
      default:
        state.state = "authorized"
        state.provider_view = "authorized"
        return {
          data: withState(input.data, state),
          status: PaymentSessionStatus.AUTHORIZED,
        }
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const state = readState(input.data)
    const idempotencyKey = input.context?.idempotency_key

    if (state.state === "canceled" || state.state === "error") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Payment simulator: cannot capture a ${state.state} payment.`
      )
    }
    if (state.state === "refunded") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Payment simulator: cannot capture a refunded payment."
      )
    }
    if (state.state === "initiated" || state.state === "pending") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Payment simulator: cannot capture a payment before authorization."
      )
    }
    if (idempotencyKey && state.capture_keys.includes(idempotencyKey)) {
      // Duplicate capture request (same capture id): idempotent no-op.
      return { data: withState(input.data, state) }
    }

    // The module owns capture amounts (it never sends them here); the
    // provider records the full amount as captured. Assignment, not
    // addition, so repeated captures can never double-count.
    state.state = "captured"
    state.captured_minor = state.amount_minor
    state.provider_view = "captured"
    if (idempotencyKey) {
      state.capture_keys.push(idempotencyKey)
    }
    touch(state)
    return { data: withState(input.data, state) }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const state = readState(input.data)
    const amountMinor = toMinorUnits(input.amount, state.currency_code)
    const idempotencyKey = input.context?.idempotency_key

    if (
      idempotencyKey &&
      state.refunds.some((refund) => refund.id === idempotencyKey)
    ) {
      // Duplicate refund request (same refund id): idempotent no-op.
      return { data: withState(input.data, state) }
    }
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment simulator: refund amount must be greater than 0."
      )
    }
    if (state.captured_minor <= 0) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Payment simulator: cannot refund a payment that was not captured."
      )
    }

    // Integer arithmetic only: refunds can never exceed the captured amount.
    const totalAfter = state.refunded_minor + amountMinor
    if (totalAfter > state.captured_minor) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Payment simulator: cannot refund more than the captured amount."
      )
    }

    state.refunds.push({
      id: idempotencyKey ?? `sim_re_${randomUUID()}`,
      amount_minor: amountMinor,
    })
    state.refunded_minor = totalAfter
    if (totalAfter >= state.captured_minor) {
      state.state = "refunded"
      state.provider_view = "refunded"
    }
    touch(state)
    return { data: withState(input.data, state) }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const state = readState(input.data)

    if (state.state === "canceled") {
      // Duplicate cancel: idempotent no-op.
      return { data: withState(input.data, state) }
    }
    if (state.state === "captured" || state.state === "refunded") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Payment simulator: cannot cancel a ${state.state} payment; refund it instead.`
      )
    }

    state.state = "canceled"
    state.provider_view = "canceled"
    touch(state)
    return { data: withState(input.data, state) }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    // Medusa deletes sessions before recreating them; nothing to release
    // because the simulator holds no external resource.
    return { data: input.data ?? {} }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const state = readState(input.data)

    if (state.state !== "initiated") {
      // Amount changes after authorization cannot change the authorized
      // amount; the module keeps its own session amount in sync.
      return { data: withState(input.data, state) }
    }
    const amountMinor = toMinorUnits(input.amount, state.currency_code)
    if (!Number.isFinite(amountMinor)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Payment simulator: invalid amount for update (${String(input.amount)}).`
      )
    }
    state.amount_minor = amountMinor
    touch(state)
    return { data: withState(input.data, state) }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const state = readState(input.data)
    // The provider-side view is authoritative for status retrieval: this is
    // exactly what reconciliation compares the application state against.
    const view = state.provider_view
    const status: PaymentSessionStatus =
      view === "initiated"
        ? PaymentSessionStatus.PENDING
        : view === "pending"
          ? PaymentSessionStatus.PENDING
          : view === "authorized"
            ? PaymentSessionStatus.AUTHORIZED
            : view === "captured"
              ? PaymentSessionStatus.CAPTURED
              : view === "refunded"
                ? PaymentSessionStatus.CAPTURED
                : view === "canceled"
                  ? PaymentSessionStatus.CANCELED
                  : PaymentSessionStatus.ERROR
    return { status }
  }

  /**
   * Signed simulated webhook handling — the same contract the official
   * providers implement (`ProviderWebhookPayload["payload"]` with parsed
   * data, raw body and headers), in the same order of operations:
   *
   *   1. Verify the signature against the RAW body before anything is
   *      trusted (throws UNAUTHORIZED on any mismatch — the caller maps
   *      that to HTTP 400 and never journals or applies the event).
   *   2. Parse and structurally validate the event (id, type, session_id,
   *      reference). Malformed events throw INVALID_DATA.
   *   3. Resolve the local payment session through the payment module's
   *      session service (provider cradle). Foreign/unknown sessions and
   *      unknown event types return NOT_SUPPORTED with NO state written —
   *      exactly how the official providers treat foreign events.
   *   4. Check amount/currency consistency in integer minor units
   *      (UNEXPECTED_STATE on mismatch — rejected before any write).
   *   5. Apply an ADVANCE-ONLY state transition and stamp it onto the
   *      session's `data.sim_payment` (the simulator's provider-side
   *      record) — this is what `authorizePayment` reads after the webhook
   *      so a pending checkout can complete. Stale/out-of-order events
   *      write nothing.
   *   6. Return the provider-neutral `{ action, data: { session_id,
   *      amount } }` the route feeds into `processPaymentWorkflow`.
   *
   * The simulator has no external server: the event names its session
   * (`session_id`) the way Stripe events carry
   * `intent.metadata.session_id`. The signature — not the session
   * reference — is what authenticates the delivery.
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    // 1. Signature first: nothing below runs on an unverified body.
    const headerValue = payload.headers[SIM_SIGNATURE_HEADER]
    const signature = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue
    const verification = verifySimSignature({
      rawBody: payload.rawData,
      header: typeof signature === "string" ? signature : undefined,
      secret: this.options_.webhookSecret,
    })
    if (!verification.valid) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `Payment simulator: webhook signature rejected (${verification.reason}).`
      )
    }

    // 2. Structural validation of the verified event.
    const event = payload.data as SimWebhookEvent | undefined
    if (!event || typeof event.id !== "string" || !event.id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment simulator: webhook event is missing an id."
      )
    }
    if (typeof event.type !== "string" || !event.type) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment simulator: webhook event is missing a type."
      )
    }
    const eventData = event.data
    if (
      !eventData ||
      typeof eventData.session_id !== "string" ||
      !eventData.session_id
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment simulator: webhook event is missing data.session_id."
      )
    }
    if (
      typeof eventData.reference !== "string" ||
      !eventData.reference
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment simulator: webhook event is missing data.reference."
      )
    }

    // Unknown event types are acknowledged without touching anything —
    // the official providers return NOT_SUPPORTED for events they do not
    // handle, so the delivery does not get retried forever.
    if (!SIM_WEBHOOK_EVENT_TYPES.has(event.type)) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    // 3. Resolve the local session through the payment module's internal
    //    session service (exposed on the provider cradle).
    const sessionService = (this.container as Record<string, unknown>)
      .paymentSessionService as SimSessionService | undefined
    if (!sessionService || typeof sessionService.retrieve !== "function") {
      // A missing cradle dependency is a configuration fault, not a bad
      // request: throw a plain error so the route answers 500 (never 400,
      // never an acknowledgment).
      throw new Error(
        "Payment simulator: paymentSessionService is unavailable in the provider " +
          "container; webhooks cannot be processed."
      )
    }
    let session: SimWebhookSession
    try {
      session = await sessionService.retrieve(eventData.session_id, {
        select: ["id", "data", "provider_id", "amount", "raw_amount", "currency_code"],
      })
    } catch (error) {
      if (isNotFoundError(error)) {
        // Unknown/expired session: acknowledged, zero state written.
        return { action: PaymentActions.NOT_SUPPORTED }
      }
      throw error
    }

    // 4a. Association checks: this must be a session this provider owns,
    //     carrying this provider's record, matching this event's reference.
    if (
      typeof session.provider_id !== "string" ||
      !session.provider_id.startsWith("pp_sim-payment")
    ) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }
    const sessionData = (session.data ?? {}) as SimData
    const state = sessionData.sim_payment
    if (!state || typeof state !== "object" || typeof state.state !== "string") {
      // Session not created by the simulator (or its record was stripped).
      return { action: PaymentActions.NOT_SUPPORTED }
    }
    if (eventData.reference !== state.id) {
      // The event names a different provider-side payment: foreign event.
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    // 4b. Amount/currency consistency — integer minor units only, compared
    //     against the session's authoritative amount. A mismatched event is
    //     rejected (UNEXPECTED_STATE -> HTTP 400) before any write.
    const expectedMinor = toMinorUnits(
      session.amount,
      session.currency_code
    )
    if (
      eventData.amount_minor !== undefined &&
      eventData.amount_minor !== expectedMinor
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Payment simulator: webhook event amount does not match the payment amount."
      )
    }
    if (
      eventData.currency_code !== undefined &&
      eventData.currency_code.toLowerCase() !== state.currency_code
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Payment simulator: webhook event currency does not match the payment currency."
      )
    }

    // 5. Advance-only transitions. Stale/out-of-order events return
    //    NOT_SUPPORTED and write nothing; valid ones stamp the session.
    const stale = (): WebhookActionResult => ({
      action: PaymentActions.NOT_SUPPORTED,
    })

    const stamp = async (): Promise<void> => {
      await sessionService.update({
        id: session.id,
        data: withState(session.data ?? {}, state),
      })
    }

    switch (event.type) {
      case "sim.payment_intent.succeeded": {
        if (
          state.state === "captured" ||
          state.state === "refunded" ||
          state.state === "canceled" ||
          state.state === "error"
        ) {
          // Success after a terminal/advanced/failed state: never flip
          // money state backwards or from an out-of-order event.
          return stale()
        }
        state.state = "authorized"
        state.provider_view = "authorized"
        touch(state)
        await stamp()
        return {
          action: PaymentActions.SUCCESSFUL,
          data: { session_id: session.id, amount: session.amount },
        }
      }
      case "sim.payment_intent.amount_captured": {
        if (
          state.state === "canceled" ||
          state.state === "error" ||
          state.state === "refunded"
        ) {
          return stale()
        }
        if (state.state === "initiated" || state.state === "pending") {
          // Capture implies the authorization happened: allow the jump.
          state.state = "captured"
          touch(state)
        } else if (state.state === "authorized") {
          state.state = "captured"
          touch(state)
        } else if (state.state !== "captured") {
          return stale()
        }
        state.captured_minor = state.amount_minor
        state.provider_view = "captured"
        await stamp()
        return {
          action: PaymentActions.SUCCESSFUL,
          data: { session_id: session.id, amount: session.amount },
        }
      }
      case "sim.payment_intent.payment_failed": {
        if (state.state === "captured" || state.state === "refunded") {
          // Failure after capture is a dispute/refund concern for the
          // merchant, not a state transition to apply automatically.
          return stale()
        }
        if (state.state === "error") {
          // Already failed: acknowledge without repeating the transition.
          return {
            action: PaymentActions.FAILED,
            data: { session_id: session.id, amount: session.amount },
          }
        }
        state.state = "error"
        state.failure_reason =
          eventData.failure_reason ?? "simulated_provider_failure"
        state.provider_view = "error"
        touch(state)
        await stamp()
        return {
          action: PaymentActions.FAILED,
          data: { session_id: session.id, amount: session.amount },
        }
      }
      case "sim.payment_intent.canceled": {
        if (
          state.state === "captured" ||
          state.state === "refunded" ||
          state.state === "error"
        ) {
          return stale()
        }
        if (state.state !== "canceled") {
          state.state = "canceled"
          state.provider_view = "canceled"
          touch(state)
          await stamp()
        }
        return {
          action: PaymentActions.CANCELED,
          data: { session_id: session.id, amount: session.amount },
        }
      }
      case "sim.payment_intent.processing": {
        if (
          state.state !== "initiated" &&
          state.state !== "pending"
        ) {
          // Intermediate event arriving after authorization: stale.
          return stale()
        }
        state.state = "pending"
        state.provider_view = "pending"
        touch(state)
        await stamp()
        return {
          action: PaymentActions.PENDING,
          data: { session_id: session.id, amount: session.amount },
        }
      }
      default:
        return stale()
    }
  }
  async retrieveAccountHolder(
    input: RetrieveAccountHolderInput
  ): Promise<RetrieveAccountHolderOutput> {
    return { id: input.id }
  }

  async createAccountHolder(
    input: CreateAccountHolderInput
  ): Promise<CreateAccountHolderOutput> {
    return { id: input.context.customer.id }
  }

  async deleteAccountHolder(
    input: DeleteAccountHolderInput
  ): Promise<DeleteAccountHolderOutput> {
    return { data: {} }
  }
}

export default SimPaymentProvider
