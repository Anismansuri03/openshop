import { afterEach, describe, expect, it, vi } from "vitest"
import { buildRobots } from "./robots"

/**
 * G11 robots coverage (task requirements 6): valid robots object, absolute
 * sitemap reference on the configured origin, private surfaces disallowed,
 * public storefront pages NOT blanket-blocked — and no localhost in
 * production-generated output.
 */

const BASE = "https://shop.example.com"

describe("buildRobots", () => {
  it("references the sitemap as an absolute URL on the same origin", () => {
    const robots = buildRobots(BASE)
    expect(robots.sitemap).toBe(`${BASE}/sitemap.xml`)
  })

  it("allows crawling of public pages by default", () => {
    const robots = buildRobots(BASE)
    const rules = robots.rules as { userAgent: string; allow: string; disallow: string[] }
    expect(rules.userAgent).toBe("*")
    expect(rules.allow).toBe("/")
    // A blanket disallow of "/" would hide the whole storefront.
    expect(rules.disallow).not.toContain("/")
    expect(rules.disallow).not.toContain("/*")
  })

  it("keeps cart, checkout, account, order, verification and API routes out of indexing", () => {
    const robots = buildRobots(BASE)
    const rules = robots.rules as { disallow: string[] }
    for (const path of [
      "/cart",
      "/checkout",
      "/account",
      "/order",
      "/verify-account",
      "/api",
      // Country-prefixed forms (the middleware redirects bare paths here).
      "/*/cart",
      "/*/checkout",
      "/*/account",
      "/*/order",
      "/*/verify-account",
    ]) {
      expect(rules.disallow).toContain(path)
    }
  })

  it("normalizes a trailing slash on the base URL", () => {
    expect(buildRobots(`${BASE}/`).sitemap).toBe(`${BASE}/sitemap.xml`)
  })
})

describe("src/app/robots.ts route", () => {
  afterEach(() => {
    // Env mutations all go through vi.stubEnv; unstubAllEnvs restores them
    // (direct NODE_ENV assignment is disallowed by tsc's read-only typing).
    vi.unstubAllEnvs()
  })

  it("emits an absolute sitemap URL from the configured production origin", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.example.com")

    const route = await import("../../app/robots")
    const robots = route.default()
    expect(robots.sitemap).toBe("https://shop.example.com/sitemap.xml")
    expect(JSON.stringify(robots)).not.toContain("localhost")
  })

  it("does not leak any environment secret into the robots output", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.example.com")

    const route = await import("../../app/robots")
    const serialized = JSON.stringify(route.default())
    expect(serialized).not.toMatch(/pk_|JWT|SECRET|password/i)
  })
})
