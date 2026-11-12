import { describe, expect, it, vi, afterEach } from "vitest"

import medusaError from "./medusa-error"
import { isSensitiveKey, redactSensitive, redactString, REDACTED } from "./redact"

describe("isSensitiveKey", () => {
  it.each([
    "set-cookie",
    "cookie",
    "authorization",
    "proxy-authorization",
    "x-api-key",
    "apikey",
    "refresh_token",
    "access-token",
    "client_secret",
    "password",
    "session-id",
  ])("flags %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true)
  })

  it.each(["content-type", "status", "x-request-id", "url", "message", "amount"])(
    "allows %s",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false)
    }
  )
})

describe("redactSensitive", () => {
  it("redacts sensitive header values and keeps useful ones", () => {
    const out = redactSensitive({
      "content-type": "application/json",
      "set-cookie": "medusa_session=abc123; Path=/",
      authorization: "Bearer super.secret.value",
      "x-api-key": "pk_live_nope",
    })
    expect(out).toEqual({
      "content-type": "application/json",
      "set-cookie": REDACTED,
      authorization: REDACTED,
      "x-api-key": REDACTED,
    })
    expect(JSON.stringify(out)).not.toContain("abc123")
  })

  it("walks nested payloads and arrays", () => {
    const out = redactSensitive({
      user: { name: "ana", password: "hunter2" },
      sessions: [{ token: "tok_1" }, { token: "tok_2" }],
    })
    expect(out.user.name).toBe("ana")
    expect(out.user.password).toBe(REDACTED)
    expect(out.sessions[0].token).toBe(REDACTED)
    expect(out.sessions[1].token).toBe(REDACTED)
  })

  it("scrubs bearer credentials from free-form strings", () => {
    expect(redactString("failed with Authorization: Bearer abc.def-123")).toBe(
      "failed with Authorization: Bearer " + REDACTED
    )
    expect(redactString("no credentials here")).toBe("no credentials here")
  })

  it("passes primitives through unchanged", () => {
    expect(redactSensitive(42)).toBe(42)
    expect(redactSensitive(null)).toBe(null)
    expect(redactSensitive(undefined)).toBe(undefined)
  })
})

describe("medusaError log redaction (regression: headers were dumped raw)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("never logs raw cookie or authorization values", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const rawCookie = "medusa_session=TOPSECRETSESSIONVALUE"

    const err = {
      config: { url: "/store/regions", baseURL: "http://localhost:9000" },
      response: {
        status: 401,
        data: { message: "unauthorized" },
        headers: {
          "content-type": "application/json",
          "set-cookie": rawCookie,
          authorization: "Bearer TOPSECRETTOKENVALUE",
        },
      },
    }

    expect(() => medusaError(err)).toThrow()

    const logged = consoleSpy.mock.calls
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n")
    expect(logged).toContain(REDACTED)
    expect(logged).not.toContain("TOPSECRETSESSIONVALUE")
    expect(logged).not.toContain("TOPSECRETTOKENVALUE")
    expect(logged).toContain("401") // status stays visible for debugging
  })
})
