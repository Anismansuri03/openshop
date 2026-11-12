import { MedusaError } from "@medusajs/framework/utils"
import {
  mapProviderVerificationError,
  resolveWebhookProviderId,
} from "../payment-webhooks"

/**
 * Unit tests for the webhook pipeline's pure decision points (G2): the
 * provider allowlist and the error -> HTTP status mapping that guarantees
 * "never acknowledge what was not processed".
 */

describe("resolveWebhookProviderId", () => {
  it("maps the known public path segments to payment provider ids", () => {
    expect(resolveWebhookProviderId("sim-payment")).toBe(
      "pp_sim-payment_default"
    )
    expect(resolveWebhookProviderId("stripe")).toBe("pp_stripe_stripe")
  })

  it("refuses anything outside the allowlist", () => {
    expect(resolveWebhookProviderId("dev-payment")).toBeNull()
    expect(resolveWebhookProviderId("pp_sim-payment_default")).toBeNull()
    expect(resolveWebhookProviderId("")).toBeNull()
    expect(resolveWebhookProviderId("../../etc/passwd")).toBeNull()
  })
})

describe("mapProviderVerificationError", () => {
  it("maps signature rejection (UNAUTHORIZED) to 400", () => {
    const result = mapProviderVerificationError(
      new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "Payment simulator: webhook signature rejected (signature_mismatch)."
      )
    )
    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/signature/)
  })

  it("maps malformed events (INVALID_DATA) to 400", () => {
    const result = mapProviderVerificationError(
      new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment simulator: webhook event is missing an id."
      )
    )
    expect(result.status).toBe(400)
  })

  it("maps amount/currency mismatches (UNEXPECTED_STATE) to 400", () => {
    const result = mapProviderVerificationError(
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Payment simulator: webhook event amount does not match the payment amount."
      )
    )
    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/amount/)
  })

  it("maps NOT_FOUND to 404", () => {
    const result = mapProviderVerificationError(
      new MedusaError(MedusaError.Types.NOT_FOUND, "Provider not found")
    )
    expect(result.status).toBe(404)
  })

  it("maps an unregistered provider (plain Error from the payment module) to 404", () => {
    const result = mapProviderVerificationError(
      new Error(
        "Unable to retrieve the payment provider with id: pp_stripe_stripe"
      )
    )
    expect(result.status).toBe(404)
  })

  it("maps the official Stripe adapter's signature failure to 400", () => {
    // StripeBase.buildError wraps constructWebhookEvent failures in a plain
    // Error whose message names the failing step.
    const stripeStyleError = new Error(
      "An error occurred in constructWebhookEvent: No signatures found matching the expected signature for payload"
    )
    const result = mapProviderVerificationError(stripeStyleError)
    expect(result.status).toBe(400)
  })

  it("falls back to 500 for anything else and leaks no internals", () => {
    const result = mapProviderVerificationError(
      new Error("internal stack detail with host name db.internal:5432")
    )
    expect(result.status).toBe(500)
    expect(String(result.body.error)).not.toContain("db.internal")
    expect(String(result.body.error)).not.toContain("stack")
  })

  it("treats non-Error values as 500 without echoing them", () => {
    const result = mapProviderVerificationError({ weird: "object" })
    expect(result.status).toBe(500)
    expect(result.body.error).toBeDefined()
  })
})
