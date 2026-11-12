import { createHmac, timingSafeEqual } from "crypto"

/**
 * Deterministic webhook signature scheme for the OpenShop local payment
 * simulator (G2).
 *
 * Deliberately shaped like Stripe's scheme (timestamp + HMAC-SHA256 over
 * `<timestamp>.<raw body>`, `t=...,v1=...` header) so the machinery the
 * simulator exercises — raw-body preservation, timestamp tolerance, replay
 * rejection, constant-time comparison — is the same machinery a real
 * provider integration needs.
 *
 * This is NOT a security boundary protecting real money: the simulator can
 * never move money. It exists so the webhook security tests are honest.
 */

export const SIM_SIGNATURE_HEADER = "x-sim-signature"

/** Reject events whose timestamp is more than this many seconds off. */
export const SIM_SIGNATURE_TOLERANCE_SECONDS = 300

/** Compute the `t=<ts>,v1=<hex>` signature value for a raw body. */
export function signSimPayload(
  rawBody: string | Buffer,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000)
): string {
  const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")
  const mac = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${raw}`)
    .digest("hex")
  return `t=${timestampSeconds},v1=${mac}`
}

export type SimSignatureFailure =
  | "missing_header"
  | "malformed_header"
  | "stale_timestamp"
  | "signature_mismatch"

export type SimSignatureResult =
  | { valid: true; timestampSeconds: number }
  | { valid: false; reason: SimSignatureFailure }

/**
 * Verify a `t=...,v1=...` signature header against the raw body.
 *
 * `nowSeconds` is injectable so tests can exercise the tolerance window
 * without sleeping. Unknown header parts are ignored (Stripe-compatible),
 * but at least one valid `v1` must match within tolerance.
 */
export function verifySimSignature(options: {
  rawBody: string | Buffer
  header: string | undefined
  secret: string
  nowSeconds?: number
}): SimSignatureResult {
  const { rawBody, header, secret } = options
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)

  if (!header || typeof header !== "string" || !header.trim()) {
    return { valid: false, reason: "missing_header" }
  }

  const parts = new Map<string, string[]>()
  for (const chunk of header.split(",")) {
    const eq = chunk.indexOf("=")
    if (eq <= 0) {
      continue
    }
    const key = chunk.slice(0, eq).trim()
    const value = chunk.slice(eq + 1).trim()
    const list = parts.get(key) ?? []
    list.push(value)
    parts.set(key, list)
  }

  const timestamps = parts.get("t")
  const signatures = parts.get("v1")
  if (!timestamps?.length || !signatures?.length) {
    return { valid: false, reason: "malformed_header" }
  }

  const timestampSeconds = Number(timestamps[0])
  if (!Number.isInteger(timestampSeconds)) {
    return { valid: false, reason: "malformed_header" }
  }
  if (
    Math.abs(nowSeconds - timestampSeconds) >
    SIM_SIGNATURE_TOLERANCE_SECONDS
  ) {
    return { valid: false, reason: "stale_timestamp" }
  }

  const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")
  const expected = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${raw}`)
    .digest()
  const expectedHex = expected.toString("hex")

  for (const candidate of signatures) {
    // Constant-time comparison over equal-length buffers only; a length
    // mismatch can never match anyway.
    const candidateBuffer = Buffer.from(candidate, "utf8")
    const expectedBuffer = Buffer.from(expectedHex, "utf8")
    if (
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer)
    ) {
      return { valid: true, timestampSeconds }
    }
  }
  return { valid: false, reason: "signature_mismatch" }
}
