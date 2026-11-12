import { classifyReconcile } from "../payment-reconcile"

/**
 * Classification tests (G2): reconciliation is a report, never an action —
 * every input maps to an explicit classification and the in-sync case is
 * the only one that says "in_sync".
 */

describe("classifyReconcile", () => {
  it("reports in_sync when session and provider agree on a pending payment", () => {
    const { classification, details } = classifyReconcile({
      localStatus: "pending",
      providerStatus: "pending",
      paymentCapturedAt: null,
      amountsDiffer: false,
    })
    expect(classification).toBe("in_sync")
    expect(details.join(" ")).toMatch(/pending/)
  })

  it("reports in_sync for a captured payment with a recorded capture", () => {
    const { classification } = classifyReconcile({
      localStatus: "captured",
      providerStatus: "captured",
      paymentCapturedAt: new Date(),
      amountsDiffer: false,
    })
    expect(classification).toBe("in_sync")
  })

  it("detects provider-side drift as capture_mismatch (dashboard capture)", () => {
    const { classification, details } = classifyReconcile({
      localStatus: "authorized",
      providerStatus: "captured",
      paymentCapturedAt: null,
      amountsDiffer: false,
    })
    expect(classification).toBe("capture_mismatch")
    expect(details.join(" ")).toMatch(/no captured_at/)
  })

  it("detects inconsistent local data when status says captured without a capture timestamp", () => {
    const { classification } = classifyReconcile({
      localStatus: "captured",
      providerStatus: "captured",
      paymentCapturedAt: null,
      amountsDiffer: false,
    })
    expect(classification).toBe("capture_mismatch")
  })

  it("detects a plain status divergence as status_mismatch", () => {
    const { classification, details } = classifyReconcile({
      localStatus: "pending",
      providerStatus: "error",
      paymentCapturedAt: null,
      amountsDiffer: false,
    })
    expect(classification).toBe("status_mismatch")
    expect(details.join(" ")).toMatch(/"pending"/)
    expect(details.join(" ")).toMatch(/"error"/)
  })

  it("flags a local/provider amount divergence as amount_mismatch before anything else", () => {
    const { classification } = classifyReconcile({
      localStatus: "captured",
      providerStatus: "captured",
      paymentCapturedAt: new Date(),
      amountsDiffer: true,
    })
    expect(classification).toBe("amount_mismatch")
  })

  it("reports provider_error when the provider status cannot be read", () => {
    const { classification, details } = classifyReconcile({
      localStatus: "authorized",
      providerStatus: null,
      providerError: "provider unreachable",
      paymentCapturedAt: null,
      amountsDiffer: false,
    })
    expect(classification).toBe("provider_error")
    expect(details.join(" ")).toMatch(/provider unreachable/)
  })

  it("treats a missing session as provider_error, never as in_sync", () => {
    const { classification } = classifyReconcile({
      localStatus: null,
      providerStatus: null,
      providerError: "Payment has no payment session to reconcile against.",
      paymentCapturedAt: null,
      amountsDiffer: false,
    })
    expect(classification).toBe("provider_error")
  })
})
