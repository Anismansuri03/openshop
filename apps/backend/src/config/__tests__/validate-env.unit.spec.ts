import { collectEnvReport } from "../validate-env"

const baseEnv = {
  DATABASE_URL: "postgres://postgres:pw@localhost:5432/openshop_test",
  JWT_SECRET: "a-sufficiently-long-random-jwt-secret",
  COOKIE_SECRET: "another-sufficiently-long-random-cookie",
  STORE_CORS: "http://localhost:8000",
  ADMIN_CORS: "http://localhost:9000",
  AUTH_CORS: "http://localhost:9000",
}

const prod = { isProduction: true }
const dev = { isProduction: false }

const report = (env: Record<string, string | undefined>, options: { isProduction: boolean }) =>
  collectEnvReport(env, options)

describe("collectEnvReport", () => {
  it("accepts a fully configured environment in production", () => {
    const { errors, warnings } = report(baseEnv, prod)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it("rejects a missing DATABASE_URL by name", () => {
    const { errors } = report({ ...baseEnv, DATABASE_URL: undefined }, prod)
    expect(errors.some((e) => e.includes("DATABASE_URL"))).toBe(true)
  })

  it("rejects a non-postgreSQL DATABASE_URL", () => {
    const { errors } = report(
      { ...baseEnv, DATABASE_URL: "mysql://localhost/shop" },
      prod
    )
    expect(errors.some((e) => e.includes("DATABASE_URL"))).toBe(true)
  })

  it("never echoes connection strings or secret values in messages", () => {
    const password = "SuperSecretPassword123!"
    const { errors, warnings } = report(
      {
        ...baseEnv,
        DATABASE_URL: `postgres://admin:${password}@db.internal/prod`,
        JWT_SECRET: password,
        COOKIE_SECRET: password,
        STORE_CORS: undefined,
        ADMIN_CORS: undefined,
        AUTH_CORS: undefined,
      },
      prod
    )
    const all = [...errors, ...warnings].join("\n")
    expect(all).not.toContain(password)
    expect(all).not.toContain("db.internal")
    expect(all).not.toContain("admin:")
  })

  it("fails production when JWT_SECRET is missing", () => {
    const { errors } = report({ ...baseEnv, JWT_SECRET: undefined }, prod)
    expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true)
  })

  it("fails production when secrets still hold placeholder values", () => {
    const { errors } = report(
      { ...baseEnv, JWT_SECRET: "supersecret", COOKIE_SECRET: "supersecret" },
      prod
    )
    expect(errors.filter((e) => e.includes("placeholder")).length).toBe(2)
  })

  it("fails production on short secrets", () => {
    const { errors } = report({ ...baseEnv, JWT_SECRET: "short" }, prod)
    expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true)
  })

  it("fails production when CORS origins are missing", () => {
    const { errors } = report(
      { ...baseEnv, STORE_CORS: undefined, ADMIN_CORS: undefined, AUTH_CORS: undefined },
      prod
    )
    expect(errors.filter((e) => e.includes("CORS")).length).toBe(3)
  })

  it("downgrades placeholder secrets and missing vars to warnings in development", () => {
    const { errors, warnings } = report(
      {
        DATABASE_URL: baseEnv.DATABASE_URL,
        JWT_SECRET: "supersecret",
        STORE_CORS: undefined,
        ADMIN_CORS: undefined,
        AUTH_CORS: undefined,
      },
      dev
    )
    expect(errors).toEqual([])
    expect(warnings.some((w) => w.includes("JWT_SECRET"))).toBe(true)
    expect(warnings.filter((w) => w.includes("CORS")).length).toBe(3)
  })

  it("still blocks development when DATABASE_URL is missing (prevents seeding an unknown default DB)", () => {
    const { errors } = report({ ...baseEnv, DATABASE_URL: undefined }, dev)
    expect(errors.some((e) => e.includes("DATABASE_URL"))).toBe(true)
  })
})

describe("collectEnvReport payment rules (G2)", () => {
  const stripeTest = {
    STRIPE_API_KEY: "sk_test_MARKER123456",
    STRIPE_WEBHOOK_SECRET: "whsec_test_marker123456",
    STRIPE_MODE: "test",
  }
  const stripeLive = {
    STRIPE_API_KEY: "sk_live_MARKER123456",
    STRIPE_WEBHOOK_SECRET: "whsec_live_marker123456",
    STRIPE_MODE: "live",
  }

  it("accepts a test Stripe configuration in development", () => {
    const { errors, warnings } = report(
      { ...baseEnv, ...stripeTest },
      dev
    )
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it("refuses a Stripe API key without a webhook secret", () => {
    const { errors } = report(
      { ...baseEnv, STRIPE_API_KEY: stripeTest.STRIPE_API_KEY },
      dev
    )
    expect(errors.some((e) => e.includes("STRIPE_WEBHOOK_SECRET"))).toBe(true)
  })

  it("refuses a LIVE Stripe key outside production", () => {
    const { errors } = report(
      { ...baseEnv, ...stripeLive, NODE_ENV: undefined },
      dev
    )
    expect(errors.some((e) => e.includes("LIVE Stripe key"))).toBe(true)
    expect(errors.some((e) => e.includes("NODE_ENV"))).toBe(true)
  })

  it("refuses a LIVE Stripe key without STRIPE_MODE=live", () => {
    const { errors } = report(
      {
        ...baseEnv,
        STRIPE_API_KEY: stripeLive.STRIPE_API_KEY,
        STRIPE_WEBHOOK_SECRET: stripeLive.STRIPE_WEBHOOK_SECRET,
      },
      prod
    )
    expect(errors.some((e) => e.includes("STRIPE_MODE"))).toBe(true)
  })

  it("accepts a LIVE Stripe key in production with STRIPE_MODE=live", () => {
    const { errors, warnings } = report({ ...baseEnv, ...stripeLive }, prod)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it("refuses STRIPE_MODE=live paired with a test key", () => {
    const { errors } = report(
      {
        ...baseEnv,
        STRIPE_API_KEY: stripeTest.STRIPE_API_KEY,
        STRIPE_WEBHOOK_SECRET: stripeTest.STRIPE_WEBHOOK_SECRET,
        STRIPE_MODE: "live",
      },
      prod
    )
    expect(errors.some((e) => e.includes("STRIPE_MODE=live"))).toBe(true)
  })

  it("refuses an unknown STRIPE_MODE value", () => {
    const { errors } = report(
      { ...baseEnv, ...stripeTest, STRIPE_MODE: "sandbox" },
      dev
    )
    expect(errors.some((e) => e.includes("STRIPE_MODE"))).toBe(true)
  })

  it("warns when a webhook secret or mode is set without an API key", () => {
    const { errors, warnings } = report(
      {
        ...baseEnv,
        STRIPE_WEBHOOK_SECRET: stripeTest.STRIPE_WEBHOOK_SECRET,
        STRIPE_MODE: "test",
      },
      dev
    )
    expect(errors).toEqual([])
    expect(warnings.filter((w) => w.includes("STRIPE_")).length).toBe(2)
  })

  it("flags a short simulator webhook secret (warning in dev, error in production)", () => {
    const devReport = report(
      { ...baseEnv, SIM_PAYMENT_WEBHOOK_SECRET: "short" },
      dev
    )
    expect(devReport.errors).toEqual([])
    expect(
      devReport.warnings.some((w) => w.includes("SIM_PAYMENT_WEBHOOK_SECRET"))
    ).toBe(true)

    const prodReport = report(
      { ...baseEnv, SIM_PAYMENT_WEBHOOK_SECRET: "short" },
      prod
    )
    expect(
      prodReport.errors.some((e) => e.includes("SIM_PAYMENT_WEBHOOK_SECRET"))
    ).toBe(true)
  })

  it("requires a simulator secret when the simulator is enabled in production", () => {
    const { errors } = report(
      { ...baseEnv, ENABLE_SIM_PAYMENT_PROVIDER: "true" },
      prod
    )
    expect(
      errors.some(
        (e) =>
          e.includes("SIM_PAYMENT_WEBHOOK_SECRET") &&
          e.includes("ENABLE_SIM_PAYMENT_PROVIDER")
      )
    ).toBe(true)
  })

  it("never echoes Stripe key material in any message", () => {
    const secret = "sk_live_SUPERSECRETVALUE"
    const { errors, warnings } = report(
      { ...baseEnv, STRIPE_API_KEY: secret, STRIPE_WEBHOOK_SECRET: undefined },
      dev
    )
    const all = [...errors, ...warnings].join("\n")
    expect(all).not.toContain(secret)
    expect(all).not.toContain("SUPERSECRETVALUE")
    expect(all).not.toContain("whsec_")
  })
})
