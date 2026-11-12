import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

/**
 * Auth rate limiting integration suite (Sprint 3, Task 5).
 *
 * Exercises the `/auth/*` middleware from src/api/middlewares.ts against the
 * real booted application:
 *
 *   1. Below the limit - a login attempt is rejected by authentication
 *      (401), never by the limiter, and the response advertises the budget.
 *   2. Spoofed `X-Forwarded-For` values do not bypass the limit: with no
 *      trusted proxy configured the socket address is the only key, so all
 *      claimed addresses share one bucket (proven by test 3).
 *   3. Above the limit - HTTP 429 with `Retry-After` (seconds), matching
 *      JSON `retryAfter`, and `X-RateLimit-Remaining: 0`.
 *   4. Window expiry - a bucket that answered 429 accepts authentication
 *      again once the window passes (no permanent lockout), proven inside
 *      one test so suite load cannot affect it.
 *   5. No credentials in logs - successful register/login responses carry a
 *      real token; nothing written to the console during any of the above
 *      contains the password, the token, or a Bearer header.
 *
 * Test-order note: tests 1-3 deliberately share one budget (the runner
 * only restores the database between tests, so the limiter's in-memory
 * counters persist) on the operator login route `/auth/user/emailpass`.
 * The shared window is 5 minutes because in the observed G10-F failure the
 * runner's database restore between tests 1 and 2 took 19s under
 * full-suite parallel load - longer than the old 15s window, which
 * expired before test 3 ran and turned its expected 429 into a 401
 * (roadmap section 15). Test 4 proves expiry on the customer route (never
 * used by tests 1-3) under a short window, entirely within one test; test
 * 5's register/login then run on customer buckets that always have
 * headroom.
 *
 * Isolation: connections come from DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD
 * (never DATABASE_URL); the runner provisions and drops the database named
 * below. The limits are configured through the documented environment
 * variables in beforeAll and restored in afterAll (the middleware reads
 * them per request, so no boot-time ordering constraint applies).
 */

const AUTH_MAX = "5"
// Shared-budget window for tests 1-3. Must outlast runner-induced gaps
// between tests (observed: 19s under full-suite load) by a wide margin;
// 5 minutes is ~15x the worst observed gap and any gap large enough to
// exceed it would trip jest's own per-test timeouts first.
const AUTH_WINDOW_MS = "300000"
// Test 4's self-contained expiry phase. The middleware reads the window
// from the environment per request, so this only affects buckets created
// while it is set (restored in that test's finally and in afterAll).
const EXPIRY_WINDOW_MS = "10000"
const SHARED_BUDGET_PATH = "/auth/user/emailpass"
const CUSTOMER_EMAILPASS_PATH = "/auth/customer/emailpass"
const PROBE_EMAIL = "ratelimit.probe@example.com"
const PROBE_PASSWORD = "rate-limit-log-probe-password-123"

const RATE_LIMIT_ENV_KEYS = [
  "RATE_LIMIT_AUTH_MAX",
  "RATE_LIMIT_AUTH_WINDOW_MS",
  "RATE_LIMIT_TRUSTED_PROXY_HOPS",
] as const

type AttemptResult = {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headers: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
}

medusaIntegrationTestRunner({
  dbName: "openshop_sprint3_rate_limit",
  testSuite: ({ api }) => {
    let capturedLogs: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let originalConsole: Record<string, any> = {}
    let savedEnv: Record<string, string | undefined> = {}

    beforeAll(() => {
      for (const key of RATE_LIMIT_ENV_KEYS) {
        savedEnv[key] = process.env[key]
      }
      process.env.RATE_LIMIT_AUTH_MAX = AUTH_MAX
      process.env.RATE_LIMIT_AUTH_WINDOW_MS = AUTH_WINDOW_MS
      process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "0"

      // Capture everything the application writes to the console for the
      // whole suite; test 5 asserts no credential ever appears there.
      capturedLogs = []
      for (const method of ["log", "warn", "error"] as const) {
        originalConsole[method] = console[method]
        const original = originalConsole[method].bind(console)
        console[method] = (...args: unknown[]) => {
          capturedLogs.push(args.map(String).join(" "))
          original(...args)
        }
      }
    }, 300000)

    afterAll(() => {
      for (const [method, original] of Object.entries(originalConsole)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(console as any)[method] = original
      }
      for (const key of RATE_LIMIT_ENV_KEYS) {
        if (savedEnv[key] === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = savedEnv[key]
        }
      }
    })

    /** One login attempt; returns status/headers/data for 2xx and error statuses alike. */
    async function attemptLogin(
      password: string,
      headers?: Record<string, string>,
      path: string = CUSTOMER_EMAILPASS_PATH
    ): Promise<AttemptResult> {
      try {
        const response = await api.post(
          path,
          { email: PROBE_EMAIL, password },
          { headers }
        )
        return {
          status: response.status,
          headers: response.headers,
          data: response.data,
        }
      } catch (error: any) {
        if (error?.response) {
          return {
            status: error.response.status,
            headers: error.response.headers,
            data: error.response.data,
          }
        }
        throw error
      }
    }

    it("1. allows auth attempts below the configured limit", async () => {
      // Window count 1 of 5 on the shared route: authentication rejects
      // the wrong password (401) - the limiter must not interfere below
      // the limit.
      const attempt = await attemptLogin(
        "wrong-password-below-limit",
        undefined,
        SHARED_BUDGET_PATH
      )
      expect(attempt.status).toBe(401)
      expect(attempt.headers["x-ratelimit-limit"]).toBe(AUTH_MAX)
      expect(attempt.headers["x-ratelimit-remaining"]).toBe("4")
      expect(attempt.headers["retry-after"]).toBeUndefined()
    }, 120000)

    it("2. does not trust spoofed X-Forwarded-For headers by default", async () => {
      // Counts 2-5 of 5. With RATE_LIMIT_TRUSTED_PROXY_HOPS=0 the claimed
      // addresses are ignored, so every one of these lands in the same
      // socket-IP bucket. All four are still allowed here; test 3 proves
      // they shared the budget (a spoofing bypass would leave headroom).
      const claimed = ["1.1.1.1", "2.2.2.2", "99.99.99.99", "8.8.8.8"]
      for (const address of claimed) {
        const attempt = await attemptLogin(
          "wrong-password-spoof-check",
          { "x-forwarded-for": address },
          SHARED_BUDGET_PATH
        )
        expect(attempt.status).toBe(401)
        expect(attempt.headers["retry-after"]).toBeUndefined()
      }
    }, 120000)

    it("3. answers 429 with retry info once the limit is exceeded", async () => {
      // Count 6 of 5: the shared bucket is exhausted - including the
      // requests that carried spoofed forwarded headers in test 2.
      const blocked = await attemptLogin(
        "wrong-password-above-limit",
        undefined,
        SHARED_BUDGET_PATH
      )
      expect(blocked.status).toBe(429)

      const retryAfter = Number(blocked.headers["retry-after"])
      expect(Number.isInteger(retryAfter)).toBe(true)
      expect(retryAfter).toBeGreaterThanOrEqual(1)
      expect(retryAfter).toBeLessThanOrEqual(Math.ceil(Number(AUTH_WINDOW_MS) / 1000))

      expect(blocked.headers["x-ratelimit-limit"]).toBe(AUTH_MAX)
      expect(blocked.headers["x-ratelimit-remaining"]).toBe("0")

      expect(blocked.data).toMatchObject({
        type: "rate_limit",
        retryAfter,
      })
      expect(typeof blocked.data.message).toBe("string")
      expect(blocked.data.message.length).toBeGreaterThan(0)
    }, 120000)

    it("4. resets the window so the lockout is not permanent", async () => {
      // Self-contained expiry proof: exhaust a FRESH bucket (the customer
      // route was never used above) under a short window, verify it is
      // really blocking, sleep past the window, verify it reset. Every
      // request here happens inside one test - no runner DB-restore gaps
      // between them - so suite load cannot expire anything early (the
      // G10-F root cause of the old cross-test timing failure).
      process.env.RATE_LIMIT_AUTH_WINDOW_MS = EXPIRY_WINDOW_MS
      try {
        let blocked: AttemptResult | undefined
        for (let i = 0; i < 12 && blocked === undefined; i++) {
          const attempt = await attemptLogin("wrong-password-window-expiry")
          if (attempt.status === 429) {
            blocked = attempt
          }
        }
        if (blocked === undefined) {
          throw new Error(
            `limiter never answered 429 within 12 attempts under the ${EXPIRY_WINDOW_MS}ms window`
          )
        }
        expect(blocked.headers["x-ratelimit-remaining"]).toBe("0")

        // The bucket's resetAt was stamped with EXPIRY_WINDOW_MS when it
        // was created, so sleeping past it (measured from after the loop)
        // always expires it, regardless of how slow the loop was.
        await new Promise((resolve) =>
          setTimeout(resolve, Number(EXPIRY_WINDOW_MS) + 1000)
        )

        const afterWindow = await attemptLogin("wrong-password-window-expiry")
        expect(afterWindow.status).toBe(401)
        expect(Number(afterWindow.headers["x-ratelimit-remaining"])).toBeLessThan(
          Number(AUTH_MAX)
        )
        expect(afterWindow.headers["retry-after"]).toBeUndefined()
      } finally {
        process.env.RATE_LIMIT_AUTH_WINDOW_MS = AUTH_WINDOW_MS
      }
    }, 120000)

    it("5. never writes credentials or tokens into the logs", async () => {
      // Issue a real token (register + successful login) so the assertions
      // below have genuine secrets that must not appear in any output.
      const registration = await api.post(
        "/auth/customer/emailpass/register",
        { email: PROBE_EMAIL, password: PROBE_PASSWORD }
      )
      expect(registration.status).toBe(200)
      const registerToken = registration.data.token
      expect(registerToken).toBeTruthy()

      const login = await attemptLogin(PROBE_PASSWORD)
      expect(login.status).toBe(200)
      const loginToken = login.data.token
      expect(loginToken).toBeTruthy()

      const allLogs = capturedLogs.join("\n")
      expect(allLogs).not.toContain(PROBE_PASSWORD)
      expect(allLogs).not.toContain(registerToken)
      expect(allLogs).not.toContain(loginToken)
      expect(allLogs).not.toContain("Bearer ")
    }, 120000)
  },
})
