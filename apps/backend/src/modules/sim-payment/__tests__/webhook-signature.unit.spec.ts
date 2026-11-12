import {
  SIM_SIGNATURE_TOLERANCE_SECONDS,
  signSimPayload,
  verifySimSignature,
} from "../webhook-signature"

/**
 * Webhook signature scheme tests (G2): roundtrip, tamper detection,
 * timestamp tolerance, malformed and missing headers. The scheme mirrors
 * Stripe's (`t=...,v1=...` over `<ts>.<raw body>`) so the same failure
 * surface is exercised credential-free.
 */

const SECRET = "unit-test-signature-secret-0123456789"
const BODY = JSON.stringify({ id: "evt_1", type: "sim.payment_intent.succeeded" })

describe("signSimPayload / verifySimSignature", () => {
  it("round-trips a correctly signed payload", () => {
    const header = signSimPayload(BODY, SECRET)
    expect(
      verifySimSignature({ rawBody: BODY, header, secret: SECRET })
    ).toEqual({ valid: true, timestampSeconds: expect.any(Number) })
  })

  it("accepts a Buffer raw body identically to the string form", () => {
    const header = signSimPayload(BODY, SECRET)
    expect(
      verifySimSignature({
        rawBody: Buffer.from(BODY, "utf8"),
        header,
        secret: SECRET,
      }).valid
    ).toBe(true)
  })

  it("rejects a payload tampered after signing", () => {
    const header = signSimPayload(BODY, SECRET)
    const tampered = BODY.replace("evt_1", "evt_2")
    expect(
      verifySimSignature({ rawBody: tampered, header, secret: SECRET })
    ).toEqual({ valid: false, reason: "signature_mismatch" })
  })

  it("rejects a signature produced with a different secret", () => {
    const header = signSimPayload(BODY, "another-secret")
    expect(
      verifySimSignature({ rawBody: BODY, header, secret: SECRET })
    ).toEqual({ valid: false, reason: "signature_mismatch" })
  })

  it("rejects a timestamp outside the tolerance window (replay protection)", () => {
    const signedAt = 1_800_000_000
    const header = signSimPayload(BODY, SECRET, signedAt)
    expect(
      verifySimSignature({
        rawBody: BODY,
        header,
        secret: SECRET,
        nowSeconds: signedAt + (SIM_SIGNATURE_TOLERANCE_SECONDS + 5),
      })
    ).toEqual({ valid: false, reason: "stale_timestamp" })

    // The same event just inside the window stays valid.
    expect(
      verifySimSignature({
        rawBody: BODY,
        header,
        secret: SECRET,
        nowSeconds: signedAt + (SIM_SIGNATURE_TOLERANCE_SECONDS - 5),
      }).valid
    ).toBe(true)
  })

  it("rejects a missing header", () => {
    expect(
      verifySimSignature({ rawBody: BODY, header: undefined, secret: SECRET })
    ).toEqual({ valid: false, reason: "missing_header" })
  })

  it("rejects a malformed header", () => {
    expect(
      verifySimSignature({ rawBody: BODY, header: "garbage", secret: SECRET })
    ).toEqual({ valid: false, reason: "malformed_header" })
    expect(
      verifySimSignature({
        rawBody: BODY,
        header: "t=not-a-number,v1=abc",
        secret: SECRET,
      })
    ).toEqual({ valid: false, reason: "malformed_header" })
  })

  it("accepts unknown header parts (Stripe-compatible) and requires a matching v1", () => {
    const ts = Math.floor(Date.now() / 1000)
    const good = signSimPayload(BODY, SECRET, ts)
    const v1 = good.split(",")[1]
    expect(
      verifySimSignature({
        rawBody: BODY,
        header: `t=${ts},v0=deadbeef,${v1},other=part`,
        secret: SECRET,
      }).valid
    ).toBe(true)
    expect(
      verifySimSignature({
        rawBody: BODY,
        header: `t=${ts},v0=deadbeef`,
        secret: SECRET,
      })
    ).toEqual({ valid: false, reason: "malformed_header" })
  })
})
