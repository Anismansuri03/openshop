import type { MetadataRoute } from "next"

/**
 * robots.txt generation (master mission G11).
 *
 * The storefront previously had no robots.txt at all (the dead
 * `next-sitemap.js` config was the only thing that ever would have produced
 * one, and its package is not installed — see the removal record in the
 * master roadmap).
 *
 * Policy: everything public is crawlable; session/private surfaces (cart,
 * checkout, account, order confirmations, account verification, the internal
 * API route) are disallowed — in both their bare form (the middleware
 * redirects them to `/{cc}/...`) and their country-prefixed form. Disallow
 * rules are directives to well-behaved crawlers only: they are NOT access
 * control, and the server still relies on route authentication for anything
 * sensitive.
 *
 * This origin is the configured public storefront origin (validated in
 * `src/lib/util/env.ts`), so the Sitemap line is always absolute and never
 * localhost in production builds.
 */
export function buildRobots(baseUrl: string): MetadataRoute.Robots {
  const base = baseUrl.replace(/\/+$/, "")
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/cart",
        "/checkout",
        "/account",
        "/order",
        "/verify-account",
        "/api",
        "/*/cart",
        "/*/checkout",
        "/*/account",
        "/*/order",
        "/*/verify-account",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
