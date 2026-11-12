/**
 * Redaction helpers for anything that might reach a log line or an error
 * message. Key-based: an object key that looks credential-ish has its value
 * replaced wholesale, so nested payloads are covered without knowing the
 * exact response shape.
 */

export const REDACTED = "[REDACTED]"

const SENSITIVE_KEY_PATTERNS = [
  /set-cookie/i,
  /^cookie$/i,
  /^cookies$/i,
  /authorization/i,
  /api[-_]?key/i,
  /access[-_]?token/,
  /refresh[-_]?token/,
  /\btoken\b/i,
  /secret/i,
  /password/i,
  /^pass$/i,
  /session[-_]?id/i,
  /x-amz-security-token/i,
]

const BEARER_PATTERN = /bearer\s+[A-Za-z0-9._~+/=-]+/gi

/** True when a key name indicates its value must never be logged. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

/** Strip `Bearer <token>`-style credentials from free-form strings. */
export function redactString(value: string): string {
  return value.replace(BEARER_PATTERN, "Bearer " + REDACTED)
}

/**
 * Deep-redact a JSON-ish value: sensitive keys are replaced, strings are
 * scrubbed of bearer credentials, arrays and objects are walked. Unknown
 * primitives pass through untouched. Never throws on cyclic-free input;
 * cycles fall back to the original reference.
 */
export function redactSensitive<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactString(value)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return value
    }
    seen.add(value)
    return value.map((item) => redactValue(item, seen))
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value as object)) {
      return value
    }
    seen.add(value as object)
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(item, seen)
    }
    return out
  }
  return value
}
