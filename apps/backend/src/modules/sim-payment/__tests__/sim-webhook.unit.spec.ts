import type { ProviderWebhookPayload } from "@medusajs/framework/types"
import { MedusaError, PaymentActions } from "@medusajs/framework/utils"
import { SimPaymentProvider } from "../services/sim-payment-provider"
import type {
  SimSessionService,
  SimStateName,
  SimWebhookSession,
} from "../services/sim-payment-provider"
import { buildSimEvent } from "../webhook-fixtures"
import { SIM_SIGNATURE_HEADER, signSimPayload } from "../webhook-signature"

/**
 * Unit tests for the simulator's webhook handling (G2): signature first,
 * strict session/amount association, advance-only state stamping, and the
 * provider-neutral action results the webhook route consumes.
 *
 * Everything runs offline with an injected fake paymentSessionService —
 * the exact seam the real payment module fills at runtime.
 */

const SECRET = "unit-test-sim-webhook-secret-0123456789"

const SESSION_ID = "payses_contract_1"
const REFERENCE = "sim_intent_contract_1"

type FakeSessionService = SimSessionService & {
  retrieve: jest.Mock
  update: jest.Mock
}

function makeState(
  overrides: Partial<{
    state: SimStateName
    provider_view: SimStateName
    scenario: string
    captured_minor: number
    failure_reason: string
  }> = {}
): Record<string, unknown> {
  const state = overrides.state ?? "pending"
  return {
    simulated: true,
    provider: "simulated",
    id: REFERENCE,
    state,
    scenario: overrides.scenario ?? "pending",
    amount_minor: 1050,
    currency_code: "usd",
    captured_minor: overrides.captured_minor ?? 0,
    refunded_minor: 0,
    refunds: [],
    capture_keys: [],
    authorize_attempts: 1,
    failure_reason: overrides.failure_reason,
    provider_view: overrides.provider_view ?? state,
    created_at: "2026-11-11T00:00:00.000Z",
    updated_at: "2026-11-11T00:00:00.000Z",
  }
}

function makeSession(
  overrides: Partial<SimWebhookSession> = {}
): SimWebhookSession {
  return {
    id: SESSION_ID,
    data: { sim_payment: makeState() },
    provider_id: "pp_sim-payment_default",
    amount: 10.5,
    currency_code: "usd",
    ...overrides,
  }
}

function makeSessionService(session: SimWebhookSession | null): FakeSessionService {
  const retrieve = jest.fn(async (id: string) => {
    if (!session || session.id !== id) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment session ${id} not found`
      )
    }
    return session
  })
  const update = jest.fn(
    async (input: { id: string; data: Record<string, unknown> }) => {
      if (session) {
        session.data = input.data
      }
      return session
    }
  )
  return { retrieve, update }
}

function makeProvider(sessionService?: FakeSessionService): SimPaymentProvider {
  const cradle: Record<string, unknown> = {}
  if (sessionService) {
    cradle.paymentSessionService = sessionService
  }
  return new SimPaymentProvider(cradle, { webhookSecret: SECRET })
}

function deliver(
  provider: SimPaymentProvider,
  event: unknown,
  options: { secret?: string } = {}
): Promise<Awaited<ReturnType<SimPaymentProvider["getWebhookActionAndData"]>>> {
  const rawBody = JSON.stringify(event)
  const header = signSimPayload(rawBody, options.secret ?? SECRET)
  const payload: ProviderWebhookPayload["payload"] = {
    data: JSON.parse(rawBody) as Record<string, unknown>,
    rawData: rawBody,
    headers: { [SIM_SIGNATURE_HEADER]: header },
  }
  return provider.getWebhookActionAndData(payload)
}

const succeededEvent = () =>
  buildSimEvent({
    type: "sim.payment_intent.succeeded",
    sessionId: SESSION_ID,
    reference: REFERENCE,
    amountMinor: 1050,
    currencyCode: "usd",
  })

describe("SimPaymentProvider.getWebhookActionAndData", () => {
  it("rejects an invalid signature before touching anything", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)

    await expect(
      deliver(provider, succeededEvent(), { secret: "wrong-secret" })
    ).rejects.toMatchObject({ type: MedusaError.Types.UNAUTHORIZED })
    expect(sessions.retrieve).not.toHaveBeenCalled()
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("rejects a missing signature header", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)
    const event = succeededEvent()
    const rawBody = JSON.stringify(event)

    await expect(
      provider.getWebhookActionAndData({
        data: event as unknown as Record<string, unknown>,
        rawData: rawBody,
        headers: {},
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.UNAUTHORIZED })
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("stamps the session and returns SUCCESSFUL for a signed succeeded event", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)

    const result = await deliver(provider, succeededEvent())

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
    expect(result.data?.session_id).toBe(SESSION_ID)
    expect(result.data?.amount).toBe(10.5)
    expect(sessions.update).toHaveBeenCalledTimes(1)
    expect(sessions.update).toHaveBeenCalledWith({
      id: SESSION_ID,
      data: expect.objectContaining({
        simulated: true,
        sim_payment: expect.objectContaining({
          state: "authorized",
          provider_view: "authorized",
        }),
      }),
    })
  })

  it("rejects an unknown session with NOT_SUPPORTED and no write", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)

    const result = await deliver(
      provider,
      buildSimEvent({
        type: "sim.payment_intent.succeeded",
        sessionId: "payses_does_not_exist",
        reference: REFERENCE,
      })
    )

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("ignores events addressed to a foreign provider's session", async () => {
    const sessions = makeSessionService(
      makeSession({ provider_id: "pp_stripe_stripe" })
    )
    const provider = makeProvider(sessions)

    const result = await deliver(provider, succeededEvent())

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("ignores sessions without the simulator's provider record", async () => {
    const sessions = makeSessionService(makeSession({ data: {} }))
    const provider = makeProvider(sessions)

    const result = await deliver(provider, succeededEvent())

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("ignores events whose reference does not match the session's payment", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)

    const result = await deliver(
      provider,
      buildSimEvent({
        type: "sim.payment_intent.succeeded",
        sessionId: SESSION_ID,
        reference: "sim_intent_someone_elses",
      })
    )

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("rejects an amount mismatch with UNEXPECTED_STATE before any write", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)

    await expect(
      deliver(
        provider,
        buildSimEvent({
          type: "sim.payment_intent.succeeded",
          sessionId: SESSION_ID,
          reference: REFERENCE,
          amountMinor: 999,
        })
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("rejects a currency mismatch with UNEXPECTED_STATE before any write", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)

    await expect(
      deliver(
        provider,
        buildSimEvent({
          type: "sim.payment_intent.succeeded",
          sessionId: SESSION_ID,
          reference: REFERENCE,
          currencyCode: "eur",
        })
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("refuses to regress a captured payment on a late succeeded event", async () => {
    const sessions = makeSessionService(
      makeSession({
        data: {
          sim_payment: makeState({
            state: "captured",
            provider_view: "captured",
            captured_minor: 1050,
          }),
        },
      })
    )
    const provider = makeProvider(sessions)

    const result = await deliver(provider, succeededEvent())

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("treats an intermediate processing event after authorization as stale", async () => {
    const sessions = makeSessionService(
      makeSession({
        data: {
          sim_payment: makeState({
            state: "authorized",
            provider_view: "authorized",
          }),
        },
      })
    )
    const provider = makeProvider(sessions)

    const result = await deliver(
      provider,
      buildSimEvent({
        type: "sim.payment_intent.processing",
        sessionId: SESSION_ID,
        reference: REFERENCE,
      })
    )

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("treats a capture event for a canceled payment as stale", async () => {
    const sessions = makeSessionService(
      makeSession({
        data: {
          sim_payment: makeState({ state: "canceled", provider_view: "canceled" }),
        },
      })
    )
    const provider = makeProvider(sessions)

    const result = await deliver(
      provider,
      buildSimEvent({
        type: "sim.payment_intent.amount_captured",
        sessionId: SESSION_ID,
        reference: REFERENCE,
      })
    )

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("acknowledges unknown event types without touching state", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)

    const result = await deliver(provider, {
      id: "sim_evt_unknown_type",
      type: "sim.something.entirely_new",
      data: { session_id: SESSION_ID, reference: REFERENCE },
      simulated: true,
    })

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("stamps ERROR on a signed payment_failed event", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)

    const result = await deliver(
      provider,
      buildSimEvent({
        type: "sim.payment_intent.payment_failed",
        sessionId: SESSION_ID,
        reference: REFERENCE,
        failureReason: "simulated_card_declined",
      })
    )

    expect(result.action).toBe(PaymentActions.FAILED)
    expect(sessions.update).toHaveBeenCalledTimes(1)
    expect(sessions.update).toHaveBeenCalledWith({
      id: SESSION_ID,
      data: expect.objectContaining({
        sim_payment: expect.objectContaining({
          state: "error",
          provider_view: "error",
          failure_reason: "simulated_card_declined",
        }),
      }),
    })
  })

  it("acknowledges a repeated payment_failed without rewriting state", async () => {
    const sessions = makeSessionService(
      makeSession({
        data: {
          sim_payment: makeState({ state: "error", provider_view: "error" }),
        },
      })
    )
    const provider = makeProvider(sessions)

    const result = await deliver(
      provider,
      buildSimEvent({
        type: "sim.payment_intent.payment_failed",
        sessionId: SESSION_ID,
        reference: REFERENCE,
      })
    )

    expect(result.action).toBe(PaymentActions.FAILED)
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("advances authorized -> captured on amount_captured", async () => {
    const sessions = makeSessionService(
      makeSession({
        data: {
          sim_payment: makeState({
            state: "authorized",
            provider_view: "authorized",
          }),
        },
      })
    )
    const provider = makeProvider(sessions)

    const result = await deliver(
      provider,
      buildSimEvent({
        type: "sim.payment_intent.amount_captured",
        sessionId: SESSION_ID,
        reference: REFERENCE,
      })
    )

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
    expect(sessions.update).toHaveBeenCalledWith({
      id: SESSION_ID,
      data: expect.objectContaining({
        sim_payment: expect.objectContaining({
          state: "captured",
          provider_view: "captured",
          captured_minor: 1050,
        }),
      }),
    })
  })

  it("cancels an authorized payment on a signed canceled event", async () => {
    const sessions = makeSessionService(
      makeSession({
        data: {
          sim_payment: makeState({
            state: "authorized",
            provider_view: "authorized",
          }),
        },
      })
    )
    const provider = makeProvider(sessions)

    const result = await deliver(
      provider,
      buildSimEvent({
        type: "sim.payment_intent.canceled",
        sessionId: SESSION_ID,
        reference: REFERENCE,
      })
    )

    expect(result.action).toBe(PaymentActions.CANCELED)
    expect(sessions.update).toHaveBeenCalledWith({
      id: SESSION_ID,
      data: expect.objectContaining({
        sim_payment: expect.objectContaining({
          state: "canceled",
          provider_view: "canceled",
        }),
      }),
    })
  })

  it("stamps PENDING for an intermediate processing event", async () => {
    const sessions = makeSessionService(
      makeSession({
        data: {
          sim_payment: makeState({
            state: "initiated",
            provider_view: "initiated",
            scenario: "pending",
          }),
        },
      })
    )
    const provider = makeProvider(sessions)

    const result = await deliver(
      provider,
      buildSimEvent({
        type: "sim.payment_intent.processing",
        sessionId: SESSION_ID,
        reference: REFERENCE,
      })
    )

    expect(result.action).toBe(PaymentActions.PENDING)
    expect(sessions.update).toHaveBeenCalledWith({
      id: SESSION_ID,
      data: expect.objectContaining({
        sim_payment: expect.objectContaining({
          state: "pending",
          provider_view: "pending",
        }),
      }),
    })
  })

  it("rejects a structurally malformed event", async () => {
    const sessions = makeSessionService(makeSession())
    const provider = makeProvider(sessions)

    await expect(
      deliver(provider, {
        id: "sim_evt_malformed",
        type: "sim.payment_intent.succeeded",
        data: { reference: REFERENCE },
        simulated: true,
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
    expect(sessions.update).not.toHaveBeenCalled()
  })

  it("surfaces a missing session service as a plain configuration error", async () => {
    const provider = makeProvider(undefined)
    let caught: unknown
    try {
      await deliver(provider, succeededEvent())
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(MedusaError)
    expect((caught as Error).message).toMatch(/paymentSessionService/)
  })
})
