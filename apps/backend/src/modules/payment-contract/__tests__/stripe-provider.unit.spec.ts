import StripeProviderService from "@medusajs/payment-stripe/dist/services/stripe-provider"
import type { StripeOptions } from "@medusajs/payment-stripe/dist/types"
import { mapProviderVerificationError } from "../../../lib/payment-webhooks"

/**
 * Official Medusa Stripe adapter — OFFLINE-safe subset (G2).
 *
 * Everything here runs without any Stripe credentials and without any
 * network access:
 *
 *  - provider identity (the adapter's official identifier);
 *  - option validation (validateOptions rejects a missing API key);
 *  - signature-failure behavior: a delivery that fails Stripe's
 *    `constructEvent` verification surfaces as a plain Error naming that
 *    step, which the webhook pipeline maps to HTTP 400 (never an ack).
 *
 * Deliberately NOT covered here (documented as BLOCKED in
 * docs/G2_SANDBOX_VALIDATION.md): anything requiring real Stripe test-mode
 * credentials — session creation, authorize/capture/refund against Stripe,
 * signed fixture delivery end-to-end. Those belong to G2-G and are NOT
 * counted as passing anywhere.
 *
 * Construction with a dummy `sk_test_` key performs no I/O: the adapter's
 * constructor only calls `new Stripe(apiKey)` (verified in
 * dist/core/stripe-base.js), so creating an instance in this test cannot
 * reach Stripe.
 */

const DUMMY_KEY = "sk_test_offline_dummy_key_not_a_real_credential"
const DUMMY_WEBHOOK_SECRET = "whsec_offline_dummy_secret_not_real"

function makeService(): StripeProviderService {
  return new StripeProviderService(
    {},
    { apiKey: DUMMY_KEY, webhookSecret: DUMMY_WEBHOOK_SECRET }
  )
}

describe("StripeProviderService (offline subset)", () => {
  it("exposes the official provider identifier", () => {
    expect(StripeProviderService.identifier).toBe("stripe")
    expect(makeService().getIdentifier()).toBe("stripe")
  })

  it("constructs with a dummy test key without any network access", () => {
    // The constructor only builds the local Stripe client; this assertion
    // passing offline (CI has no Stripe credentials and no expected egress)
    // is the proof.
    const service = makeService()
    expect(service.getIdentifier()).toBe("stripe")
  })

  it("validateOptions rejects a missing apiKey", () => {
    expect(() =>
      StripeProviderService.validateOptions({} as unknown as StripeOptions)
    ).toThrow(/apiKey/)
  })

  it("validateOptions warns (not throws) when only the webhook secret is missing", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      expect(() =>
        StripeProviderService.validateOptions({
          apiKey: DUMMY_KEY,
        } as unknown as StripeOptions)
      ).not.toThrow()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it("rejects an unsigned webhook delivery with an error naming constructWebhookEvent", async () => {
    const service = makeService()
    let caught: unknown
    try {
      await service.getWebhookActionAndData({
        data: {},
        rawData: Buffer.from("{}"),
        headers: {},
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).toMatch(/constructWebhookEvent/)
    // Plain Error from StripeBase.buildError, not a MedusaError: the
    // webhook pipeline classifies by message for this exact case.
    expect((caught as { type?: string }).type).toBeUndefined()
  })

  it("maps the Stripe signature failure to HTTP 400 (never acknowledged)", async () => {
    const service = makeService()
    let caught: unknown
    try {
      await service.getWebhookActionAndData({
        data: {},
        rawData: Buffer.from("{}"),
        headers: {},
      })
    } catch (error) {
      caught = error
    }
    const result = mapProviderVerificationError(caught)
    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/signature/)
  })
})
