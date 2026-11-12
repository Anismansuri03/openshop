import { processPaymentWorkflow } from "@medusajs/core-flows"
import type { MedusaRequest } from "@medusajs/framework/http"
import type { WebhookActionResult } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  PaymentActions,
} from "@medusajs/framework/utils"
import type PaymentEventsService from "../modules/payment-events/service"

/**
 * Provider-neutral payment webhook pipeline (G2).
 *
 * One path for every provider — the local simulator, the official Stripe
 * adapter, and any adapter added later — with the same five stages:
 *
 *   1. VERIFY   — the raw body must exist (bodyParser preserveRawBody in
 *                 src/api/middlewares.ts), then signature verification runs
 *                 inside the provider itself via
 *                 `paymentModule.getWebhookActionAndData` (Stripe checks
 *                 `stripe-signature`, the simulator checks `x-sim-signature`,
 *                 both over the exact raw bytes). Nothing is trusted before
 *                 this passes.
 *   2. EXTRACT  — the event id, read only AFTER verification succeeded, so
 *                 unauthenticated requests can never write journal rows.
 *   3. RESERVE  — an insert-first journal row keyed (provider, event_id) in
 *                 the payment-events module. Duplicates are acknowledged
 *                 without reprocessing; a concurrent delivery of the same
 *                 event gets 409 so exactly one request applies it.
 *   4. APPLY    — actions that change money state run the OFFICIAL
 *                 `processPaymentWorkflow` (payment creation, capture, cart
 *                 completion). Terminal/intermediate actions are recorded
 *                 and skipped — the exact guard list Medusa's own
 *                 payment-webhook subscriber uses.
 *   5. FINALIZE — the journal row becomes `processed`, or `failed`
 *                 (retryable by a later delivery) when applying threw.
 *
 * The invariant every status code here follows: NEVER acknowledge an event
 * the application did not process.
 *
 *   400  signature/structure/amount mismatch (rejected before any write)
 *   404  unknown provider
 *   409  the same event is being applied right now (retry later)
 *   500  missing raw body (config), journal unavailable, or apply failed —
 *        the provider will retry, and a failed journal row may be taken
 *        over and reprocessed (applying is idempotent)
 *   200  processed (or a verified duplicate that was already processed)
 *
 * This route deliberately does NOT emit `payment.webhook_received` for the
 * official subscriber to pick up: running the workflow synchronously here
 * is what lets failure map to 500 instead of an acknowledgment. The
 * workflow, guard list, and provider contract are still 100% official.
 */

export type WebhookHttpResult = {
  status: number
  body: Record<string, unknown>
}

/**
 * Actions that never run the processing workflow. Mirrors the official
 * payment-webhook subscriber: NOT_SUPPORTED (foreign/unknown events),
 * CANCELED/FAILED/REQUIRES_MORE (terminal or non-actionable here),
 * PENDING_AUTHORIZATION (deferred flow) and PENDING (intermediate event —
 * e.g. Stripe `processing` must not trigger cart completion).
 */
const NON_APPLIED_ACTIONS: ReadonlySet<string> = new Set<string>([
  PaymentActions.NOT_SUPPORTED,
  PaymentActions.CANCELED,
  PaymentActions.FAILED,
  PaymentActions.REQUIRES_MORE,
  PaymentActions.PENDING_AUTHORIZATION,
  PaymentActions.PENDING,
])

/**
 * Public webhook path segment -> payment module provider id. An explicit
 * allowlist: any other segment answers 404 without touching the container.
 */
const WEBHOOK_PROVIDERS: Readonly<Record<string, string>> = {
  "sim-payment": "pp_sim-payment_default",
  stripe: "pp_stripe_stripe",
}

/** Map a public webhook path segment to the payment provider id, or null. */
export function resolveWebhookProviderId(
  pathProvider: string
): string | null {
  return WEBHOOK_PROVIDERS[pathProvider] ?? null
}

/**
 * Map an error thrown by provider-side verification to an HTTP result.
 *
 * Provider contract for errors:
 *  - MedusaError UNAUTHORIZED   -> bad signature (400)
 *  - MedusaError INVALID_DATA   -> malformed event (400)
 *  - MedusaError UNEXPECTED_STATE -> amount/currency mismatch (400)
 *  - MedusaError NOT_FOUND      -> provider/session not found (404)
 *  - plain Error "Unable to retrieve the payment provider ..." -> the
 *    provider id is not registered, e.g. Stripe without STRIPE_API_KEY (404)
 *  - plain Error matching /constructWebhookEvent|signature/ -> the official
 *    Stripe adapter wraps signature failures via buildError() into a plain
 *    Error (400)
 *  - anything else              -> 500, never an acknowledgment
 */
export function mapProviderVerificationError(
  error: unknown
): WebhookHttpResult {
  const type = (error as { type?: string } | null)?.type
  if (
    type === MedusaError.Types.UNAUTHORIZED ||
    type === MedusaError.Types.INVALID_DATA ||
    type === MedusaError.Types.UNEXPECTED_STATE
  ) {
    const message =
      error instanceof Error ? error.message : "Webhook rejected."
    return { status: 400, body: { error: message } }
  }
  if (type === MedusaError.Types.NOT_FOUND) {
    return {
      status: 404,
      body: { error: "Payment provider or resource not found." },
    }
  }
  const message = error instanceof Error ? error.message : ""
  if (/Unable to retrieve the payment provider/i.test(message)) {
    return {
      status: 404,
      body: { error: "Payment provider is not registered." },
    }
  }
  if (/constructWebhookEvent|signature/i.test(message)) {
    // Official Stripe adapter: buildError() produces a plain Error whose
    // message names the failing verification step.
    return { status: 400, body: { error: "Webhook signature verification failed." } }
  }
  // Unknown failure class: generic body (no internals to the caller),
  // details go to the server log only.
  return {
    status: 500,
    body: { error: "Webhook verification failed; event not processed." },
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return "unserializable error"
  }
}

/**
 * Run the full verify -> extract -> reserve -> apply -> finalize pipeline
 * for one inbound provider webhook delivery.
 */
export async function handlePaymentWebhook(
  req: MedusaRequest,
  pathProvider: string
): Promise<WebhookHttpResult> {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  // Stage 1a: signatures are computed over exact bytes; without
  // preserveRawBody verification is impossible, so this is a hard server
  // configuration error (500), never a guessed acknowledgment.
  const rawBody = req.rawBody as Buffer | undefined
  if (!rawBody || !rawBody.length) {
    logger.error(
      `Webhook ${pathProvider}: raw body missing — the route must run with bodyParser preserveRawBody (src/api/middlewares.ts).`
    )
    return {
      status: 500,
      body: {
        error: "Webhook raw body unavailable (server configuration error).",
      },
    }
  }

  const providerId = resolveWebhookProviderId(pathProvider)
  if (!providerId) {
    return {
      status: 404,
      body: { error: `Unknown payment provider "${pathProvider}".` },
    }
  }

  const body = req.body
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      status: 400,
      body: { error: "Webhook body must be a JSON object." },
    }
  }

  // Stage 1b: provider-side signature verification + action derivation.
  let actionResult: WebhookActionResult
  try {
    const paymentModule = req.scope.resolve(Modules.PAYMENT)
    actionResult = await paymentModule.getWebhookActionAndData({
      provider: providerId,
      payload: {
        data: body as Record<string, unknown>,
        rawData: rawBody,
        headers: req.headers as unknown as Record<string, unknown>,
      },
    })
  } catch (error) {
    logger.error(
      `Webhook ${providerId}: rejected during verification: ${errorMessage(error)}`
    )
    return mapProviderVerificationError(error)
  }

  // Stage 2: event id, extracted only from a verified body.
  const eventId = (body as { id?: unknown }).id
  if (typeof eventId !== "string" || !eventId) {
    return {
      status: 400,
      body: { error: "Webhook event is missing an id." },
    }
  }

  // Stage 3: insert-first journal reservation (dedup barrier).
  const journal = req.scope.resolve(
    "paymentEvents"
  ) as PaymentEventsService
  let reservation
  try {
    reservation = await journal.reserveWebhookEvent({
      provider: providerId,
      event_id: eventId,
      payload: body as Record<string, unknown>,
    })
  } catch (error) {
    logger.error(
      `Webhook ${providerId}: journal reservation failed for event ${eventId}: ${errorMessage(error)}`
    )
    return {
      status: 500,
      body: { error: "Webhook journal unavailable; event not processed." },
    }
  }

  if (reservation.outcome === "duplicate") {
    // Already processed: acknowledge the replay without re-applying.
    return { status: 200, body: { received: true, duplicate: true } }
  }
  if (reservation.outcome === "in_flight") {
    // Another request is applying this exact event right now; ask the
    // provider to retry rather than double-processing.
    return {
      status: 409,
      body: {
        received: false,
        error: "Event is already being processed; retry later.",
      },
    }
  }

  // Stage 4: apply (or explicitly do not apply) the derived action.
  const shouldApply =
    !NON_APPLIED_ACTIONS.has(actionResult.action) &&
    !!actionResult.data?.session_id

  if (!shouldApply) {
    // Terminal/intermediate action, or an event without a session
    // association: recorded, matching the official subscriber which skips
    // these instead of running the workflow. Acknowledged because there is
    // deliberately nothing to process.
    try {
      await journal.markEventProcessed({
        id: reservation.id,
        action: actionResult.action,
      })
    } catch (error) {
      logger.error(
        `Webhook ${providerId}: event ${eventId} recorded without apply but journal finalize failed: ${errorMessage(error)}`
      )
    }
    return {
      status: 200,
      body: { received: true, action: actionResult.action },
    }
  }

  try {
    await processPaymentWorkflow(req.scope).run({ input: actionResult })
  } catch (error) {
    // Apply failed: journal the failure (a later delivery may take the
    // failed row over and retry) and DO NOT acknowledge (500 -> retry).
    try {
      await journal.markEventFailed({ id: reservation.id, error })
    } catch (journalError) {
      logger.error(
        `Webhook ${providerId}: could not mark event ${eventId} as failed: ${errorMessage(journalError)}`
      )
    }
    logger.error(
      `Webhook ${providerId}: apply failed for event ${eventId}: ${errorMessage(error)}`
    )
    return {
      status: 500,
      body: { error: "Webhook processing failed; event not acknowledged." },
    }
  }

  // Stage 5: finalize. The processing itself succeeded; if this journal
  // write fails, the row stays `processing` and is taken over after the
  // stale window. Re-applying is idempotent (official workflow branches are
  // guarded by payment/cart/order existence), so a delayed re-run is safe
  // and the event is never silently lost.
  try {
    await journal.markEventProcessed({
      id: reservation.id,
      action: actionResult.action,
    })
  } catch (error) {
    logger.error(
      `Webhook ${providerId}: event ${eventId} applied but journal finalize failed: ${errorMessage(error)}`
    )
  }

  return {
    status: 200,
    body: { received: true, action: actionResult.action },
  }
}
