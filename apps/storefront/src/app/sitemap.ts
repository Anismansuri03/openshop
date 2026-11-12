import type { MetadataRoute } from "next"
import { getBaseURL } from "@lib/util/env"
import { buildSitemap, fetchSitemapData } from "@lib/seo/sitemap"

/**
 * Framework-native sitemap (Next.js metadata route — served at
 * `/sitemap.xml`). Replaces the obsolete `next-sitemap` package config that
 * was never installed (see docs/master roadmap G11).
 *
 * Regenerated hourly: catalogue changes reach crawlers without a redeploy.
 * If regeneration fails at runtime, Next serves the last successful output,
 * and `fetchSitemapData` itself degrades to the static routes (country
 * homepages + /store) when the backend is unreachable at generation time, so
 * this route cannot 500 because the catalogue is down.
 *
 * `getBaseURL()` throws in production when NEXT_PUBLIC_BASE_URL is missing,
 * malformed or loopback — a misconfigured build fails here, loudly, instead
 * of publishing localhost URLs.
 */
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseURL()

  const data = await fetchSitemapData({
    backendUrl: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "",
    publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
    defaultCountry: process.env.NEXT_PUBLIC_DEFAULT_REGION || "dk",
  })

  return buildSitemap(baseUrl, data)
}
