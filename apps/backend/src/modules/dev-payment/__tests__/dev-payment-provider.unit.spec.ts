import { readFileSync } from "fs"
import { join } from "path"
import {
  AbstractPaymentProvider,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import devPaymentModule from "../index"
import {
  DevPaymentProvider,
  type DevPaymentState,
} from "../services/dev-payment-provider"

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_FLAG = process.env.ENABLE_DEV_PAYMENT_PROVIDER

function makeProvider(): DevPaymentProvider {
  return new DevPaymentProvider({}, {})
}

function stateOf(data: Record<string, unknown> | undefined): DevPaymentState {
  const state = (data as { dev_payment?: DevPaymentState } | undefined)
    ?.dev_payment
  if (!state) {
    throw new Error("expected dev_payment state in returned data")
  }
  return state
}

/** Run initiatePayment the way the payment module does: session id as key. */
async function initiate(
  provider: DevPaymentProvider,
  overrides: {
    amount?: unknown
    currency_code?: string
    data?: Record<string, unknown>
    idempotency_key?: string
  } = {}
) {
  return provider.initiatePayment({
    amount: (overrides.amount ?? 23.8) as never,
    currency_code: overrides.currency_code ?? "eur",
    data: overrides.data,
    context: { idempotency_key: overrides.idempotency_key ?? "pay_123" },
  })
}

afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.ENABLE_DEV_PAYMENT_PROVIDER
  } else {
    process.env.ENABLE_DEV_PAYMENT_PROVIDER = ORIGINAL_FLAG
  }
})

describe("registration contract", () => {
  it("exposes the identifier Medusa turns into pp_dev-payment_default", () => {
    expect(DevPaymentProvider.identifier).toBe("dev-payment")

    // Key formula from @medusajs/payment dist/loaders/providers.js:
    // `pp_${klass.identifier}${pluginOptions.id ? `_${pluginOptions.id}` : ""}`
    const pluginOptionsId = "default"
    const key = `pp_${DevPaymentProvider.identifier}_${pluginOptionsId}`
    expect(key).toBe("pp_dev-payment_default")
  })

  it("is recognized as a payment provider by the framework", () => {
    const provider = makeProvider()
    expect(AbstractPaymentProvider.isPaymentProvider(provider)).toBe(true)
    expect(provider.getIdentifier()).toBe("dev-payment")
  })

  it("is exported through the module entry point the loader requires", () => {
    expect(devPaymentModule.services).toEqual([DevPaymentProvider])
  })
})

describe("validateOptions (production safeguard)", () => {
  beforeEach(() => {
    // Silence the boot warning; restored per-test via NODE_ENV.
    jest.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.ENABLE_DEV_PAYMENT_PROVIDER
    } else {
      process.env.ENABLE_DEV_PAYMENT_PROVIDER = ORIGINAL_FLAG
    }
    jest.restoreAllMocks()
  })

  it("throws at boot in production without the explicit opt-in", () => {
    process.env.NODE_ENV = "production"
    delete process.env.ENABLE_DEV_PAYMENT_PROVIDER

    expect(() => DevPaymentProvider.validateOptions(undefined)).toThrow(
      /ENABLE_DEV_PAYMENT_PROVIDER/
    )
    expect(() => DevPaymentProvider.validateOptions(undefined)).toThrow(
      /never processes real money/
    )
  })

  it("allows production when ENABLE_DEV_PAYMENT_PROVIDER=true is set", () => {
    process.env.NODE_ENV = "production"
    process.env.ENABLE_DEV_PAYMENT_PROVIDER = "true"

    expect(() => DevPaymentProvider.validateOptions(undefined)).not.toThrow()
  })

  it("rejects any provider options (the provider takes none)", () => {
    expect(() =>
      DevPaymentProvider.validateOptions({ apiKey: "x" } as never)
    ).toThrow(/takes no options/)
    expect(() => DevPaymentProvider.validateOptions([] as never)).toThrow(
      /takes no options/
    )
  })

  it("warns on every non-production boot that payments are simulated", () => {
    process.env.NODE_ENV = "development"
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined)

    DevPaymentProvider.validateOptions(undefined)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/simulated/i)
    expect(warn.mock.calls[0][0]).toMatch(/pp_dev-payment_default/)
  })
})

describe("initiatePayment", () => {
  it("creates a pending, clearly-stamped simulated state", async () => {
    const provider = makeProvider()
    const output = await initiate(provider)

    expect(output.id).toBe("pay_123")
    expect(output.status).toBe(PaymentSessionStatus.PENDING)

    const state = stateOf(output.data)
    expect(state.simulated).toBe(true)
    expect(state.provider).toBe("development")
    expect(state.state).toBe("initiated")
    expect(state.amount).toBe(23.8)
    expect(state.currency_code).toBe("eur")
    expect(state.captured_amount).toBe(0)
    expect(state.refunded_amount).toBe(0)
    expect(state.refunds).toEqual([])
    expect(state.capture_keys).toEqual([])
  })

  it("rounds main-unit decimal amounts to six decimals", async () => {
    const provider = makeProvider()
    const output = await initiate(provider, { amount: 23.8000000001 })
    expect(stateOf(output.data).amount).toBe(23.8)
  })

  it("accepts BigNumber-shaped amounts as the module passes them", async () => {
    const provider = makeProvider()
    const output = await initiate(provider, {
      amount: { raw: { value: "10.500000000000000000", precision: 20 } },
    })
    expect(stateOf(output.data).amount).toBe(10.5)
  })

  it("is idempotent for duplicate initiation of the same session", async () => {
    const provider = makeProvider()
    const first = await initiate(provider)
    const second = await initiate(provider)

    expect(second.id).toBe(first.id)
    expect(second.status).toBe(PaymentSessionStatus.PENDING)
    expect(stateOf(second.data).state).toBe("initiated")
  })

  it("records the decline simulation directive", async () => {
    const provider = makeProvider()
    const output = await initiate(provider, {
      data: { simulate: "decline" },
    })
    expect(stateOf(output.data).simulation).toBe("decline")
  })

  it("rejects unsupported simulation directives", async () => {
    const provider = makeProvider()
    await expect(
      initiate(provider, { data: { simulate: "explode" } })
    ).rejects.toThrow(/unsupported simulate value/)
  })

  it("rejects invalid amounts", async () => {
    const provider = makeProvider()
    await expect(initiate(provider, { amount: "not-a-number" })).rejects.toThrow(
      /invalid amount/
    )
  })
})

describe("authorizePayment", () => {
  it("authorizes an initiated payment", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)

    const output = await provider.authorizePayment({
      data,
      context: { idempotency_key: "pay_123" },
    })

    expect(output.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(stateOf(output.data).state).toBe("authorized")
  })

  it("is idempotent on repeated authorization", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)

    const first = await provider.authorizePayment({
      data,
      context: { idempotency_key: "pay_123" },
    })
    const second = await provider.authorizePayment({
      data: first.data,
      context: { idempotency_key: "pay_123" },
    })

    expect(second.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(stateOf(second.data).state).toBe("authorized")
  })

  it("honors the decline directive and stays declined on retry", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider, {
      data: { simulate: "decline" },
    })

    const first = await provider.authorizePayment({
      data,
      context: { idempotency_key: "pay_123" },
    })
    expect(first.status).toBe(PaymentSessionStatus.ERROR)
    const declined = stateOf(first.data)
    expect(declined.state).toBe("error")
    expect(declined.failure_reason).toBe("simulated_decline")
    expect(declined.simulated).toBe(true)

    // Idempotent failure: a retry must not flip a decline into a success.
    const retry = await provider.authorizePayment({
      data: first.data,
      context: { idempotency_key: "pay_123" },
    })
    expect(retry.status).toBe(PaymentSessionStatus.ERROR)
    expect(stateOf(retry.data).state).toBe("error")
  })

  it("marks the payment captured itself for auto-capture (module skips capturePayment)", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider, {
      data: { simulate: "auto-capture" },
    })

    const output = await provider.authorizePayment({
      data,
      context: { idempotency_key: "pay_123" },
    })

    expect(output.status).toBe(PaymentSessionStatus.CAPTURED)
    const state = stateOf(output.data)
    expect(state.state).toBe("captured")
    expect(state.captured_amount).toBe(state.amount)
    expect(state.capture_keys).toContain("auto-capture")
  })

  it("refuses to authorize a canceled payment", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)
    const canceled = await provider.cancelPayment({
      data,
      context: { idempotency_key: "pay_123" },
    })

    await expect(
      provider.authorizePayment({
        data: canceled.data,
        context: { idempotency_key: "pay_123" },
      })
    ).rejects.toThrow(/cannot authorize a canceled payment/)
  })

  it("throws when the state blob is missing (payment not created by this provider)", async () => {
    const provider = makeProvider()
    await expect(
      provider.authorizePayment({ data: { session_id: "x" } })
    ).rejects.toThrow(/missing the development payment state/)
  })
})

describe("capturePayment", () => {
  async function authorized() {
    const provider = makeProvider()
    const { data } = await initiate(provider)
    const output = await provider.authorizePayment({
      data,
      context: { idempotency_key: "pay_123" },
    })
    return { provider, data: output.data }
  }

  it("captures an authorized payment for the full amount", async () => {
    const { provider, data } = await authorized()

    const output = await provider.capturePayment({
      data,
      context: { idempotency_key: "cap_1" },
    })

    const state = stateOf(output.data)
    expect(state.state).toBe("captured")
    expect(state.captured_amount).toBe(23.8)
    expect(state.capture_keys).toContain("cap_1")
  })

  it("is idempotent for the same capture idempotency key", async () => {
    const { provider, data } = await authorized()

    await provider.capturePayment({ data, context: { idempotency_key: "cap_1" } })
    const again = await provider.capturePayment({
      data,
      context: { idempotency_key: "cap_1" },
    })

    expect(stateOf(again.data).capture_keys).toEqual(["cap_1"])
    expect(stateOf(again.data).captured_amount).toBe(23.8)
  })

  it("assigns (never adds) the captured amount across repeated captures", async () => {
    const { provider, data } = await authorized()

    const first = await provider.capturePayment({
      data,
      context: { idempotency_key: "cap_1" },
    })
    const second = await provider.capturePayment({
      data: first.data,
      context: { idempotency_key: "cap_2" },
    })

    // Assignment semantics: a second capture must not double-count.
    expect(stateOf(second.data).captured_amount).toBe(23.8)
  })

  it("rejects capture before authorization", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)

    await expect(
      provider.capturePayment({ data, context: { idempotency_key: "cap_1" } })
    ).rejects.toThrow(/before authorization/)
  })

  it("rejects capture of a canceled payment", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)
    const canceled = await provider.cancelPayment({
      data,
      context: { idempotency_key: "pay_123" },
    })

    await expect(
      provider.capturePayment({
        data: canceled.data,
        context: { idempotency_key: "cap_1" },
      })
    ).rejects.toThrow(/cannot capture a canceled payment/)
  })
})

describe("refundPayment", () => {
  async function capturedPayment() {
    const provider = makeProvider()
    const { data } = await initiate(provider)
    const authorized = await provider.authorizePayment({
      data,
      context: { idempotency_key: "pay_123" },
    })
    const captured = await provider.capturePayment({
      data: authorized.data,
      context: { idempotency_key: "cap_1" },
    })
    return { provider, data: captured.data }
  }

  it("records a partial refund against the captured amount", async () => {
    const { provider, data } = await capturedPayment()

    const output = await provider.refundPayment({
      amount: 5,
      data,
      context: { idempotency_key: "ref_1" },
    })

    const state = stateOf(output.data)
    expect(state.refunded_amount).toBe(5)
    expect(state.refunds).toEqual([{ id: "ref_1", amount: 5 }])
    expect(state.state).toBe("captured")
  })

  it("is idempotent for the same refund idempotency key", async () => {
    const { provider, data } = await capturedPayment()

    await provider.refundPayment({
      amount: 5,
      data,
      context: { idempotency_key: "ref_1" },
    })
    const again = await provider.refundPayment({
      amount: 5,
      data,
      context: { idempotency_key: "ref_1" },
    })

    expect(stateOf(again.data).refunds).toHaveLength(1)
    expect(stateOf(again.data).refunded_amount).toBe(5)
  })

  it("moves to refunded when the full captured amount is returned", async () => {
    const { provider, data } = await capturedPayment()

    const output = await provider.refundPayment({
      amount: 23.8,
      data,
      context: { idempotency_key: "ref_full" },
    })

    expect(stateOf(output.data).state).toBe("refunded")
  })

  it("rejects refunds beyond the captured amount", async () => {
    const { provider, data } = await capturedPayment()

    await provider.refundPayment({
      amount: 20,
      data,
      context: { idempotency_key: "ref_1" },
    })

    await expect(
      provider.refundPayment({
        amount: 5,
        data,
        context: { idempotency_key: "ref_2" },
      })
    ).rejects.toThrow(/more than the captured amount/)
  })

  it("rejects refunding a payment that was never captured", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)

    await expect(
      provider.refundPayment({
        amount: 5,
        data,
        context: { idempotency_key: "ref_1" },
      })
    ).rejects.toThrow(/not captured/)
  })

  it("rejects non-positive refund amounts", async () => {
    const { provider, data } = await capturedPayment()

    await expect(
      provider.refundPayment({
        amount: 0,
        data,
        context: { idempotency_key: "ref_0" },
      })
    ).rejects.toThrow(/greater than 0/)
  })
})

describe("cancelPayment", () => {
  it("cancels an authorized payment", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)
    const authorized = await provider.authorizePayment({
      data,
      context: { idempotency_key: "pay_123" },
    })

    const output = await provider.cancelPayment({
      data: authorized.data,
      context: { idempotency_key: "pay_123" },
    })

    expect(stateOf(output.data).state).toBe("canceled")
  })

  it("is idempotent on repeated cancel", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)
    const first = await provider.cancelPayment({
      data,
      context: { idempotency_key: "pay_123" },
    })
    const second = await provider.cancelPayment({
      data: first.data,
      context: { idempotency_key: "pay_123" },
    })

    expect(stateOf(second.data).state).toBe("canceled")
  })

  it("refuses to cancel a captured payment (refund instead)", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)
    const authorized = await provider.authorizePayment({
      data,
      context: { idempotency_key: "pay_123" },
    })
    const captured = await provider.capturePayment({
      data: authorized.data,
      context: { idempotency_key: "cap_1" },
    })

    await expect(
      provider.cancelPayment({
        data: captured.data,
        context: { idempotency_key: "pay_123" },
      })
    ).rejects.toThrow(/refund it instead/)
  })
})

describe("status, webhook, and passthrough methods", () => {
  it("maps every state to a Medusa payment session status", async () => {
    const provider = makeProvider()

    const initiated = await initiate(provider)
    expect(
      (await provider.getPaymentStatus({ data: initiated.data })).status
    ).toBe(PaymentSessionStatus.PENDING)

    const authorized = await provider.authorizePayment({
      data: initiated.data,
      context: { idempotency_key: "pay_123" },
    })
    expect(
      (await provider.getPaymentStatus({ data: authorized.data })).status
    ).toBe(PaymentSessionStatus.AUTHORIZED)

    const captured = await provider.capturePayment({
      data: authorized.data,
      context: { idempotency_key: "cap_1" },
    })
    expect(
      (await provider.getPaymentStatus({ data: captured.data })).status
    ).toBe(PaymentSessionStatus.CAPTURED)

    // A fresh payment for the cancel path (captured payments cannot cancel).
    const fresh = await initiate(provider, { idempotency_key: "pay_2" })
    const canceled = await provider.cancelPayment({
      data: fresh.data,
      context: { idempotency_key: "pay_2" },
    })
    expect(
      (await provider.getPaymentStatus({ data: canceled.data })).status
    ).toBe(PaymentSessionStatus.CANCELED)
  })

  it("declines webhook handling (this provider has no webhooks)", async () => {
    const provider = makeProvider()
    // No payload argument: the provider exposes no webhook surface at all,
    // so there is nothing for a payload to be routed to.
    const result = await provider.getWebhookActionAndData()
    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(result.action).toBe("not_supported")
  })

  it("passes data through retrieve and delete (no external resource)", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)

    expect(await provider.retrievePayment({ data })).toEqual({ data })
    expect(await provider.deletePayment({ data })).toEqual({ data })
  })

  it("updates the amount only while the payment is still initiated", async () => {
    const provider = makeProvider()
    const { data } = await initiate(provider)

    const updated = await provider.updatePayment({
      amount: 31.5,
      currency_code: "eur",
      data,
    })
    expect(stateOf(updated.data).amount).toBe(31.5)

    const authorized = await provider.authorizePayment({
      data: updated.data,
      context: { idempotency_key: "pay_123" },
    })
    const afterAuth = await provider.updatePayment({
      amount: 99,
      currency_code: "eur",
      data: authorized.data,
    })
    expect(stateOf(afterAuth.data).amount).toBe(31.5)
  })

  it("creates, retrieves, and deletes account holders without a gateway", async () => {
    const provider = makeProvider()

    const created = await provider.createAccountHolder({
      context: { customer: { id: "cus_1" } as never },
    })
    expect(created.id).toBe("cus_1")

    expect(await provider.retrieveAccountHolder({ id: "cus_1" })).toEqual({
      id: "cus_1",
    })
    expect(
      await provider.deleteAccountHolder({
        context: { account_holder: { id: "cus_1" } },
      })
    ).toEqual({ data: {} })
  })
})

describe("source-level safeguards", () => {
  const sourcePath = join(
    __dirname,
    "..",
    "services",
    "dev-payment-provider.ts"
  )
  const source = readFileSync(sourcePath, "utf8")

  it("contains no network or payment-gateway code", () => {
    const forbidden = [
      "fetch(",
      "XMLHttpRequest",
      "axios",
      "node-fetch",
      "https.request",
      "http.request",
      "WebSocket",
      "stripe",
      "paypal",
      "braintree",
      "createServer",
    ]
    for (const token of forbidden) {
      expect(source.toLowerCase()).not.toContain(token.toLowerCase())
    }
  })

  it("stamps every state record as simulated and development-only", () => {
    expect(source).toContain("simulated: true")
    expect(source).toContain('provider: "development"')
    expect(source).toContain("ENABLE_DEV_PAYMENT_PROVIDER")
  })
})
