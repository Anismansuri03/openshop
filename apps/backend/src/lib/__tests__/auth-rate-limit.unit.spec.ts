import {
  createAuthRateLimitMiddleware,
  createRateLimiter,
  normalizeIp,
  readRateLimitConfig,
  resolveClientIp,
  type RateLimitConfig,
  type RateLimitRequest,
  type RateLimitResponse,
} from "../auth-rate-limit"

const config: RateLimitConfig = {
  windowMs: 60_000,
  max: 3,
  trustedProxyHops: 0,
}

function makeRequest(overrides?: Partial<RateLimitRequest>): RateLimitRequest {
  return {
    method: "POST",
    path: "/auth/customer/emailpass",
    headers: {},
    socket: { remoteAddress: "203.0.113.7" },
    ...overrides,
  }
}

function makeResponse() {
  const headers: Record<string, string> = {}
  const state = { statusCode: 0, body: undefined as unknown }
  const res: RateLimitResponse = {
    setHeader(name, value) {
      headers[name] = value
      return res
    },
    status(code) {
      state.statusCode = code
      return res
    },
    json(body) {
      state.body = body
      return body
    },
  }
  return { res, headers, state }
}

describe("createRateLimiter", () => {
  it("allows requests below the limit and counts down the remainder", () => {
    const limiter = createRateLimiter()
    expect(limiter.check("k", config)).toMatchObject({
      allowed: true,
      limit: 3,
      remaining: 2,
    })
    expect(limiter.check("k", config)).toMatchObject({
      allowed: true,
      remaining: 1,
    })
    expect(limiter.check("k", config)).toMatchObject({
      allowed: true,
      remaining: 0,
    })
  })

  it("blocks the request above the limit with retry info", () => {
    const limiter = createRateLimiter()
    for (let i = 0; i < config.max; i++) {
      expect(limiter.check("k", config).allowed).toBe(true)
    }
    const blocked = limiter.check("k", config)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(
      Math.ceil(config.windowMs / 1000)
    )
  })

  it("resets the window once it expires", () => {
    let clock = 1_000_000
    const limiter = createRateLimiter(() => clock)
    for (let i = 0; i <= config.max; i++) {
      limiter.check("k", config)
    }
    expect(limiter.check("k", config).allowed).toBe(false)

    clock += config.windowMs + 1
    const afterExpiry = limiter.check("k", config)
    expect(afterExpiry.allowed).toBe(true)
    expect(afterExpiry.remaining).toBe(config.max - 1)
  })

  it("expires a bucket by the resetAt stamped at creation, not by a later window change", () => {
    // Regression (G10-F): the middleware re-reads the window from the
    // environment per request, so a live bucket must keep the resetAt it
    // was created with - retuning the window never re-stamps it. This is
    // why the integration suite proves expiry on a fresh key instead of
    // trying to expire a shared bucket early.
    let clock = 0
    const limiter = createRateLimiter(() => clock)
    const longWindow = { ...config, windowMs: 60_000 }
    for (let i = 0; i <= longWindow.max; i++) {
      limiter.check("k", longWindow)
    }
    expect(limiter.check("k", longWindow).allowed).toBe(false)

    const shortWindow = { ...config, windowMs: 1_000 }
    clock = 5_000
    expect(limiter.check("k", shortWindow).allowed).toBe(false)
    clock = 59_999
    expect(limiter.check("k", shortWindow).allowed).toBe(false)

    clock = 60_000
    const fresh = limiter.check("k", shortWindow)
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(longWindow.max - 1)
  })

  it("keeps independent buckets per client and per route", () => {
    const limiter = createRateLimiter()
    limiter.check("ip-a|POST /auth/login", config)
    limiter.check("ip-a|POST /auth/register", config)
    limiter.check("ip-b|POST /auth/login", config)
    // Each key has its own count of 1, so the next hit on ip-a/login is
    // still within the limit.
    expect(limiter.check("ip-a|POST /auth/login", config).allowed).toBe(true)
    expect(limiter.size()).toBe(3)
  })

  it("drops expired buckets during the periodic sweep", () => {
    let clock = 0
    const limiter = createRateLimiter(() => clock)
    limiter.check("old", config)
    clock += config.windowMs * 2
    limiter.check("new", config) // triggers the sweep for the old window
    expect(limiter.size()).toBe(1)
  })
})

describe("resolveClientIp", () => {
  it("ignores X-Forwarded-For when no trusted proxy is configured", () => {
    const ip = resolveClientIp({
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      socketAddress: "203.0.113.7",
      trustedProxyHops: 0,
    })
    expect(ip).toBe("203.0.113.7")
  })

  it("takes the proxy-appended entry when one hop is trusted", () => {
    // Client-supplied prefixes to the left are ignored; only the entry the
    // trusted proxy appended (right-most) may be believed.
    const ip = resolveClientIp({
      headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.9" },
      socketAddress: "10.0.0.1",
      trustedProxyHops: 1,
    })
    expect(ip).toBe("198.51.100.9")
  })

  it("counts hops from the right for chained proxies", () => {
    const ip = resolveClientIp({
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7, 192.0.2.50" },
      socketAddress: "10.0.0.1",
      trustedProxyHops: 2,
    })
    expect(ip).toBe("203.0.113.7")
  })

  it("falls back to the socket when the header is shorter than the hops", () => {
    const ip = resolveClientIp({
      headers: { "x-forwarded-for": "6.6.6.6" },
      socketAddress: "10.0.0.1",
      trustedProxyHops: 2,
    })
    expect(ip).toBe("10.0.0.1")
  })

  it("falls back to the socket when the header is absent", () => {
    const ip = resolveClientIp({
      headers: {},
      socketAddress: "10.0.0.1",
      trustedProxyHops: 1,
    })
    expect(ip).toBe("10.0.0.1")
  })

  it("normalizes IPv4-mapped IPv6 addresses", () => {
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1")
    expect(
      resolveClientIp({
        headers: {},
        socketAddress: "::ffff:127.0.0.1",
        trustedProxyHops: 0,
      })
    ).toBe("127.0.0.1")
  })
})

describe("readRateLimitConfig", () => {
  it("applies documented defaults when nothing is set", () => {
    expect(readRateLimitConfig({})).toEqual({
      windowMs: 60_000,
      max: 10,
      trustedProxyHops: 0,
    })
  })

  it("reads overrides from the environment", () => {
    expect(
      readRateLimitConfig({
        RATE_LIMIT_AUTH_MAX: "25",
        RATE_LIMIT_AUTH_WINDOW_MS: "30000",
        RATE_LIMIT_TRUSTED_PROXY_HOPS: "1",
      })
    ).toEqual({ windowMs: 30_000, max: 25, trustedProxyHops: 1 })
  })

  it("ignores invalid values instead of disabling the limiter", () => {
    expect(
      readRateLimitConfig({
        RATE_LIMIT_AUTH_MAX: "not-a-number",
        RATE_LIMIT_AUTH_WINDOW_MS: "-5",
        RATE_LIMIT_TRUSTED_PROXY_HOPS: "abc",
      })
    ).toEqual({ windowMs: 60_000, max: 10, trustedProxyHops: 0 })
  })
})

describe("createAuthRateLimitMiddleware", () => {
  it("passes allowed requests through with limit headers set", () => {
    const middleware = createAuthRateLimitMiddleware({
      max: 2,
      windowMs: 60_000,
      trustedProxyHops: 0,
    })
    const { res, headers, state } = makeResponse()
    let nextCalls = 0

    middleware(makeRequest(), res, () => {
      nextCalls += 1
    })

    expect(nextCalls).toBe(1)
    expect(state.statusCode).toBe(0)
    expect(headers["X-RateLimit-Limit"]).toBe("2")
    expect(headers["X-RateLimit-Remaining"]).toBe("1")
  })

  it("answers 429 with Retry-After and a JSON retry hint above the limit", () => {
    const middleware = createAuthRateLimitMiddleware({
      max: 1,
      windowMs: 60_000,
      trustedProxyHops: 0,
    })
    const first = makeResponse()
    middleware(makeRequest(), first.res, () => {})

    const { res, headers, state } = makeResponse()
    let nextCalls = 0
    middleware(makeRequest(), res, () => {
      nextCalls += 1
    })

    expect(nextCalls).toBe(0)
    expect(state.statusCode).toBe(429)
    expect(headers["Retry-After"]).toMatch(/^[1-9][0-9]*$/)
    expect(headers["X-RateLimit-Remaining"]).toBe("0")
    expect(state.body).toMatchObject({
      type: "rate_limit",
      retryAfter: Number(headers["Retry-After"]),
    })
    expect((state.body as { message: string }).message).toBeTruthy()
  })

  it("keys by the socket address, not by spoofed forwarded headers", () => {
    const middleware = createAuthRateLimitMiddleware({
      max: 1,
      windowMs: 60_000,
      trustedProxyHops: 0,
    })
    const first = makeResponse()
    middleware(
      makeRequest({ headers: { "x-forwarded-for": "1.1.1.1" } }),
      first.res,
      () => {}
    )

    // A different claimed forwarded address must land in the SAME bucket.
    const second = makeResponse()
    let nextCalls = 0
    middleware(
      makeRequest({ headers: { "x-forwarded-for": "2.2.2.2" } }),
      second.res,
      () => {
        nextCalls += 1
      }
    )
    expect(nextCalls).toBe(0)
    expect(second.headers["Retry-After"]).toBeTruthy()
  })

  it("never writes credentials, tokens, or request data to the console", () => {
    const password = "unit-test-password-should-not-be-logged"
    const bearerToken = "unit-test-jwt-should-not-be-logged"
    const logSpy = jest.spyOn(console, "log")
    const warnSpy = jest.spyOn(console, "warn")
    const errorSpy = jest.spyOn(console, "error")

    try {
      const middleware = createAuthRateLimitMiddleware({
        max: 1,
        windowMs: 60_000,
        trustedProxyHops: 0,
      })
      // One allowed, one blocked — both carrying credential-shaped data.
      middleware(
        makeRequest({
          headers: {
            authorization: `Bearer ${bearerToken}`,
            "x-forwarded-for": "6.6.6.6",
          },
          path: `/auth/customer/emailpass?password=${password}`,
        }),
        makeResponse().res,
        () => {}
      )
      middleware(
        makeRequest({
          headers: { authorization: `Bearer ${bearerToken}` },
          path: `/auth/customer/emailpass?password=${password}`,
        }),
        makeResponse().res,
        () => {}
      )
    } finally {
      const written = [
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...errorSpy.mock.calls,
      ]
        .map((args) => args.map(String).join(" "))
        .join("\n")
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()

      expect(written).not.toContain(password)
      expect(written).not.toContain(bearerToken)
      expect(written).not.toContain("Bearer")
      expect(written).toBe("")
    }
  })
})
