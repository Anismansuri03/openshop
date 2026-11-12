import { signSimPayload } from "./webhook-signature"

/**
 * Deterministic fixtures for simulated provider webhook deliveries (G2).
 *
 * Tests use these to reproduce every webhook scenario — valid, duplicate,
 * delayed, out-of-order, invalid signature, replay — offline, without
 * credentials, with predictable event identifiers.
 */

export type SimEventType =
  | "sim.payment_intent.succeeded"
  | "sim.payment_intent.amount_captured"
  | "sim.payment_intent.payment_failed"
  | "sim.payment_intent.canceled"
  | "sim.payment_intent.processing"

export type BuildSimEventOptions = {
  type: SimEventType
  /**
   * Medusa payment session id the event applies to (models Stripe's
   * `intent.metadata.session_id` — the field every official provider uses
   * to re-associate an external event with a local session).
   */
  sessionId: string
  /** Provider reference (the sim_intent_* id of that session). */
  reference: string
  /** Predictable event id; defaults to `sim_evt_<reference>_<sequence>`. */
  eventId?: string
  sequence?: number
  amountMinor?: number
  currencyCode?: string
  failureReason?: string
}

/** Build the JSON body of a simulated provider webhook event. */
export function buildSimEvent(options: BuildSimEventOptions): {
  id: string
  type: SimEventType
  data: {
    session_id: string
    reference: string
    amount_minor?: number
    currency_code?: string
    failure_reason?: string
  }
  simulated: true
} {
  const sequence = options.sequence ?? 1
  return {
    id: options.eventId ?? `sim_evt_${options.reference}_${sequence}`,
    type: options.type,
    data: {
      session_id: options.sessionId,
      reference: options.reference,
      ...(options.amountMinor !== undefined
        ? { amount_minor: options.amountMinor }
        : {}),
      ...(options.currencyCode !== undefined
        ? { currency_code: options.currencyCode }
        : {}),
      ...(options.failureReason !== undefined
        ? { failure_reason: options.failureReason }
        : {}),
    },
    simulated: true,
  }
}

/** Serialize an event exactly as it would appear on the wire. */
export function serializeSimEvent(event: unknown): string {
  return JSON.stringify(event)
}

/**
 * Produce the headers a signed simulated delivery carries: the raw body is
 * signed with the shared secret, Stripe-style.
 */
export function simWebhookHeaders(
  rawBody: string,
  webhookSecret: string,
  timestampSeconds?: number
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-sim-signature": signSimPayload(rawBody, webhookSecret, timestampSeconds),
  }
}
