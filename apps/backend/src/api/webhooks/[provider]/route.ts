import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handlePaymentWebhook } from "../../../lib/payment-webhooks"

/**
 * Provider-neutral webhook endpoint (G2): POST /webhooks/:provider
 *
 * `provider` is a public path segment from an explicit allowlist
 * (sim-payment, stripe) — anything else answers 404. The handler in
 * src/lib/payment-webhooks.ts runs the full verify -> extract -> reserve ->
 * apply -> finalize pipeline; this file stays a thin HTTP adapter so the
 * status code mapping is decided in one testable place.
 *
 * Requires the `/webhooks/*` bodyParser entry in src/api/middlewares.ts
 * (preserveRawBody) — signature verification depends on req.rawBody.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const result = await handlePaymentWebhook(req, req.params.provider)
  res.status(result.status).json(result.body)
}
