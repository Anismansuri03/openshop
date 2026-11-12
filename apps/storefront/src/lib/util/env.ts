/**
 * Public storefront origin resolution (master mission G11 — metadataBase fix).
 *
 * NEXT_PUBLIC_BASE_URL is the single configured source for every absolute URL
 * the storefront emits (metadataBase, Open Graph, sitemap, robots). Rules:
 *
 * - Format: an absolute http(s) origin, e.g. `https://shop.example.com`
 *   (optional port, no trailing path, query, hash or credentials).
 * - Production (NODE_ENV === "production"): the variable is REQUIRED and a
 *   loopback address (localhost, *.localhost, 127.0.0.1, ::1) is REJECTED —
 *   a production build must never silently publish localhost canonical/OG
 *   URLs. Misconfiguration fails the build with a clear error instead.
 * - Development/test: unset falls back to `http://localhost:8000` (the
 *   documented local dev server), and a loopback value is allowed so the
 *   local development workflow keeps working unchanged.
 *
 * Validation errors deliberately NEVER echo the raw value: a mispasted URL
 * can contain credentials, and error output ends up in build logs.
 *
 * NEXT_PUBLIC_ variables are read at build time by Next.js — set this before
 * `next build` (and keep it set in the runtime environment of the server).
 */
const DEV_BASE_URL = "http://localhost:8000"

function fail(reason: string): never {
  throw new Error(
    `Invalid NEXT_PUBLIC_BASE_URL: ${reason}. Expected an absolute origin ` +
      'such as "https://shop.example.com". The value itself is not shown ' +
      "here because malformed input may contain credentials."
  )
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  )
}

export const getBaseURL = (): string => {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim()

  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_BASE_URL is not set, but production builds require the " +
          "public storefront origin (e.g. \"https://shop.example.com\"). Set it " +
          "in the build environment so canonical and Open Graph URLs are not " +
          "silently generated for localhost."
      )
    }
    return DEV_BASE_URL
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    fail("the value is not a parseable URL")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("only http:// and https:// origins are supported")
  }
  if (parsed.username || parsed.password) {
    fail("the origin must not contain credentials")
  }
  if (parsed.search || parsed.hash) {
    fail("the origin must not contain a query string or fragment")
  }

  const path = parsed.pathname.replace(/\/+$/, "")
  if (path !== "") {
    fail(
      "the origin must not contain a path (a reverse-proxy prefix would " +
        "require a matching basePath in next.config.js)"
    )
  }

  if (
    process.env.NODE_ENV === "production" &&
    isLoopback(parsed.hostname)
  ) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL points at a loopback address, but production " +
        "builds must not publish localhost canonical/Open Graph URLs. Set it " +
        "to your public storefront origin before building for production " +
        "(loopback values are for local development only)."
    )
  }

  // parsed.origin: scheme + host + port, normalized, no trailing slash.
  return parsed.origin
}
