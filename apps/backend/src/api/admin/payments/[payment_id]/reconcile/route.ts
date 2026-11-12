import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { reconcilePayment } from "../../../../../lib/payment-reconcile"

/**
 * POST /admin/payments/:payment_id/reconcile (G2)
 *
 * Reconciliation entry point for the admin dashboard and tests. Thin HTTP
 * adapter: all comparison logic (read-only provider status fetch, exact
 * classification, per-run journaling) lives in src/lib/payment-reconcile.ts.
 *
 * A missing payment id surfaces as MedusaError NOT_FOUND and is rendered by
 * Medusa's standard error handler as 404. Reconciliation itself can never
 * move money — it only reads local state and the provider's getPaymentStatus.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const report = await reconcilePayment(req, req.params.payment_id)
  res.status(200).json(report)
}
