import type { MetadataRoute } from "next"
import { getBaseURL } from "@lib/util/env"
import { buildRobots } from "@lib/seo/robots"

/**
 * Framework-native robots.txt (Next.js metadata route — served at
 * `/robots.txt`). Replaces the obsolete `next-sitemap` package config that
 * was never installed.
 */
export default function robots(): MetadataRoute.Robots {
  return buildRobots(getBaseURL())
}
