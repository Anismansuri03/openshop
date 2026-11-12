import { afterEach, describe, expect, it, vi } from "vitest"
import { getBaseURL } from "./env"

/**
 * Validation matrix for the storefront origin used by metadataBase, Open
 * Graph URLs, sitemap and robots (master mission G11, requirements 4 + 6/7/8
 * of the task). Covers missing, malformed, loopback-in-production and valid
 * configuration — and proves error messages never echo the raw value (a
 * mispasted origin can contain credentials).
 */

afterEach(() => {
  // Every env mutation in this file goes through vi.stubEnv, so
  // unstubAllEnvs restores the runner's original values (including the
  // read-only-typed NODE_ENV, which cannot be assigned directly under tsc).
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("getBaseURL — valid configuration", () => {
  it("returns a normalized origin for a public https origin", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.example.com")
    expect(getBaseURL()).toBe("https://shop.example.com")
  })

  it("strips trailing slashes, whitespace and letter case", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "  https://Shop.Example.COM/  ")
    expect(getBaseURL()).toBe("https://shop.example.com")
  })

  it("keeps an explicit port", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.example.com:8443")
    expect(getBaseURL()).toBe("https://shop.example.com:8443")
  })

  it("allows http for local development setups", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:8000")
    expect(getBaseURL()).toBe("http://localhost:8000")
  })
})

describe("getBaseURL — missing configuration", () => {
  it("fails clearly in production instead of falling back to localhost", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", undefined)
    expect(() => getBaseURL()).toThrow(/NEXT_PUBLIC_BASE_URL is not set/)
    expect(() => getBaseURL()).toThrow(/public storefront origin/)
  })

  it("uses the documented localhost fallback in development", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", undefined)
    expect(getBaseURL()).toBe("http://localhost:8000")
  })

  it("uses the localhost fallback under the test environment", () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", undefined)
    expect(getBaseURL()).toBe("http://localhost:8000")
  })
})

describe("getBaseURL — malformed configuration", () => {
  it("rejects an unparseable value without echoing it", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "not a url at all")
    expect(() => getBaseURL()).toThrow(/not a parseable URL/)
    try {
      getBaseURL()
      expect.unreachable("getBaseURL should have thrown")
    } catch (error) {
      expect((error as Error).message).not.toContain("not a url at all")
    }
  })

  it("rejects origins containing credentials without echoing them", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://user:secretpass@example.com")
    expect(() => getBaseURL()).toThrow(/must not contain credentials/)
    try {
      getBaseURL()
      expect.unreachable("getBaseURL should have thrown")
    } catch (error) {
      expect((error as Error).message).not.toContain("secretpass")
      expect((error as Error).message).not.toContain("user")
    }
  })

  it("rejects non-http protocols", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "ftp://shop.example.com")
    expect(() => getBaseURL()).toThrow(/only http:\/\//)
  })

  it("rejects an origin with a path", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.example.com/store")
    expect(() => getBaseURL()).toThrow(/must not contain a path/)
  })

  it("rejects a query string or fragment", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.example.com?x=1")
    expect(() => getBaseURL()).toThrow(/query string or fragment/)
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.example.com#frag")
    expect(() => getBaseURL()).toThrow(/query string or fragment/)
  })
})

describe("getBaseURL — loopback rejection in production", () => {
  it.each([
    ["http://localhost:8000"],
    ["https://localhost"],
    ["http://shop.localhost"],
    ["http://127.0.0.1:8000"],
    ["http://[::1]:8000"],
  ])("rejects %s when NODE_ENV is production", (value) => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", value)
    expect(() => getBaseURL()).toThrow(/loopback|localhost/)
  })

  it("does not echo the loopback value's full URL in the message", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:8000")
    try {
      getBaseURL()
      expect.unreachable("getBaseURL should have thrown")
    } catch (error) {
      // The failure is named after the variable, not the raw value.
      expect((error as Error).message).toContain("NEXT_PUBLIC_BASE_URL")
      expect((error as Error).message).not.toContain("http://localhost:8000")
    }
  })

  it("still allows loopback in development (usable local workflow)", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:8000")
    expect(getBaseURL()).toBe("http://localhost:8000")
  })
})
