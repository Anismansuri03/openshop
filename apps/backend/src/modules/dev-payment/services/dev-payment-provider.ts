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
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrieveAccountHolderInput,
  RetrieveAccountHolderOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
} from "@medusajs/framework/types"

/**
 * OpenShop development payment provider (G5).
 *
 * A clearly labelled, self-contained payment provider that implements the
 * full Medusa payment lifecycle — initiate, authorize, capture, refund,
 * cancel — against an in-memory state machine persisted in the payment
 * `data` blob Medusa round-trips on every provider call. It never opens a
 * network connection, never touches a payment network, and can never move
 * real money: every record it writes is stamped `simulated: true`.
 *
 * Registered in `medusa-config.ts` as:
 *
 *   resolve: "@medusajs/medusa/payment"
 *   options.providers: [{ resolve: "./src/modules/dev-payment", id: "default" }]
 *
 * which Medusa turns into the container key `pp_dev-payment_default`
 * (`pp_{identifier}_{id}` — see @medusajs/payment dist/loaders/providers.js).
 *
 * Safeguards (see docs/PAYMENTS.md):
 *  - `validateOptions` refuses to boot in production unless
 *    ENABLE_DEV_PAYMENT_PROVIDER=true is set explicitly.
 *  - Every boot prints a "simulated payments only" warning.
 *  - State records carry `simulated: true` + `provider: "development"`
 *    so any inspection (API, admin, database) shows what it is.
 *
 * Simulation directives: the store payment-session route forwards request
 * `data` to `initiatePayment`. Supported keys:
 *
 *   data.simulate = "decline"      -> authorization fails (session status
 *                                     `error`, order completion rejected)
 *   data.simulate = "auto-capture" -> authorization returns `captured`, so
 *                                     Medusa captures immediately
 */

/** Options the provider accepts: none today; unknown keys are rejected. */
export type DevPaymentOptions = Record<string, never>

/** Lifecycle states the provider tracks for each payment. */
export type DevPaymentStateName =
  | "initiated"
  | "authorized"
  | "captured"
  | "canceled"
  | "refunded"
  | "error"

export type DevPaymentSimulation = "decline" | "auto-capture"

/** The provider's slice of the payment `data` blob. */
export type DevPaymentState = {
  /** Stamped on every record: this payment is simulated, not real. */
  simulated: true
  provider: "development"
  /** Provider-side id: the module's idempotency key (session/payment id). */
  id: string
  state: DevPaymentStateName
  /** Amount in the currency's main unit (Medusa v2 decimal amounts). */
  amount: number
  currency_code: string
  captured_amount: number
  refunded_amount: number
  refunds: Array<{ id: string; amount: number }>
  /** Idempotency keys already used for capture operations. */
  capture_keys: string[]
  authorize_key?: string
  failure_reason?: string
  simulation?: DevPaymentSimulation
  created_at: string
  updated_at: string
}

type DevPaymentData = Record<string, unknown> & {
  dev_payment?: DevPaymentState
  simulate?: unknown
}

const SIMULATION_VALUES: readonly DevPaymentSimulation[] = [
  "decline",
  "auto-capture",
]

/** Comparison tolerance for decimal amounts (main-unit floats). */
const AMOUNT_EPSILON = 1e-6

/** Coerce the BigNumber-ish values Medusa passes into a plain number. */
function toAmountNumber(value: unknown): number {
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : NaN
  }
  if (value && typeof value === "object") {
    const candidate = value as {
      raw?: { value?: unknown }
      value?: unknown
      toNumber?: () => number
    }
    if (candidate.raw?.value !== undefined) {
      return toAmountNumber(candidate.raw.value)
    }
    if (candidate.value !== undefined) {
      return toAmountNumber(candidate.value)
    }
    if (typeof candidate.toNumber === "function") {
      return candidate.toNumber()
    }
  }
  return NaN
}

/** Keep stored amounts at six decimals so sums never drift. */
function roundMoney(amount: number): number {
  return Math.round(amount * 1e6) / 1e6
}

function readState(
  data: Record<string, unknown> | undefined
): DevPaymentState {
  const state = (data as DevPaymentData | undefined)?.dev_payment
  if (!state || typeof state !== "object" || typeof state.state !== "string") {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Development payment provider: payment data is missing the development payment state. " +
        "This payment was not created by pp_dev-payment_default."
    )
  }
  return state
}

function withState(
  data: Record<string, unknown> | undefined,
  state: DevPaymentState
): Record<string, unknown> {
  return { ...(data ?? {}), dev_payment: state }
}

function touch(state: DevPaymentState): void {
  state.updated_at = new Date().toISOString()
}

function statusFor(state: DevPaymentState): PaymentSessionStatus {
  switch (state.state) {
    case "initiated":
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

function readSimulation(
  data: Record<string, unknown> | undefined
): DevPaymentSimulation | undefined {
  const raw = (data as DevPaymentData | undefined)?.simulate
  if (raw === undefined || raw === null) {
    return undefined
  }
  if (
    typeof raw === "string" &&
    (SIMULATION_VALUES as readonly string[]).includes(raw)
  ) {
    return raw as DevPaymentSimulation
  }
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `Development payment provider: unsupported simulate value "${String(raw)}". ` +
      `Supported values: ${SIMULATION_VALUES.join(", ")}.`
  )
}

export class DevPaymentProvider extends AbstractPaymentProvider<DevPaymentOptions> {
  static identifier = "dev-payment"

  constructor(cradle: Record<string, unknown>, config: DevPaymentOptions = {}) {
    super(cradle, config)
  }

  /**
   * Runs eagerly when the payment module loads the provider — the single
   * place that can fail the boot before any payment can be simulated.
   *
   * The parameter type mirrors AbstractPaymentProvider.validateOptions
   * (`Record<any, any>`) so the static override type-checks; the body still
   * rejects any non-empty options object (this provider takes none).
   */
  static validateOptions(options?: Record<any, any>): void {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_DEV_PAYMENT_PROVIDER !== "true"
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "The development payment provider (pp_dev-payment_default) only simulates payments and " +
          "never processes real money, so it refuses to run in production. Either remove it from " +
          "the payment providers list in medusa-config.ts, or set ENABLE_DEV_PAYMENT_PROVIDER=true " +
          "to acknowledge that payments are simulated. See docs/PAYMENTS.md."
      )
    }
    if (
      options !== undefined &&
      (typeof options !== "object" ||
        options === null ||
        Array.isArray(options) ||
        Object.keys(options).length > 0)
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Development payment provider: this provider takes no options. " +
          "Remove the options entry from medusa-config.ts."
      )
    }
    console.warn(
      "[OpenShop] Development payment provider (pp_dev-payment_default) registered: " +
        "payments are simulated and no real money is ever processed. See docs/PAYMENTS.md."
    )
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const amount = toAmountNumber(input.amount)
    if (!Number.isFinite(amount)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Development payment provider: invalid amount for initiation (${String(
          input.amount
        )}).`
      )
    }

    const idempotencyKey = input.context?.idempotency_key
    const existing = (input.data as DevPaymentData | undefined)?.dev_payment
    if (existing && idempotencyKey && existing.id === idempotencyKey) {
      // Duplicate initiation for the same session: return the current state.
      return {
        id: existing.id,
        data: input.data,
        status: statusFor(existing),
      }
    }

    const simulation = readSimulation(input.data)
    const now = new Date().toISOString()
    const state: DevPaymentState = {
      simulated: true,
      provider: "development",
      id: idempotencyKey ?? randomUUID(),
      state: "initiated",
      amount: roundMoney(amount),
      currency_code: input.currency_code,
      captured_amount: 0,
      refunded_amount: 0,
      refunds: [],
      capture_keys: [],
      ...(simulation ? { simulation } : {}),
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
      return { data: input.data, status: statusFor(state) }
    }
    if (state.state === "canceled" || state.state === "refunded") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Development payment provider: cannot authorize a ${state.state} payment.`
      )
    }
    if (state.state === "error") {
      // A declined payment stays declined on retries: idempotent failure.
      return { data: input.data, status: PaymentSessionStatus.ERROR }
    }

    if (idempotencyKey) {
      state.authorize_key = idempotencyKey
    }
    touch(state)

    if (state.simulation === "decline") {
      state.state = "error"
      state.failure_reason = "simulated_decline"
      return {
        data: withState(input.data, state),
        status: PaymentSessionStatus.ERROR,
      }
    }
    if (state.simulation === "auto-capture") {
      // Medusa captures immediately when authorize returns `captured`
      // (it does not call capturePayment in that path), so the provider
      // state must reflect the capture here.
      state.state = "captured"
      state.captured_amount = state.amount
      state.capture_keys.push("auto-capture")
      return {
        data: withState(input.data, state),
        status: PaymentSessionStatus.CAPTURED,
      }
    }

    state.state = "authorized"
    return {
      data: withState(input.data, state),
      status: PaymentSessionStatus.AUTHORIZED,
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
        `Development payment provider: cannot capture a ${state.state} payment.`
      )
    }
    if (state.state === "refunded") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Development payment provider: cannot capture a refunded payment."
      )
    }
    if (state.state === "initiated") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Development payment provider: cannot capture a payment before authorization."
      )
    }
    if (idempotencyKey && state.capture_keys.includes(idempotencyKey)) {
      // Duplicate capture request (same capture id): idempotent no-op.
      return { data: input.data }
    }

    // The module owns capture amounts (it never sends them here); the
    // provider records the full amount as captured. Assignment, not
    // addition, so repeated captures can never double-count.
    state.state = "captured"
    state.captured_amount = state.amount
    if (idempotencyKey) {
      state.capture_keys.push(idempotencyKey)
    }
    touch(state)
    return { data: withState(input.data, state) }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const state = readState(input.data)
    const amount = toAmountNumber(input.amount)
    const idempotencyKey = input.context?.idempotency_key

    if (
      idempotencyKey &&
      state.refunds.some((refund) => refund.id === idempotencyKey)
    ) {
      // Duplicate refund request (same refund id): idempotent no-op.
      return { data: input.data }
    }
    if (!Number.isFinite(amount) || !(amount > 0)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Development payment provider: refund amount must be greater than 0."
      )
    }
    if (state.captured_amount <= 0) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Development payment provider: cannot refund a payment that was not captured."
      )
    }

    const totalAfter = roundMoney(state.refunded_amount + amount)
    if (totalAfter > state.captured_amount + AMOUNT_EPSILON) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Development payment provider: cannot refund more than the captured amount."
      )
    }

    state.refunds.push({
      id: idempotencyKey ?? randomUUID(),
      amount: roundMoney(amount),
    })
    state.refunded_amount = totalAfter
    if (totalAfter >= state.captured_amount - AMOUNT_EPSILON) {
      state.state = "refunded"
    }
    touch(state)
    return { data: withState(input.data, state) }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const state = readState(input.data)

    if (state.state === "canceled") {
      // Duplicate cancel: idempotent no-op.
      return { data: input.data }
    }
    if (state.state === "captured" || state.state === "refunded") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Development payment provider: cannot cancel a ${state.state} payment; refund it instead.`
      )
    }

    state.state = "canceled"
    touch(state)
    return { data: withState(input.data, state) }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    // Medusa deletes sessions before recreating them; nothing to release
    // because the provider holds no external resource.
    return { data: input.data }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const state = readState(input.data)

    if (state.state !== "initiated") {
      // Amount changes after authorization cannot change the authorized
      // amount; the module keeps its own session amount in sync.
      return { data: input.data }
    }
    const amount = toAmountNumber(input.amount)
    if (!Number.isFinite(amount)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Development payment provider: invalid amount for update (${String(
          input.amount
        )}).`
      )
    }
    state.amount = roundMoney(amount)
    touch(state)
    return { data: withState(input.data, state) }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    return { status: statusFor(readState(input.data)) }
  }

  async getWebhookActionAndData(): Promise<{ action: PaymentActions }> {
    // This provider has no webhooks and never will: it is simulated.
    return { action: PaymentActions.NOT_SUPPORTED }
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

export default DevPaymentProvider
