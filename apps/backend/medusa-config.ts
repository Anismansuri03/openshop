import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { collectEnvReport } from './src/config/validate-env'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// Fail fast, before any module boots, and name variables without printing
// their values. Hard errors block startup; development warnings are printed
// so the documented first-run flow keeps working.
const envReport = collectEnvReport(process.env, {
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
})
if (envReport.warnings.length > 0) {
  console.warn('Environment warnings (values are never printed):')
  envReport.warnings.forEach((warning) => console.warn(`  - ${warning}`))
}
if (envReport.errors.length > 0) {
  console.error('Environment validation failed (values are never printed):')
  envReport.errors.forEach((error) => console.error(`  - ${error}`))
  throw new Error(
    `Invalid environment configuration: ${envReport.errors.length} problem(s) found. See the messages above.`
  )
}
if ((process.env.NODE_ENV || 'development') === 'production') {
  // Truthful regardless of configuration: without gateway credentials this
  // repository can only simulate payments, and anyone deploying it as-is
  // must not be left to discover that from a silent cart. The simulated
  // providers additionally refuse to boot in production unless explicitly
  // acknowledged (ENABLE_DEV_PAYMENT_PROVIDER / ENABLE_SIM_PAYMENT_PROVIDER,
  // see docs/PAYMENTS.md).
  if (process.env.STRIPE_API_KEY) {
    console.warn(
      'Payment notice: the official Stripe provider is registered from ' +
        'STRIPE_API_KEY. Verify STRIPE_MODE, STRIPE_WEBHOOK_SECRET and the ' +
        'provider dashboard endpoint before accepting real money ' +
        '(docs/PAYMENTS.md, docs/G2_SANDBOX_VALIDATION.md).'
    )
  } else {
    console.warn(
      'Payment notice: no payment gateway credentials are configured. ' +
        'Checkout runs on simulated/test providers only (pp_dev-payment_default, ' +
        'pp_sim-payment_default and pp_system_default never process real money). ' +
        'Set STRIPE_API_KEY to register the official Stripe provider.'
    )
  }
}

// G2: payment providers are assembled here so registration is explicit and
// credential-driven:
//  - dev-payment (G5) and sim-payment (G2) are local simulators, always
//    registered, labelled, and production-refusing unless acknowledged;
//  - the OFFICIAL Stripe provider registers only when STRIPE_API_KEY is
//    present. There is deliberately no fallback from Stripe to a simulator:
//    a missing key means Stripe is unavailable, never that payments are
//    silently simulated (validate-env.ts enforces the key/mode rules).
const paymentProviders: Array<{
  resolve: string
  id: string
  options?: Record<string, unknown>
}> = [
  {
    resolve: './src/modules/dev-payment',
    id: 'default',
  },
  {
    resolve: './src/modules/sim-payment',
    id: 'default',
    options: {
      // Simulator webhook signing secret. Non-production runs fall back to a
      // well-known local value so first-run and tests need no setup; in
      // production validateOptions refuses an empty/absent secret. Never a
      // real credential — the simulator cannot move money.
      webhookSecret:
        process.env.SIM_PAYMENT_WEBHOOK_SECRET ||
        ((process.env.NODE_ENV || 'development') === 'production'
          ? ''
          : 'openshop-local-sim-webhook-secret'),
    },
  },
]

const stripeApiKey = process.env.STRIPE_API_KEY
if (stripeApiKey) {
  paymentProviders.push({
    // Official provider shipped with Medusa 2.21.2 (pinned, no upgrade).
    // Container key: pp_stripe_stripe — already known to the storefront.
    resolve: '@medusajs/payment-stripe',
    id: 'stripe',
    options: {
      apiKey: stripeApiKey,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    },
  })
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  // Payment module: user providers are assembled above (G5 simulator, G2
  // local simulator, official Stripe when STRIPE_API_KEY is present).
  // `resolveModules` appends user entries to the default set and keys them
  // by service name (last entry wins), so this replaces only the default
  // payment module entry — which carries no options — while every other
  // default module stays untouched. Each provider's static validateOptions
  // runs eagerly at boot (production refusals: ENABLE_DEV_PAYMENT_PROVIDER /
  // ENABLE_SIM_PAYMENT_PROVIDER).
  modules: [
    {
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: paymentProviders,
      },
    },
    // G2: durable webhook dedup + reconciliation journal, stored in the
    // same database. Resolves from the container as `resolve("paymentEvents")`
    // (the key comes from the service's joiner config serviceName).
    {
      resolve: './src/modules/payment-events',
    },
  ],
})
