/**
 * Bounds validation for tax-rate input on the stock admin tax routes (G3).
 *
 * Why this exists: upstream `AdminCreateTaxRate` / `AdminUpdateTaxRate`
 * validate `rate` as a bare `z.number().optional()` with no bounds, and the
 * dashboard's percentage input only carries advisory HTML `min`/`max`
 * attributes. A direct API caller can therefore store a negative rate or a
 * rate above 100, and the system tax provider would multiply it into every
 * subsequent order total without complaint. This middleware makes such input
 * fail loudly with an actionable message instead.
 *
 * Scope: it guards the request bodies of the stock routes
 * (`POST/PUT /admin/tax-rates`, `POST /admin/tax-regions` with an inline
 * `default_tax_rate`). It does NOT calculate tax, does not touch stored
 * rates, and does not replace the tax module - authoritative calculation
 * stays server-side in the tax module exactly as before.
 *
 * `rate: null` / omitted stays valid: an omitted or null rate is how Medusa
 * represents a zero-rated / exempt line (the system provider maps it to 0).
 * Only out-of-range or non-numeric values are rejected.
 */

/** Lowest accepted percentage (inclusive). Zero is a legitimate rate. */
export const TAX_RATE_MIN = 0
/** Highest accepted percentage (inclusive). No real-world rate exceeds 100. */
export const TAX_RATE_MAX = 100

/**
 * Minimal express-shaped body surface (unit-test friendly). The index
 * signatures matter: this parses untrusted input (any shape Medusa hands
 * us), and without them `MedusaRequest`'s `Record<string, unknown>` body is
 * not assignable here and test fixtures fail excess-property checks.
 */
export type TaxRateRequestBody = {
  [key: string]: unknown
  rate?: unknown
  default_tax_rate?: { [key: string]: unknown; rate?: unknown } | null
}

export type TaxRateRequest = {
  /** `MedusaRequest.body` is `unknown`; the shape is checked at runtime. */
  body?: unknown
}

export type TaxRateResponse = {
  status(code: number): TaxRateResponse
  json(body: unknown): unknown
}

/**
 * Validates a single rate value. Returns `null` when acceptable, otherwise a
 * message naming the field, the accepted range, and what was received -
 * the operator can fix the request without reading this file.
 */
export function validateTaxRateValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    // Omitted/null means "no rate" (exempt or zero-rated) - allowed.
    return null
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return (
      `Tax rate must be a number between ${TAX_RATE_MIN} and ${TAX_RATE_MAX} ` +
      `(percent). Received: ${JSON.stringify(value)}.`
    )
  }
  if (value < TAX_RATE_MIN || value > TAX_RATE_MAX) {
    return (
      `Tax rate must be between ${TAX_RATE_MIN} and ${TAX_RATE_MAX} ` +
      `(percent). Received: ${value}.`
    )
  }
  return null
}

/**
 * Validates a tax-rate request body: the top-level `rate` (create/update
 * tax rate) and the nested `default_tax_rate.rate` (create tax region with
 * an inline default rate). Returns the first violation found, or null.
 */
export function validateTaxRateBody(body: TaxRateRequestBody | undefined): string | null {
  if (!body || typeof body !== "object") {
    return null
  }
  const topLevel = validateTaxRateValue(body.rate)
  if (topLevel) {
    return topLevel
  }
  const nested = body.default_tax_rate
  if (nested && typeof nested === "object") {
    return validateTaxRateValue(nested.rate)
  }
  return null
}

/**
 * Builds the middleware registered for the stock admin tax routes in
 * src/api/middlewares.ts. Rejects out-of-range rates with HTTP 400 and a
 * JSON body matching Medusa's error shape (`message` + `type`) so admin
 * clients surface it like any other validation failure.
 */
export function createTaxRateValidationMiddleware() {
  return function taxRateValidation(
    req: TaxRateRequest,
    res: TaxRateResponse,
    next: (err?: unknown) => void
  ): void {
    const message = validateTaxRateBody(
      req.body as TaxRateRequestBody | undefined
    )
    if (message) {
      res.status(400).json({
        message,
        type: "invalid_data",
      })
      return
    }
    next()
  }
}
