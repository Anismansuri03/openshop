import { configureStoreSearch, defineMiddlewares } from '@medusajs/framework/http'
import { createAuthRateLimitMiddleware } from '../lib/auth-rate-limit'
import { createTaxRateValidationMiddleware } from '../lib/tax-rate-validation'

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
    {
      // Public credential endpoints (login, register, password reset,
      // token refresh). Counted per client IP + path; forwarded headers are
      // ignored unless RATE_LIMIT_TRUSTED_PROXY_HOPS is configured. Tunables
      // and the in-memory multi-instance limitation are documented in
      // docs/local-development.md ("Auth rate limiting").
      method: ['GET', 'POST'],
      matcher: '/auth/*',
      middlewares: [createAuthRateLimitMiddleware()],
    },
    {
      // Stock admin tax routes accept `rate` (and `default_tax_rate.rate`
      // on tax-region create) as a bare unbounded number upstream, so a
      // direct API call could store a negative or >100 rate that the system
      // tax provider would then multiply into every order. This adds the
      // range check the dashboard form only advises via HTML min/max.
      // Calculation itself stays in the tax module - see docs/TAX.md.
      method: ['POST'],
      matcher: '/admin/tax-rates',
      middlewares: [createTaxRateValidationMiddleware()],
    },
    {
      // The tax-rate update route is POST /admin/tax-rates/[id].
      method: ['POST'],
      matcher: '/admin/tax-rates/*',
      middlewares: [createTaxRateValidationMiddleware()],
    },
    {
      // Tax-region create can carry an inline default rate.
      method: ['POST'],
      matcher: '/admin/tax-regions',
      middlewares: [createTaxRateValidationMiddleware()],
    },
    {
      // Provider webhooks verify their signature over the EXACT raw bytes
      // of the body, so the parsed JSON alone is not enough:
      // preserveRawBody makes express stash the raw Buffer on req.rawBody,
      // which src/lib/payment-webhooks.ts refuses to run without (a missing
      // raw body is a server misconfiguration -> 500, never an
      // acknowledgment).
      methods: ['POST'],
      matcher: '/webhooks/*',
      bodyParser: {
        preserveRawBody: true,
      },
    },
  ],
})
