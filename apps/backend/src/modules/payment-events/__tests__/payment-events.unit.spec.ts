import { MedusaError } from "@medusajs/framework/utils"
import {
  isDuplicateKeyError,
  MAX_ERROR_MESSAGE_LENGTH,
  truncateError,
} from "../service"

/**
 * Journal error-text guarantees (G2): whatever a provider or workflow throws,
 * the payment-events journal stores a string that is
 *
 *  - BOUNDED (never longer than MAX_ERROR_MESSAGE_LENGTH plus a fixed
 *    suffix), so a hostile or noisy error cannot bloat the journal, and
 *  - SECRET-FREE (credential-shaped substrings redacted), so journal rows
 *    are safe to read in logs, evidence files, and reports.
 *
 * These are pure-function tests — no database involved.
 */

describe("truncateError", () => {
  it("keeps a plain message intact", () => {
    expect(truncateError("provider unreachable")).toBe("provider unreachable")
  })

  it("accepts Error instances by their message", () => {
    expect(truncateError(new Error("connection reset"))).toBe(
      "connection reset"
    )
  })

  it("serializes plain objects", () => {
    expect(truncateError({ code: "ECONNREFUSED" })).toContain("ECONNREFUSED")
  })

  it("survives circular objects without throwing", () => {
    const circular: Record<string, unknown> = { code: "boom" }
    circular.self = circular
    expect(truncateError(circular)).toBe("unserializable error")
  })

  it("redacts Stripe-style key material", () => {
    const message = "Stripe API failed for sk_live_SECRETVALUE123"
    const result = truncateError(message)
    expect(result).not.toContain("SECRETVALUE123")
    expect(result).toContain("[redacted]")
  })

  it("redacts webhook secrets and bearer tokens", () => {
    const secret = "whsec_ABCDEF123456"
    const bearer = "bearer-abc123token"
    const result = truncateError(`rejected ${secret} via ${bearer}`)
    expect(result).not.toContain("ABCDEF123456")
    expect(result).not.toContain("abc123token")
    expect(result).toContain("[redacted]")
  })

  it("does not over-redact ordinary words that merely start with a keyword", () => {
    // "keyboard-1" must NOT match the `key[-_]` pattern (the suffix after
    // "key" is "b", not a separator) — otherwise the journal would lose
    // meaningful context.
    expect(truncateError("keyboard-1 driver failed")).toBe(
      "keyboard-1 driver failed"
    )
  })

  it("truncates very long messages to a bounded size", () => {
    const long = "x".repeat(MAX_ERROR_MESSAGE_LENGTH * 3)
    const result = truncateError(long)
    expect(result.length).toBeLessThanOrEqual(
      MAX_ERROR_MESSAGE_LENGTH + "...[truncated]".length
    )
    expect(result.endsWith("...[truncated]")).toBe(true)
  })

  it("truncates long Error messages too", () => {
    const result = truncateError(
      new Error("y".repeat(MAX_ERROR_MESSAGE_LENGTH * 2))
    )
    expect(result.length).toBeLessThanOrEqual(
      MAX_ERROR_MESSAGE_LENGTH + "...[truncated]".length
    )
  })
})

/**
 * Duplicate-classification guarantees (G2): a redelivery of an event that
 * is already journaled MUST resolve to the contract's duplicate/in_flight
 * responses — never an unhandled 500. The hard part is that Medusa's DAL
 * `dbErrorMapper` rewrites the raw Postgres 23505 into a MedusaError that
 * carries neither `code` nor `constraint`; the classifier has to recognize
 * BOTH shapes (regression: the mapped shape was missed once and duplicate
 * deliveries answered 500 in the HTTP suite).
 */
describe("isDuplicateKeyError", () => {
  const mappedMessage =
    "Payment event with provider: pp_sim-payment_default, " +
    "event_id: sim_evt_payses_01ABC, already exists."

  it("recognizes the raw Postgres unique-violation code", () => {
    expect(isDuplicateKeyError({ code: "23505" })).toBe(true)
  })

  it("recognizes a wrapped error by its constraint name", () => {
    expect(
      isDuplicateKeyError({
        constraint: "payment_event_provider_event_id_unique",
      })
    ).toBe(true)
  })

  it("recognizes the MedusaError produced by dbErrorMapper", () => {
    // Exactly what the DAL throws: type INVALID_DATA, message built from
    // table + keys, no code, no constraint.
    const mapped = new MedusaError(
      MedusaError.Types.INVALID_DATA,
      mappedMessage
    )
    expect(mapped.code).toBeUndefined()
    expect(isDuplicateKeyError(mapped)).toBe(true)
  })

  it("rejects unrelated errors (no false positives)", () => {
    expect(isDuplicateKeyError(new Error("connection reset"))).toBe(false)
    expect(
      isDuplicateKeyError(
        new MedusaError(MedusaError.Types.NOT_FOUND, "Payment not found")
      )
    ).toBe(false)
    expect(
      isDuplicateKeyError(
        new MedusaError(MedusaError.Types.INVALID_DATA, "amount is invalid")
      )
    ).toBe(false)
    expect(isDuplicateKeyError(undefined)).toBe(false)
    expect(isDuplicateKeyError(null)).toBe(false)
  })

  it("does not treat an 'already exists' message on another table as a journal duplicate", () => {
    expect(
      isDuplicateKeyError(
        new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Product with handle: red-shirt, already exists."
        )
      )
    ).toBe(false)
  })
})
