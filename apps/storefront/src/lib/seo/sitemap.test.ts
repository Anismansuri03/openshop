import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildSitemap,
  fetchSitemapData,
  SitemapData,
} from "./sitemap"

/**
 * G11 sitemap coverage: URL validity and absoluteness, public product /
 * collection / category routes, exclusion of non-indexable routes, duplicate
 * prevention, draft (non-published) exclusion, empty-catalogue and API-failure
 * behaviour — plus route-level tests of `src/app/sitemap.ts` itself with a
 * mocked backend (no real network, no new test framework).
 */

const BASE = "https://shop.example.com"

const emptyData = (): SitemapData => ({
  countries: [],
  products: [],
  collections: [],
  categories: [],
})

describe("buildSitemap", () => {
  it("emits absolute URLs for homepages, store, products, collections and categories", () => {
    const data: SitemapData = {
      countries: ["dk"],
      products: [{ handle: "t-shirt", status: "published" }],
      collections: [{ handle: "summer" }],
      categories: [{ handle: "shirts", path: ["shirts"] }],
    }
    const urls = buildSitemap(BASE, data).map((entry) => entry.url)
    expect(urls).toEqual([
      `${BASE}/dk`,
      `${BASE}/dk/store`,
      `${BASE}/dk/products/t-shirt`,
      `${BASE}/dk/collections/summer`,
      `${BASE}/dk/categories/shirts`,
    ])
    for (const url of urls) {
      expect(url.startsWith(BASE + "/")).toBe(true)
      // Path portion only — the protocol's "//" is legitimate.
      expect(url.slice(BASE.length)).not.toMatch(/\/{2,}/)
    }
  })

  it("only ever emits whitelisted public route patterns", () => {
    const data: SitemapData = {
      countries: ["dk", "de"],
      products: [{ handle: "t-shirt" }],
      collections: [{ handle: "summer" }],
      categories: [
        { handle: "shirts", path: ["shirts"] },
        { handle: "kids", path: ["shirts", "kids"] },
      ],
    }
    const allowed = new RegExp(
      `^${BASE}(/[a-z]{2})?(/store|/products/[^/]+|/collections/[^/]+|/categories(/[A-Za-z0-9-]+)+)?$`
    )
    for (const entry of buildSitemap(BASE, data)) {
      expect(entry.url).toMatch(allowed)
    }
    const joined = JSON.stringify(buildSitemap(BASE, data))
    for (const privatePath of [
      "cart",
      "checkout",
      "account",
      "order",
      "verify-account",
      "admin",
      "/api",
      "auth",
    ]) {
      expect(joined).not.toContain(privatePath)
    }
  })

  it("never contains duplicate URLs", () => {
    const data: SitemapData = {
      countries: ["dk", "dk", "DK", "de"],
      products: [
        { handle: "t-shirt" },
        { handle: "t-shirt" },
        { handle: "t-shirt" },
      ],
      collections: [{ handle: "summer" }, { handle: "summer" }],
      categories: [{ handle: "shirts", path: ["shirts"] }],
    }
    const urls = buildSitemap(BASE, data).map((entry) => entry.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it("excludes products that are not published", () => {
    const data: SitemapData = {
      countries: ["dk"],
      products: [
        { handle: "visible", status: "published" },
        { handle: "draft-item", status: "draft" },
        { handle: "proposed-item", status: "proposed" },
        { handle: "rejected-item", status: "rejected" },
        { handle: "status-unknown" },
      ],
      collections: [],
      categories: [],
    }
    const urls = buildSitemap(BASE, data).map((entry) => entry.url)
    expect(urls).toContain(`${BASE}/dk/products/visible`)
    expect(urls).toContain(`${BASE}/dk/products/status-unknown`)
    expect(urls.some((u) => u.includes("draft-item"))).toBe(false)
    expect(urls.some((u) => u.includes("proposed-item"))).toBe(false)
    expect(urls.some((u) => u.includes("rejected-item"))).toBe(false)
  })

  it("emits a valid minimal sitemap for an empty catalogue", () => {
    const data: SitemapData = { ...emptyData(), countries: ["dk"] }
    const urls = buildSitemap(BASE, data).map((entry) => entry.url)
    expect(urls).toEqual([`${BASE}/dk`, `${BASE}/dk/store`])
  })

  it("emits nothing (not a crash) when even the countries are unknown", () => {
    expect(buildSitemap(BASE, emptyData())).toEqual([])
  })

  it("skips internal and inactive categories", () => {
    const data: SitemapData = {
      countries: ["dk"],
      products: [],
      collections: [],
      categories: [
        { handle: "shirts", path: ["shirts"] },
        { handle: "hidden", path: ["hidden"], is_internal: true },
        { handle: "retired", path: ["retired"], is_active: false },
      ],
    }
    const urls = buildSitemap(BASE, data).map((entry) => entry.url)
    expect(urls).toContain(`${BASE}/dk/categories/shirts`)
    expect(urls.some((u) => u.includes("hidden"))).toBe(false)
    expect(urls.some((u) => u.includes("retired"))).toBe(false)
  })

  it("encodes handles instead of leaking raw path characters", () => {
    const data: SitemapData = {
      countries: ["dk"],
      products: [{ handle: "weird handle/x" }],
      collections: [],
      categories: [],
    }
    const urls = buildSitemap(BASE, data).map((entry) => entry.url)
    expect(urls).toContain(`${BASE}/dk/products/weird%20handle%2Fx`)
  })

  it("normalizes a trailing slash on the base URL", () => {
    const data: SitemapData = { ...emptyData(), countries: ["dk"] }
    const urls = buildSitemap(`${BASE}/`, data).map((entry) => entry.url)
    expect(urls[0]).toBe(`${BASE}/dk`)
  })
})

describe("fetchSitemapData", () => {
  const backendUrl = "http://backend.test:9100"

  type FetchCall = { url: string; init?: RequestInit }

  const makeFetch = (
    routes: Record<string, unknown> | ((url: string) => unknown)
  ) => {
    const calls: FetchCall[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      const body =
        typeof routes === "function" ? routes(url) : routes[new URL(url).pathname]
      if (body === undefined) {
        return new Response("not found", { status: 404 })
      }
      if (body instanceof Error) {
        throw body
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch
    return { impl, calls }
  }

  const okRoutes = {
    "/store/regions": {
      regions: [{ countries: [{ iso_2: "dk" }, { iso_2: "DE" }, { iso_2: "dk" }] }],
    },
    "/store/products": {
      products: [
        { id: "p1", handle: "t-shirt", status: "published" },
        { id: "p2", handle: "draft-item", status: "draft" },
      ],
      count: 2,
    },
    "/store/collections": {
      collections: [{ id: "col1", handle: "summer" }],
      count: 1,
    },
    "/store/product-categories": {
      product_categories: [
        { id: "c1", handle: "shirts", parent_category: null, is_active: true },
        { id: "c2", handle: "kids", parent_category: { id: "c1" }, is_active: true },
        { id: "c3", handle: "secret", parent_category: null, is_internal: true },
      ],
      count: 3,
    },
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("maps the public store endpoints into sitemap data", async () => {
    const { impl, calls } = makeFetch(okRoutes)
    const data = await fetchSitemapData({
      backendUrl,
      publishableKey: "pk_test_key",
      defaultCountry: "dk",
      fetchImpl: impl,
    })

    expect([...data.countries].sort()).toEqual(["de", "dk"])
    expect(data.products.map((p) => p.handle)).toEqual(["t-shirt", "draft-item"])
    expect(data.products[1].status).toBe("draft")
    expect(data.collections.map((c) => c.handle)).toEqual(["summer"])
    // Nested category derives its full path; internal ones are dropped.
    expect(data.categories.map((c) => c.path)).toEqual([["shirts"], ["shirts", "kids"]])

    // Only public store endpoints are ever contacted, always with the
    // publishable key and never with admin/auth paths.
    for (const call of calls) {
      expect(call.url.startsWith(`${backendUrl}/store/`)).toBe(true)
      const headers = new Headers(call.init?.headers)
      expect(headers.get("x-publishable-api-key")).toBe("pk_test_key")
    }
  })

  it("falls back to the default country when every request fails", async () => {
    const { impl, calls } = makeFetch(() => new Error("backend down"))
    const data = await fetchSitemapData({
      backendUrl,
      publishableKey: undefined,
      defaultCountry: "fr",
      fetchImpl: impl,
    })
    expect(calls.length).toBeGreaterThan(0)
    expect(data.countries).toEqual(["fr"])
    expect(data.products).toEqual([])
    expect(data.collections).toEqual([])
    expect(data.categories).toEqual([])
    expect(console.warn).toHaveBeenCalled()
  })

  it("keeps available sections when a single section fails", async () => {
    const { impl } = makeFetch((url) => {
      const path = new URL(url).pathname
      if (path === "/store/collections") {
        return new Error("boom")
      }
      return okRoutes[path as keyof typeof okRoutes]
    })
    const data = await fetchSitemapData({
      backendUrl,
      publishableKey: "pk_test_key",
      defaultCountry: "dk",
      fetchImpl: impl,
    })
    expect(data.countries.sort()).toEqual(["de", "dk"])
    expect(data.products.length).toBe(2)
    expect(data.collections).toEqual([])
  })

  it("handles an empty catalogue", async () => {
    const { impl } = makeFetch({
      "/store/regions": { regions: [{ countries: [{ iso_2: "dk" }] }] },
      "/store/products": { products: [], count: 0 },
      "/store/collections": { collections: [], count: 0 },
      "/store/product-categories": { product_categories: [], count: 0 },
    })
    const data = await fetchSitemapData({
      backendUrl,
      publishableKey: "pk_test_key",
      defaultCountry: "dk",
      fetchImpl: impl,
    })
    expect(data.products).toEqual([])
    expect(data.collections).toEqual([])
    expect(data.categories).toEqual([])
    expect(data.countries).toEqual(["dk"])
  })

  it("emits only the static fallback when the backend URL is not configured", async () => {
    const { impl, calls } = makeFetch(okRoutes)
    const data = await fetchSitemapData({
      backendUrl: "",
      publishableKey: "pk_test_key",
      defaultCountry: "dk",
      fetchImpl: impl,
    })
    expect(calls).toEqual([])
    expect(data).toEqual({
      countries: ["dk"],
      products: [],
      collections: [],
      categories: [],
    })
    expect(console.warn).toHaveBeenCalled()
  })

  it("paginates past the first page of products", async () => {
    const pageOne = {
      products: Array.from({ length: 100 }, (_, i) => ({
        id: `p${i}`,
        handle: `product-${i}`,
        status: "published",
      })),
      count: 103,
    }
    const pageTwo = {
      products: [
        { id: "p100", handle: "product-100", status: "published" },
        { id: "p101", handle: "product-101", status: "published" },
        { id: "p102", handle: "product-102", status: "published" },
      ],
      count: 103,
    }
    const { impl, calls } = makeFetch((url) => {
      const parsed = new URL(url)
      if (parsed.pathname !== "/store/products") {
        return okRoutes[parsed.pathname as keyof typeof okRoutes]
      }
      return parsed.searchParams.get("offset") === "0" ? pageOne : pageTwo
    })
    const data = await fetchSitemapData({
      backendUrl,
      publishableKey: "pk_test_key",
      defaultCountry: "dk",
      fetchImpl: impl,
    })
    expect(data.products.length).toBe(103)
    expect(calls.some((c) => c.url.includes("offset=100"))).toBe(true)
  })
})

describe("src/app/sitemap.ts route", () => {
  afterEach(() => {
    // Env mutations all go through vi.stubEnv; unstubAllEnvs restores them
    // (direct NODE_ENV assignment is disallowed by tsc's read-only typing).
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("declares hourly regeneration", async () => {
    const route = await import("../../app/sitemap")
    expect(route.revalidate).toBe(3600)
  })

  it("builds absolute URLs under the configured origin, without a backend", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.example.com")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", "http://localhost:9100")
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_REGION", "dk")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "pk_route_test")
    vi.stubGlobal(
      "fetch",
      (async () => new Response("down", { status: 503 })) as typeof fetch
    )
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const route = await import("../../app/sitemap")
    const entries = await route.default()

    expect(entries.length).toBeGreaterThanOrEqual(2)
    for (const entry of entries) {
      expect(entry.url.startsWith("https://shop.example.com/")).toBe(true)
      expect(entry.url).not.toContain("localhost")
    }
    // Static fallback must still offer the homepage and catalogue index.
    expect(entries.map((e) => e.url)).toContain("https://shop.example.com/dk")
    expect(entries.map((e) => e.url)).toContain("https://shop.example.com/dk/store")
  })

  it("includes product URLs when the catalogue API responds", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.example.com")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", "http://backend.test:9100")
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_REGION", "dk")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "pk_route_test")

    const routes: Record<string, unknown> = {
      "/store/regions": { regions: [{ countries: [{ iso_2: "dk" }] }] },
      "/store/products": {
        products: [
          { id: "p1", handle: "t-shirt", status: "published" },
          { id: "p2", handle: "draft-item", status: "draft" },
        ],
        count: 2,
      },
      "/store/collections": { collections: [], count: 0 },
      "/store/product-categories": { product_categories: [], count: 0 },
    }
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname
        const body = routes[path]
        if (body === undefined) {
          return new Response("not found", { status: 404 })
        }
        return new Response(JSON.stringify(body), { status: 200 })
      }) as typeof fetch
    )

    const route = await import("../../app/sitemap")
    const urls = (await route.default()).map((entry) => entry.url)

    expect(urls).toContain("https://shop.example.com/dk/products/t-shirt")
    expect(urls.some((u) => u.includes("draft-item"))).toBe(false)
    expect(urls.every((u) => u.startsWith("https://shop.example.com/"))).toBe(true)
  })

  it("stays usable in local development with no base URL configured", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", undefined)
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", "http://localhost:9000")
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_REGION", "dk")
    vi.stubGlobal(
      "fetch",
      (async () => new Response("down", { status: 503 })) as typeof fetch
    )
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const route = await import("../../app/sitemap")
    const urls = (await route.default()).map((entry) => entry.url)
    expect(urls[0]).toBe("http://localhost:8000/dk")
  })
})
