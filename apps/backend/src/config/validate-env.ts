/**
 * Startup environment validation.
 *
 * Collects problems with *names* of variables only — values (passwords,
 * secrets, credentials inside DATABASE_URL) are never echoed into messages,
 * so a failed startup can be shared as a bug report without leaking secrets.
 *
 * Hard errors are reserved for conditions that would otherwise fail late,
 * silently, or dangerously:
 *  - DATABASE_URL missing or not a PostgreSQL URL (Medusa would otherwise
 *    silently fall back to a default localhost database),
 *  - missing/weak secrets in production (Medusa rejects some of these
 *    itself, but only after booting modules; we want the first message).
 * Development keeps warnings so the documented first-run flow (copy the
 * template, then fill in secrets) still works.
 */

export type EnvLike = Record<string, string | undefined>

export type EnvReport = {
  /** Blocking problems. Startup must fail. */
  errors: string[]
  /** Non-blocking problems, surfaced as warnings. */
  warnings: string[]
}

const MIN_SECRET_LENGTH = 16
const INSECURE_DEFAULT_SECRETS = new Set(["supersecret", "changeme", "secret"])
const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/\S+$/

const SECRET_KEYS = ["JWT_SECRET", "COOKIE_SECRET"] as const
const CORS_KEYS = ["STORE_CORS", "ADMIN_CORS", "AUTH_CORS"] as const

export function collectEnvReport(
  env: EnvLike,
  options: { isProduction: boolean }
): EnvReport {
  const errors: string[] = []
  const warnings: string[] = []
  const { isProduction } = options

  // --- database ---------------------------------------------------------
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    errors.push(
      "DATABASE_URL is not set. Set it in apps/backend/.env (copy from .env.template)."
    )
  } else if (!POSTGRES_URL_PATTERN.test(databaseUrl)) {
    errors.push(
      "DATABASE_URL is not a postgres:// or postgresql:// connection URL."
    )
  }

  // --- secrets ----------------------------------------------------------
  for (const key of SECRET_KEYS) {
    const value = env[key]
    if (!value) {
      if (isProduction) {
        errors.push(`${key} must be set when NODE_ENV=production.`)
      } else {
        warnings.push(
          `${key} is not set; the framework will fall back to a built-in development default. Set your own before deploying.`
        )
      }
      continue
    }
    if (INSECURE_DEFAULT_SECRETS.has(value.toLowerCase())) {
      const message = `${key} still holds an insecure placeholder value. Replace it with a long random string.`
      if (isProduction) {
        errors.push(message)
      } else {
        warnings.push(message)
      }
      continue
    }
    if (value.length < MIN_SECRET_LENGTH) {
      const message = `${key} is shorter than ${MIN_SECRET_LENGTH} characters; use a long random string.`
      if (isProduction) {
        errors.push(message)
      } else {
        warnings.push(message)
      }
    }
  }

  // --- CORS -------------------------------------------------------------
  for (const key of CORS_KEYS) {
    if (!env[key]) {
      const message = `${key} is not set; CORS may be misconfigured for the storefront or admin.`
      if (isProduction) {
        errors.push(message)
      } else {
        warnings.push(message)
      }
    }
  }

  // --- payments (G2) ----------------------------------------------------
  // Stripe credential rules. Messages name variables, never values.
  const stripeApiKey = env.STRIPE_API_KEY
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET
  const stripeMode = env.STRIPE_MODE
  const simWebhookSecret = env.SIM_PAYMENT_WEBHOOK_SECRET

  if (stripeMode && stripeMode !== "test" && stripeMode !== "live") {
    errors.push('STRIPE_MODE must be "test" or "live" when it is set.')
  }

  if (stripeApiKey) {
    // Key class is detected from the standard Stripe key marker only
    // (sk_live_... / sk_test_...); the value itself is never echoed.
    const liveKey = stripeApiKey.includes("_live_")

    if (liveKey && !isProduction) {
      errors.push(
        "STRIPE_API_KEY is a LIVE Stripe key but NODE_ENV is not production. " +
          "Live payment keys are refused outside NODE_ENV=production."
      )
    }
    if (liveKey && stripeMode !== "live") {
      errors.push(
        'STRIPE_API_KEY is a LIVE Stripe key but STRIPE_MODE is not "live". ' +
          "Refusing a contradictory live/test configuration."
      )
    }
    if (stripeMode === "live" && !stripeApiKey.includes("_live_")) {
      errors.push(
        'STRIPE_MODE=live but STRIPE_API_KEY is not a live Stripe key. ' +
          "Align the mode with the key or remove STRIPE_MODE."
      )
    }
    if (!stripeWebhookSecret) {
      errors.push(
        "STRIPE_API_KEY is set but STRIPE_WEBHOOK_SECRET is not. Stripe " +
          "webhooks cannot be verified without the signing secret; set both " +
          "or remove both (docs/PAYMENTS.md)."
      )
    }
  } else {
    // Stripe is deliberately unavailable without a key: the backend never
    // falls back from the real provider to a simulator.
    if (stripeWebhookSecret) {
      warnings.push(
        "STRIPE_WEBHOOK_SECRET is set but STRIPE_API_KEY is not; the Stripe " +
          "provider will not register."
      )
    }
    if (stripeMode) {
      warnings.push(
        "STRIPE_MODE is set but STRIPE_API_KEY is not; the Stripe provider " +
          "will not register."
      )
    }
  }

  if (simWebhookSecret && simWebhookSecret.length < MIN_SECRET_LENGTH) {
    const message = `SIM_PAYMENT_WEBHOOK_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; use a long random string.`
    if (isProduction) {
      errors.push(message)
    } else {
      warnings.push(message)
    }
  }
  if (
    isProduction &&
    env.ENABLE_SIM_PAYMENT_PROVIDER === "true" &&
    !simWebhookSecret
  ) {
    errors.push(
      "SIM_PAYMENT_WEBHOOK_SECRET must be set when the payment simulator is " +
        "explicitly enabled in production (ENABLE_SIM_PAYMENT_PROVIDER=true)."
    )
  }

  return { errors, warnings }
}
