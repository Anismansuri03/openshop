import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import PaymentEvent from "./models/payment-event"

/**
 * Payment event journal service (G2).
 *
 * Extends the generated Medusa CRUD (`createPaymentEvents`,
 * `retrievePaymentEvent`, `listPaymentEvents`, `updatePaymentEvents`) with
 * the two flows the application needs:
 *
 *  1. Webhook dedup — `reserveWebhookEvent` atomically claims
 *     (provider, event_id) before any business processing happens, so
 *     concurrent deliveries of the same event cannot both apply. The
 *     caller MUST finalize with `markEventProcessed` or `markEventFailed`
 *     (see src/lib/payment-webhooks.ts): a failed row is retryable, a
 *     processed row is a replay.
 *
 *  2. Reconciliation journaling — `journalReconciliation` records every
 *     comparison run (repeat-safe: journaling a run never changes payment
 *     state and never charges anything).
 *
 * Status semantics:
 *   processing -> processed   event applied, replays are duplicates
 *   processing -> failed      apply failed; a later delivery may retry it
 *   failed     -> processing  taken over by a new delivery (retry)
 *
 * A `processing` row older than STALE_RESERVATION_MS is considered
 * abandoned (the process died mid-apply) and may be taken over, so a crash
 * can never wedge an event forever.
 */

/** How long an in-flight reservation may live before it is stale. */
export const STALE_RESERVATION_MS = 5 * 60 * 1000

/** Maximum stored error message length (no unbounded payloads). */
export const MAX_ERROR_MESSAGE_LENGTH = 1000

export type PaymentEventKind = "webhook" | "reconciliation"
export type PaymentEventStatus = "processing" | "processed" | "failed"

export type ReserveWebhookEventInput = {
  provider: string
  event_id: string
  payload?: unknown
  payment_id?: string | null
}

export type ReserveWebhookEventResult =
  /** First delivery: caller must apply, then finalize. */
  | { outcome: "reserved"; id: string; took_over: boolean }
  /** Already applied: acknowledge as duplicate, do not re-apply. */
  | { outcome: "duplicate"; id: string; status: PaymentEventStatus }
  /** Another delivery is applying it right now: ask the provider to retry. */
  | { outcome: "in_flight"; id: string }

type PaymentEventRow = {
  id: string
  provider: string
  event_id: string
  status: PaymentEventStatus
  updated_at: Date | string
}

/**
 * True when a thrown error is a unique-constraint violation on
 * (provider, event_id).
 *
 * Two shapes occur in practice:
 *
 *  - the RAW driver error (Postgres `code 23505`; Medusa may wrap it, so
 *    the constraint name is checked as a fallback), and
 *  - Medusa's DAL `dbErrorMapper` output: it REWRITES the raw 23505 into a
 *    MedusaError (type INVALID_DATA, message
 *    "Payment event with provider: ..., event_id: ..., already exists.")
 *    that carries neither `code` nor `constraint`. Without recognizing
 *    this mapped shape, a duplicate delivery would be rethrown as an
 *    unknown error and the webhook would answer 500 instead of the
 *    contract's duplicate/in_flight responses.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  const err = error as {
    code?: string
    constraint?: string
    message?: string
    type?: string
    __isMedusaError?: boolean
  }
  if (!err) {
    return false
  }
  if (err.code === "23505") {
    return true
  }
  if (
    typeof err.constraint === "string" &&
    err.constraint.includes("payment_event")
  ) {
    return true
  }
  return (
    err.__isMedusaError === true &&
    err.type === MedusaError.Types.INVALID_DATA &&
    typeof err.message === "string" &&
    /^Payment event with .*, already exists\.$/.test(err.message)
  )
}

function ageMs(row: PaymentEventRow, now: number): number {
  const at = row.updated_at instanceof Date
    ? row.updated_at.getTime()
    : new Date(row.updated_at).getTime()
  return Number.isFinite(at) ? now - at : Number.POSITIVE_INFINITY
}

class PaymentEventsService extends MedusaService({
  PaymentEvent,
}) {
  /**
   * Atomically claim a webhook event for processing.
   *
   * Insert-first: the unique index does the arbitration, so two concurrent
   * deliveries of the same event resolve to exactly one `reserved` and one
   * `duplicate`/`in_flight` — never two applies.
   */
  async reserveWebhookEvent(
    input: ReserveWebhookEventInput
  ): Promise<ReserveWebhookEventResult> {
    try {
      const row = await this.createPaymentEvents({
        provider: input.provider,
        event_id: input.event_id,
        kind: "webhook",
        status: "processing",
        payload: (input.payload ?? null) as Record<string, unknown> | null,
        payment_id: input.payment_id ?? null,
      })
      return { outcome: "reserved", id: row.id, took_over: false }
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error
      }
    }

    const existing = await this.findEvent(input.provider, input.event_id)
    if (!existing) {
      // Conflict but no row visible (extremely rare: concurrent delete or
      // read-after-write lag). Surface the original failure rather than
      // guessing — the provider will retry.
      throw new Error(
        `Payment events: duplicate reservation for ${input.provider}/${input.event_id} could not be resolved.`
      )
    }

    if (existing.status === "processed") {
      return { outcome: "duplicate", id: existing.id, status: "processed" }
    }

    const now = Date.now()
    if (existing.status === "processing" && ageMs(existing, now) <= STALE_RESERVATION_MS) {
      return { outcome: "in_flight", id: existing.id }
    }

    // Failed (retry) or stale processing (abandoned): take the row over.
    await this.updatePaymentEvents({
      id: existing.id,
      status: "processing",
      error_message: null,
      payload: (input.payload ?? null) as Record<string, unknown> | null,
      payment_id: input.payment_id ?? null,
      processed_at: null,
    })
    return { outcome: "reserved", id: existing.id, took_over: true }
  }

  /** Mark a reserved webhook event as applied. */
  async markEventProcessed(input: {
    id: string
    action?: string | null
    payment_id?: string | null
  }): Promise<void> {
    await this.updatePaymentEvents({
      id: input.id,
      status: "processed",
      action: input.action ?? null,
      ...(input.payment_id ? { payment_id: input.payment_id } : {}),
      error_message: null,
      processed_at: new Date(),
    })
  }

  /**
   * Mark a reserved webhook event as failed. The row stays unique-keyed,
   * but a later delivery of the same event may take it over and retry.
   */
  async markEventFailed(input: {
    id: string
    error: unknown
  }): Promise<void> {
    await this.updatePaymentEvents({
      id: input.id,
      status: "failed",
      error_message: truncateError(input.error),
      processed_at: new Date(),
    })
  }

  /**
   * Journal one reconciliation run. Every run gets its own event_id (run
   * id), so runs never collide and never modify payment state.
   */
  async journalReconciliation(input: {
    provider: string
    run_id: string
    payment_id: string
    result: Record<string, unknown>
  }): Promise<{ id: string }> {
    const row = await this.createPaymentEvents({
      provider: input.provider,
      event_id: input.run_id,
      kind: "reconciliation",
      status: "processed",
      payment_id: input.payment_id,
      action: (input.result.classification as string) ?? null,
      payload: input.result as Record<string, unknown>,
      processed_at: new Date(),
    })
    return { id: row.id }
  }

  /** Look up one journal row by its dedup key. */
  async findEvent(
    provider: string,
    eventId: string
  ): Promise<PaymentEventRow | null> {
    // Medusa list methods are `list(filters, config)`: model properties go
    // in `filters` (top-level keys, no `where` wrapper — passing one throws
    // "not existing property"), while pagination belongs to `config`.
    const rows = await this.listPaymentEvents(
      { provider, event_id: eventId },
      { take: 1 }
    )
    return (rows[0] as PaymentEventRow | undefined) ?? null
  }
}

/**
 * Normalize any thrown value into a bounded, secret-free string.
 *
 * Exported (not private) so unit tests can assert the redaction and
 * truncation guarantees directly: error text persisted in the journal must
 * never carry key material and must stay bounded in size.
 */
export function truncateError(error: unknown): string {
  let message: string
  if (error instanceof Error) {
    message = error.message
  } else if (typeof error === "string") {
    message = error
  } else {
    try {
      message = JSON.stringify(error) ?? String(error)
    } catch {
      message = "unserializable error"
    }
  }
  // Strip anything that looks like a credential material before storing.
  message = message.replace(/(sk|pk|whsec|key|secret|bearer)[-_][A-Za-z0-9_-]+/gi, "[redacted]")
  if (message.length > MAX_ERROR_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...[truncated]`
  }
  return message
}

export default PaymentEventsService
