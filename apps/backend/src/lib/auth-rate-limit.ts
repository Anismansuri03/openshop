/**
 * In-memory rate limiting for the public auth endpoints.
 *
 * Scope: every request under `/auth/*` (login, register, password reset,
 * token refresh) is counted per client IP, HTTP method, and path — so a
 * burst on one endpoint never locks a user out of the others (an
 * over-aggressive global lockout would itself be a denial of service).
 *
 * Algorithm: fixed window per key. Requests are allowed while the window
 * count is within the configured maximum; the next request gets HTTP 429
 * with `Retry-After` (seconds) plus a JSON body carrying the same value.
 *
 * Client IP: forwarded headers (`X-Forwarded-For`) are IGNORED by default —
 * any client can send them, so trusting them unconditionally lets an
 * attacker rotate fake addresses to bypass the limit. Operators running
 * behind a reverse proxy set `RATE_LIMIT_TRUSTED_PROXY_HOPS` to the number
 * of trusted proxy hops; the client is then taken from the right-hand
 * (proxy-appended) portion of the header that those hops own. When the
 * header is missing or shorter than the configured hop count, the socket
 * address is used instead (the safe fallback: a shared bucket behind a
 * proxy is preferable to a spoofable one).
 *
 * Storage limitation (important): counters live in this process's memory.
 * With multiple backend instances (or serverless/autoscaled deployments)
 * each instance enforces the limit independently, so the effective global
 * limit is `instances x configured limit`, and counters reset on every
 * deploy/restart. A shared store (e.g. Redis) or an edge-level limiter is
 * required for a strict global limit — see docs/local-development.md.
 *
 * Logging: this middleware never logs. Auth request paths, headers and
 * bodies can carry credentials or tokens; a rate-limit hit must not become
 * a channel that writes them to disk.
 */

export type RateLimitConfig = {
  /** Window length in milliseconds. */
  windowMs: number
  /** Maximum allowed requests per key per window. */
  max: number
  /** Trusted reverse-proxy hops before `X-Forwarded-For` is consulted. */
  trustedProxyHops: number
}

export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  /** Seconds until the current window resets; 0 while allowed. */
  retryAfterSeconds: number
}

type Bucket = {
  count: number
  resetAt: number
}

/** Default: 10 requests per minute per IP+route. */
export const DEFAULT_WINDOW_MS = 60_000
export const DEFAULT_MAX = 10

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/** Reads the (non-secret) tunables from the environment with safe defaults. */
export function readRateLimitConfig(
  env: Record<string, string | undefined>
): RateLimitConfig {
  return {
    windowMs: positiveInt(env.RATE_LIMIT_AUTH_WINDOW_MS, DEFAULT_WINDOW_MS),
    max: positiveInt(env.RATE_LIMIT_AUTH_MAX, DEFAULT_MAX),
    trustedProxyHops: nonNegativeInt(env.RATE_LIMIT_TRUSTED_PROXY_HOPS, 0),
  }
}

/** Collapses IPv4-mapped IPv6 (`::ffff:1.2.3.4`) to plain IPv4. */
export function normalizeIp(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip
}

export type ClientIpInput = {
  headers: Record<string, string | string[] | undefined> | undefined
  socketAddress?: string | null
  trustedProxyHops: number
}

/**
 * Resolves the client IP for rate-limit keying.
 *
 * With `trustedProxyHops = 0` (default) forwarded headers are never read.
 * With hops > 0 the client is the entry `hops` positions from the right of
 * `X-Forwarded-For` — the positions appended by the trusted proxies, which
 * an external client cannot forge. Anything left of those positions is
 * client-supplied and deliberately ignored.
 */
export function resolveClientIp(input: ClientIpInput): string {
  const fallback = normalizeIp(input.socketAddress ?? "unknown")

  if (input.trustedProxyHops <= 0) {
    return fallback
  }

  const raw = input.headers?.["x-forwarded-for"]
  const headerValue = Array.isArray(raw) ? raw.join(",") : raw
  if (!headerValue) {
    return fallback
  }

  const parts = headerValue
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  const index = parts.length - input.trustedProxyHops

  // Fewer entries than trusted hops: the chain cannot be verified, so fall
  // back to the socket address rather than trusting a client-made claim.
  if (index < 0) {
    return fallback
  }

  return normalizeIp(parts[index])
}

export type RateLimiter = {
  check(key: string, config: RateLimitConfig): RateLimitResult
  /** Number of live buckets — test/diagnostic helper. */
  size: () => number
}

/**
 * Creates an in-memory fixed-window limiter. The `now` hook exists for
 * deterministic tests (window expiry without sleeping).
 */
export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, Bucket>()
  let lastSweepAt = now()

  return {
    check(key, config) {
      const at = now()

      // Periodically drop expired buckets so the map cannot grow without
      // bound under traffic from many distinct IPs.
      if (at - lastSweepAt >= config.windowMs) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.resetAt <= at) {
            buckets.delete(bucketKey)
          }
        }
        lastSweepAt = at
      }

      let bucket = buckets.get(key)
      if (!bucket || bucket.resetAt <= at) {
        bucket = { count: 0, resetAt: at + config.windowMs }
        buckets.set(key, bucket)
      }

      bucket.count += 1
      const allowed = bucket.count <= config.max
      const remaining = Math.max(0, config.max - bucket.count)
      const retryAfterSeconds = allowed
        ? 0
        : Math.max(1, Math.ceil((bucket.resetAt - at) / 1000))

      return { allowed, limit: config.max, remaining, retryAfterSeconds }
    },
    size: () => buckets.size,
  }
}

/** Minimal express-shaped request/response surface (unit-test friendly). */
export type RateLimitRequest = {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string | null }
}

export type RateLimitResponse = {
  setHeader(name: string, value: string): unknown
  status(code: number): RateLimitResponse
  json(body: unknown): unknown
}

/**
 * Builds the middleware registered for `/auth/*` in src/api/middlewares.ts.
 * One instance (and therefore one counter store) is created per app boot.
 *
 * The environment is read per request so operators can retune limits
 * without code changes and tests can configure a small window.
 */
export function createAuthRateLimitMiddleware(
  overrides?: Partial<RateLimitConfig>
) {
  const limiter = createRateLimiter()

  return function authRateLimit(
    req: RateLimitRequest,
    res: RateLimitResponse,
    next: (err?: unknown) => void
  ): void {
    const envConfig = readRateLimitConfig(process.env)
    const config: RateLimitConfig = { ...envConfig, ...overrides }

    const ip = resolveClientIp({
      headers: req.headers,
      socketAddress: req.socket?.remoteAddress,
      trustedProxyHops: config.trustedProxyHops,
    })
    // Key = client + method + path. `req.path` never contains the query
    // string, so identifiers or tokens in a query can never become part of
    // a key (or of any log line — this middleware logs nothing).
    const key = `${ip}|${req.method} ${req.path}`
    const result = limiter.check(key, config)

    res.setHeader("X-RateLimit-Limit", String(result.limit))
    res.setHeader("X-RateLimit-Remaining", String(result.remaining))

    if (result.allowed) {
      next()
      return
    }

    res.setHeader("Retry-After", String(result.retryAfterSeconds))
    res.status(429).json({
      message: "Too many requests. Please try again later.",
      type: "rate_limit",
      retryAfter: result.retryAfterSeconds,
    })
  }
}
