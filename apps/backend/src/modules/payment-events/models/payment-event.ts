import { model } from "@medusajs/framework/utils"

/**
 * Durable payment event journal (G2).
 *
 * One row per inbound provider webhook event and one row per reconciliation
 * run, kept in the SAME database as the rest of Medusa (no second database).
 *
 * The composite unique constraint on (`provider`, `event_id`) is the
 * deduplication barrier for webhook replays: the webhook route tries to
 * insert a `processing` row first, and a unique-violation means the event
 * was already reserved (or processed) — see the reserve/finalize flow in
 * `service.ts` and `src/lib/payment-webhooks.ts`.
 *
 * Append-only by convention: journal rows are never soft-deleted (deleting
 * a row would deliberately allow the event to be reprocessed, which is a
 * policy decision this application never makes on its own).
 *
 * `payload` stores the parsed provider event (or the reconciliation
 * comparison result) for audit. It must never contain secrets: providers
 * send event data only, and error messages are truncated/scrubbed before
 * storage.
 */
const PaymentEvent = model.define("payment_event", {
  id: model.id({ prefix: "pev" }).primaryKey(),
  /** Provider identifier: "sim-payment", "stripe", ... */
  provider: model.text(),
  /** Provider-side event id (webhook) or run id (reconciliation). */
  event_id: model.text(),
  /** What kind of record this is. */
  kind: model.enum(["webhook", "reconciliation"]).default("webhook"),
  /** Processing lifecycle: processing -> processed | failed. */
  status: model.enum(["processing", "processed", "failed"]).default(
    "processing"
  ),
  /** The Medusa payment id the event applied to, when resolvable. */
  payment_id: model.text().nullable(),
  /** Resulting PaymentActions value for applied webhook events. */
  action: model.text().nullable(),
  /** Parsed event body / reconciliation result (audit snapshot). */
  payload: model.json().nullable(),
  /** Failure detail for `failed` rows — no secrets, length-limited. */
  error_message: model.text().nullable(),
  /** When processing finished (processed or failed). */
  processed_at: model.dateTime().nullable(),
}).indexes([
  {
    // Dedup barrier: at most one journal row per provider event.
    name: "IDX_payment_event_provider_event_id",
    on: ["provider", "event_id"],
    unique: true,
  },
  {
    // Look up "the current event for this payment" during reconciliation.
    name: "IDX_payment_event_payment_id",
    on: ["payment_id"],
  },
])

export default PaymentEvent
