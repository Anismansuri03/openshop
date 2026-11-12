import { PaymentSessionStatus } from "@medusajs/framework/utils"
import { SimPaymentProvider } from "../../sim-payment/services/sim-payment-provider"
import type { ContractableProvider } from "../contract"
import {
  ProviderContractViolation,
  runPaymentProviderContract,
} from "../contract"

/**
 * Provider-neutral contract tests (G2).
 *
 * Two directions, both credential-free and offline:
 *
 *  1. POSITIVE — the local payment simulator (sim-payment) runs the FULL
 *     contract, proving the executable contract matches real provider
 *     behavior: integer minor-unit persistence, authorize/capture
 *     idempotency, guard rails (capture-before-auth, refund-over-capture,
 *     non-positive refund, cancel-after-capture), honest decline, and
 *     signed-webhook rejection.
 *
 *  2. NEGATIVE — deliberately broken providers prove the contract has
 *     teeth: a provider that double-counts captures, and a provider whose
 *     decline "silently succeeds", are both rejected with a
 *     ProviderContractViolation naming the exact failed check. Without
 *     this, a passing contract would prove nothing.
 */

const SECRET = "contract-unit-webhook-secret-0123456789"

function makeSimProvider(): SimPaymentProvider {
  return new SimPaymentProvider({}, { webhookSecret: SECRET })
}

const simContractInput = (provider: SimPaymentProvider) => ({
  name: "sim-payment",
  provider: provider as unknown as ContractableProvider,
  amountMain: 10.5,
  currencyCode: "usd",
  expectedAmountMinor: 1050,
  initiateData: {},
  declineData: { scenario: "decline" },
  expectedAuthorizeStatus: PaymentSessionStatus.AUTHORIZED,
  signedWebhooks: true,
  getAmountMinor: (data: Record<string, unknown> | undefined): number => {
    const state = (data as { sim_payment?: { amount_minor?: unknown } })
      ?.sim_payment
    return Number(state?.amount_minor)
  },
})

/** The exact ordered list of checks the full contract executes. */
const FULL_CONTRACT_CHECKS = [
  "identifier",
  "initiate-integer-minor-units",
  "authorize-success",
  "authorize-idempotent",
  "payment-status-reflects-authorization",
  "capture-no-double-count",
  "payment-status-reflects-capture",
  "refund-over-capture-rejected",
  "refund-nonpositive-rejected",
  "cancel-after-capture-rejected",
  "capture-before-authorize-rejected",
  "decline-stays-failed",
  "webhook-rejects-unverifiable-payload",
]

describe("runPaymentProviderContract against the payment simulator", () => {
  it("passes every check of the full contract", async () => {
    const result = await runPaymentProviderContract(
      simContractInput(makeSimProvider())
    )
    expect(result.checks).toEqual(FULL_CONTRACT_CHECKS)
  })
})

/**
 * Deliberately broken providers. Each is correct everywhere except for the
 * single defect named by its mode, so the contract must fail on that exact
 * check — proving each guard is actually enforced.
 */
type BrokenMode = "double-capture" | "decline-becomes-success"

function makeBrokenProvider(mode: BrokenMode): ContractableProvider {
  type Blob = { amount_minor: number; status: PaymentSessionStatus }
  /** The test blob stored inside the opaque provider data record. */
  const blob = (data: Record<string, unknown> | undefined): Blob =>
    data as unknown as Blob
  let counter = 0

  return {
    getIdentifier: (): string => "broken-provider",
    initiatePayment: async () => {
      counter += 1
      const data: Blob = {
        amount_minor: 1050,
        status: PaymentSessionStatus.PENDING,
      }
      return {
        id: `broken_${counter}`,
        status: PaymentSessionStatus.PENDING,
        data,
      }
    },
    authorizePayment: async (input) => {
      // Defect carrier for "decline-becomes-success": there is NO code path
      // that can report failure — a declined authorization is silently
      // reported as AUTHORIZED.
      blob(input.data).status = PaymentSessionStatus.AUTHORIZED
      return { data: input.data, status: PaymentSessionStatus.AUTHORIZED }
    },
    capturePayment: async (input) => {
      const state = blob(input.data)
      if (
        state.status === PaymentSessionStatus.PENDING ||
        state.status === PaymentSessionStatus.ERROR
      ) {
        throw new Error("cannot capture before authorization")
      }
      if (mode === "double-capture") {
        // The defect: the reported captured amount ACCUMULATES on every
        // call instead of being assigned, double-counting money.
        state.amount_minor += 1050
      }
      state.status = PaymentSessionStatus.CAPTURED
      return { data: input.data }
    },
    refundPayment: async () => {
      throw new Error("refunds rejected")
    },
    cancelPayment: async () => {
      throw new Error("cancel rejected")
    },
    getPaymentStatus: async (input) => ({
      status: blob(input.data).status,
    }),
  }
}

async function captureViolation(
  provider: ContractableProvider,
  declineData?: Record<string, unknown>
): Promise<ProviderContractViolation> {
  let caught: unknown
  try {
    await runPaymentProviderContract({
      name: "broken-provider",
      provider,
      amountMain: 10.5,
      currencyCode: "usd",
      expectedAmountMinor: 1050,
      declineData,
      expectedAuthorizeStatus: PaymentSessionStatus.AUTHORIZED,
      signedWebhooks: false,
      getAmountMinor: (data) =>
        Number((data as { amount_minor?: unknown } | undefined)?.amount_minor),
    })
  } catch (error) {
    caught = error
  }
  if (!(caught instanceof ProviderContractViolation)) {
    throw new Error(
      `expected a ProviderContractViolation but got: ${String(caught)}`
    )
  }
  return caught
}

describe("runPaymentProviderContract rejects broken providers", () => {
  it("rejects a provider whose capture double-counts the amount", async () => {
    const violation = await captureViolation(
      makeBrokenProvider("double-capture")
    )
    expect(violation.check).toBe("capture-no-double-count")
    expect(violation.message).toMatch(/double-counted|drifted/)
  })

  it("rejects a provider whose decline silently becomes a success", async () => {
    const violation = await captureViolation(
      makeBrokenProvider("decline-becomes-success"),
      { scenario: "decline" }
    )
    expect(violation.check).toBe("decline-stays-failed")
    expect(violation.message).toMatch(/expected ERROR/)
  })

  it("names the failed check in a stable, machine-readable form", async () => {
    const violation = await captureViolation(
      makeBrokenProvider("double-capture")
    )
    expect(violation.name).toBe("ProviderContractViolation")
    expect(typeof violation.check).toBe("string")
    expect(violation.check.length).toBeGreaterThan(0)
  })
})
