import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { PaymentSessionStatus } from "@medusajs/framework/utils"

/**
 * Provider-neutral payment provider contract (G2).
 *
 * The executable form of the 16-point contract in
 * docs/G2_PAYMENT_ARCHITECTURE_AUDIT.md: every adapter — the local
 * simulator today, real adapters tomorrow — is expected to satisfy these
 * checks, which encode the invariants the whole payment stack relies on:
 *
 *  - identity: the provider exposes a stable identifier;
 *  - integer money: amounts are persisted as EXACT integer minor units and
 *    never drift between initiate/capture (no float arithmetic);
 *  - idempotency: repeating authorize/capture with the same context does
 *    not change the outcome or double-count money;
 *  - honest failure: a declined authorization returns ERROR and a retry
 *    stays ERROR — a failure never silently becomes a success;
 *  - guard rails: capture before authorization, refund beyond the captured
 *    amount, non-positive refunds and cancel-after-capture all REJECT;
 *  - state visibility: getPaymentStatus reflects the provider's own view;
 *  - webhook security (when the adapter signs webhooks): an unverifiable
 *    delivery is REJECTED — it never resolves into an action.
 *
 * How it runs: the full contract is exercised against the simulator in unit
 * tests (credential-free, offline). Running it against the official Stripe
 * adapter end-to-end requires a Stripe sandbox and therefore belongs to
 * G2-G (documented as blocked without credentials) — the offline-safe
 * Stripe subset (identity, validateOptions, signature rejection) is covered
 * separately in stripe-provider.unit.spec.ts.
 */

export type ContractableProvider = {
  getIdentifier(): string
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput>
  authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput>
  capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput>
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput>
  cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput>
  getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput>
  getWebhookActionAndData?(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult>
}

export type PaymentProviderContractInput = {
  /** Human-readable provider name, used in failure messages. */
  name: string
  provider: ContractableProvider
  /** Main-unit amount used across the money checks (e.g. 10.5). */
  amountMain: number
  currencyCode: string
  /**
   * The exact integer minor units `amountMain` must map to for
   * `currencyCode` (e.g. 1050 for 10.5 USD). Computed by the caller so the
   * contract itself contains no money arithmetic.
   */
  expectedAmountMinor: number
  /** Provider-specific initiation data for the success path. */
  initiateData?: Record<string, unknown>
  /**
   * Provider-specific initiation data that must produce a FAILED
   * authorization (e.g. the simulator's decline scenario). Skips the
   * failure checks when absent.
   */
  declineData?: Record<string, unknown>
  /** Status authorizePayment must return on the success path. */
  expectedAuthorizeStatus: PaymentSessionStatus
  /** Run the signed-webhook rejection check. */
  signedWebhooks: boolean
  /** Extract integer minor units from provider-returned data. */
  getAmountMinor(data: Record<string, unknown> | undefined): number
}

export class ProviderContractViolation extends Error {
  readonly check: string

  constructor(check: string, message: string) {
    super(`Provider contract check "${check}" failed: ${message}`)
    this.name = "ProviderContractViolation"
    this.check = check
  }
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`contract internal state "${label}" was not set`)
  }
  return value
}

async function expectRejection(
  label: string,
  fn: () => Promise<unknown>
): Promise<void> {
  try {
    await fn()
  } catch {
    return
  }
  throw new Error(`${label} resolved successfully but must reject`)
}

/**
 * Run the contract. Returns the list of checks that passed; the first
 * violation rejects with a ProviderContractViolation naming the check.
 */
export async function runPaymentProviderContract(
  input: PaymentProviderContractInput
): Promise<{ checks: string[] }> {
  const checks: string[] = []
  const { provider } = input

  const check = async (
    name: string,
    fn: () => Promise<void>
  ): Promise<void> => {
    try {
      await fn()
    } catch (error) {
      if (error instanceof ProviderContractViolation) {
        throw error
      }
      throw new ProviderContractViolation(
        name,
        error instanceof Error ? error.message : String(error)
      )
    }
    checks.push(name)
  }

  let successData: Record<string, unknown> | undefined
  let authData: Record<string, unknown> | undefined
  let capturedData: Record<string, unknown> | undefined

  const isKnownStatus = (status: unknown): status is PaymentSessionStatus =>
    (Object.values(PaymentSessionStatus) as unknown[]).includes(status)

  await check("identifier", async () => {
    const id = provider.getIdentifier()
    if (typeof id !== "string" || !id.trim()) {
      throw new Error(`identifier must be a non-empty string (got ${String(id)})`)
    }
  })

  await check("initiate-integer-minor-units", async () => {
    const result = await provider.initiatePayment({
      amount: input.amountMain,
      currency_code: input.currencyCode,
      data: input.initiateData ?? {},
      context: { idempotency_key: "contract_init_success" },
    })
    if (typeof result.id !== "string" || !result.id) {
      throw new Error("initiatePayment returned no id")
    }
    if (!isKnownStatus(result.status)) {
      throw new Error(`initiatePayment returned invalid status ${String(result.status)}`)
    }
    if (!result.data || typeof result.data !== "object") {
      throw new Error("initiatePayment returned no data blob")
    }
    successData = result.data as Record<string, unknown>
    const minor = input.getAmountMinor(successData)
    if (!Number.isInteger(minor)) {
      throw new Error(
        `persisted amount is not an integer minor-unit value (got ${String(minor)})`
      )
    }
    if (minor !== input.expectedAmountMinor) {
      throw new Error(
        `persisted amount ${minor} does not equal the expected ${input.expectedAmountMinor} minor units`
      )
    }
  })

  await check("authorize-success", async () => {
    const result = await provider.authorizePayment({
      data: requireValue(successData, "successData"),
      context: { idempotency_key: "contract_auth_success" },
    })
    if (result.status !== input.expectedAuthorizeStatus) {
      throw new Error(
        `authorizePayment returned ${String(result.status)}, expected ${String(
          input.expectedAuthorizeStatus
        )}`
      )
    }
    authData = result.data as Record<string, unknown>
  })

  await check("authorize-idempotent", async () => {
    const result = await provider.authorizePayment({
      data: requireValue(authData, "authData"),
      context: { idempotency_key: "contract_auth_success" },
    })
    if (result.status !== input.expectedAuthorizeStatus) {
      throw new Error(
        `repeated authorizePayment returned ${String(result.status)} — authorization is not idempotent`
      )
    }
  })

  await check("payment-status-reflects-authorization", async () => {
    const result = await provider.getPaymentStatus({
      data: requireValue(authData, "authData"),
    })
    if (result.status !== input.expectedAuthorizeStatus) {
      throw new Error(
        `getPaymentStatus returned ${String(result.status)} after authorization`
      )
    }
  })

  await check("capture-no-double-count", async () => {
    let data = requireValue(authData, "authData")
    if (input.expectedAuthorizeStatus !== PaymentSessionStatus.CAPTURED) {
      const first = await provider.capturePayment({
        data,
        context: { idempotency_key: "contract_capture_1" },
      })
      data = first.data as Record<string, unknown>
    }
    const minor = input.getAmountMinor(data)
    if (minor !== input.expectedAmountMinor) {
      throw new Error(
        `captured amount drifted to ${minor} minor units (expected ${input.expectedAmountMinor})`
      )
    }
    const repeat = await provider.capturePayment({
      data,
      context: { idempotency_key: "contract_capture_1" },
    })
    const repeatMinor = input.getAmountMinor(
      repeat.data as Record<string, unknown>
    )
    if (repeatMinor !== input.expectedAmountMinor) {
      throw new Error(
        `repeated capture double-counted: ${repeatMinor} minor units (expected ${input.expectedAmountMinor})`
      )
    }
    capturedData = repeat.data as Record<string, unknown>
  })

  await check("payment-status-reflects-capture", async () => {
    const result = await provider.getPaymentStatus({
      data: requireValue(capturedData, "capturedData"),
    })
    if (result.status !== PaymentSessionStatus.CAPTURED) {
      throw new Error(
        `getPaymentStatus returned ${String(result.status)} after capture`
      )
    }
  })

  await check("refund-over-capture-rejected", async () => {
    // Doubling is exact in binary floating point, so this test input never
    // introduces a rounding question; the contract itself does no money math.
    await expectRejection("refund beyond the captured amount", () =>
      provider.refundPayment({
        amount: input.amountMain * 2,
        data: requireValue(capturedData, "capturedData"),
        context: { idempotency_key: "contract_refund_over" },
      })
    )
  })

  await check("refund-nonpositive-rejected", async () => {
    await expectRejection("zero-amount refund", () =>
      provider.refundPayment({
        amount: 0,
        data: requireValue(capturedData, "capturedData"),
        context: { idempotency_key: "contract_refund_zero" },
      })
    )
  })

  await check("cancel-after-capture-rejected", async () => {
    await expectRejection("cancel after capture", () =>
      provider.cancelPayment({
        data: requireValue(capturedData, "capturedData"),
        context: {},
      })
    )
  })

  await check("capture-before-authorize-rejected", async () => {
    const fresh = await provider.initiatePayment({
      amount: input.amountMain,
      currency_code: input.currencyCode,
      data: input.initiateData ?? {},
      context: { idempotency_key: "contract_init_fresh" },
    })
    await expectRejection("capture before authorization", () =>
      provider.capturePayment({
        data: fresh.data as Record<string, unknown>,
        context: { idempotency_key: "contract_capture_fresh" },
      })
    )
  })

  if (input.declineData) {
    await check("decline-stays-failed", async () => {
      const initiated = await provider.initiatePayment({
        amount: input.amountMain,
        currency_code: input.currencyCode,
        data: input.declineData as Record<string, unknown>,
        context: { idempotency_key: "contract_init_decline" },
      })
      const first = await provider.authorizePayment({
        data: initiated.data as Record<string, unknown>,
        context: { idempotency_key: "contract_auth_decline" },
      })
      if (first.status !== PaymentSessionStatus.ERROR) {
        throw new Error(
          `declined authorization returned ${String(first.status)} — expected ERROR`
        )
      }
      const retry = await provider.authorizePayment({
        data: first.data as Record<string, unknown>,
        context: { idempotency_key: "contract_auth_decline" },
      })
      if (retry.status !== PaymentSessionStatus.ERROR) {
        throw new Error(
          `retrying a declined authorization returned ${String(
            retry.status
          )} — a failure silently became a non-failure`
        )
      }
    })
  }

  if (input.signedWebhooks) {
    await check("webhook-rejects-unverifiable-payload", async () => {
      if (!provider.getWebhookActionAndData) {
        throw new Error(
          "provider declares signed webhooks but implements no getWebhookActionAndData"
        )
      }
      let resolvedAction: string | null = null
      try {
        const result = await provider.getWebhookActionAndData({
          data: {},
          rawData: Buffer.from("{}"),
          headers: {},
        })
        resolvedAction = result.action
      } catch {
        // Rejected (invalid/missing signature): exactly what the contract
        // requires — an unverifiable delivery must not produce an action.
        return
      }
      throw new Error(
        `unverifiable webhook resolved with action "${resolvedAction}" — it must be rejected`
      )
    })
  }

  return { checks }
}
