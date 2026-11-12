import { randomUUID } from "crypto"
import type { MedusaRequest } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type PaymentEventsService from "../modules/payment-events/service"

/**
 * Payment reconciliation (G2): repeat-safe comparison of what Medusa holds
 * against what the payment provider reports — and nothing else.
 *
 * Invariants (see docs/G2_PAYMENT_TESTING.md):
 *  - READ-ONLY on payment state: the only provider method called is
 *    `getPaymentStatus` (the official provider contract method that maps a
 *    provider record to a status). No capture, no authorize, no refund —
 *    reconciliation can NEVER move money.
 *  - Every run is journaled in the payment-events module with its own run
 *    id, so running it 0, 1 or N times produces an auditable trail and
 *    identical comparisons (no hidden state is changed between runs).
 *  - Classification is a report, never an action: mismatches are surfaced
 *    for a human; nothing is auto-corrected.
 *
 * How the provider view is obtained: `PaymentModuleService` does not expose
 * `getPaymentStatus` publicly, but it holds the payment module's own
 * `paymentProviderService_` (declared on the class, assigned in its
 * constructor), whose `getStatus(providerId, input)` delegates to the
 * registered provider's `getPaymentStatus`. This is the module's official
 * provider-dispatch path (same object `getWebhookActionAndData` runs on),
 * reached structurally instead of a private import — no parallel provider
 * abstraction is introduced.
 */

export type ReconcileClassification =
  | "in_sync"
  | "status_mismatch"
  | "capture_mismatch"
  | "amount_mismatch"
  | "provider_error"

export type ReconcileReport = {
  run_id: string
  payment_id: string
  provider: string
  classification: ReconcileClassification
  local: {
    session_status: string | null
    payment_captured: boolean
    /** Normalized for exact comparison (string), never float math. */
    payment_amount: string | null
    session_amount: string | null
  }
  provider_view: {
    status: string | null
    error: string | null
  }
  details: string[]
  journal_id: string | null
  reconciled_at: string
}

/**
 * Pure classification — kept side-effect free so unit tests can drive every
 * branch directly.
 */
export function classifyReconcile(input: {
  localStatus: string | null
  providerStatus: string | null
  providerError?: string | null
  paymentCapturedAt: Date | string | null
  amountsDiffer: boolean
}): { classification: ReconcileClassification; details: string[] } {
  const details: string[] = []

  if (input.providerError) {
    details.push(`Provider status could not be read: ${input.providerError}`)
    return { classification: "provider_error", details }
  }

  const localStatus = input.localStatus ?? "(none)"
  const providerStatus = input.providerStatus ?? "(none)"

  if (input.amountsDiffer) {
    details.push(
      "Payment amount and payment-session amount differ locally " +
        "(exact string comparison of the persisted values)."
    )
    return { classification: "amount_mismatch", details }
  }

  const providerCaptured = providerStatus === "captured"
  const localCaptured =
    localStatus === "captured" ||
    input.paymentCapturedAt !== null

  if (providerCaptured && !input.paymentCapturedAt) {
    // The provider says the money is captured but Medusa has no capture
    // recorded on the payment — the most actionable class of drift
    // (e.g. captured in the provider dashboard).
    details.push(
      `Provider reports captured; local session status is "${localStatus}" ` +
        "and the payment has no captured_at timestamp."
    )
    return { classification: "capture_mismatch", details }
  }

  if (localStatus === "captured" && !input.paymentCapturedAt) {
    details.push(
      "Local session status is captured but the payment has no captured_at " +
        "timestamp (inconsistent local data)."
    )
    return { classification: "capture_mismatch", details }
  }

  if (localStatus !== providerStatus) {
    details.push(
      `Local session status "${localStatus}" does not match provider status ` +
        `"${providerStatus}".`
    )
    return { classification: "status_mismatch", details }
  }

  details.push(
    `In sync: session and provider both report "${localStatus}"` +
      (localCaptured ? ", capture recorded." : ".")
  )
  return { classification: "in_sync", details }
}

/**
 * Normalize any persisted amount representation into a string for EXACT
 * comparison. No arithmetic happens here and no floats are rounded — two
 * amounts are equal only if their serialized values are identical.
 */
function amountKey(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === "number" || typeof value === "string") {
    return String(value)
  }
  if (typeof value === "object") {
    const candidate = value as { value?: unknown; numeric?: unknown }
    if (candidate.value !== undefined) {
      return amountKey(candidate.value)
    }
    if (candidate.numeric !== undefined) {
      return amountKey(candidate.numeric)
    }
  }
  return String(value)
}

function truncate(message: string, max = 300): string {
  return message.length > max ? `${message.slice(0, max)}...` : message
}

/**
 * Reconcile one payment: load payment + its session, read the provider's
 * status through the payment module's provider service, classify, journal
 * the run, and return the report. Throws MedusaError NOT_FOUND when the
 * payment id does not exist.
 */
export async function reconcilePayment(
  req: MedusaRequest,
  paymentId: string
): Promise<ReconcileReport> {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const paymentModule = req.scope.resolve(Modules.PAYMENT)
  const journal = req.scope.resolve(
    "paymentEvents"
  ) as PaymentEventsService

  const payment = await paymentModule.retrievePayment(paymentId, {
    relations: ["payment_session"],
  })

  if (!payment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment ${paymentId} was found by id but resolved to nothing.`
    )
  }

  const session = payment.payment_session ?? null
  const providerId: string =
    session?.provider_id ?? payment.provider_id ?? "unknown"

  const runId = `rec_${randomUUID()}`
  const localStatus: string | null = session?.status ?? null
  const paymentCapturedAt = payment.captured_at ?? null

  let providerStatus: string | null = null
  let providerError: string | null = null
  if (!session) {
    providerError = "Payment has no payment session to reconcile against."
  } else {
    try {
      const moduleInternals = paymentModule as unknown as {
        paymentProviderService_: {
          getStatus(
            id: string,
            input: { data: Record<string, unknown> }
          ): Promise<{ status: string }>
        }
      }
      const providerResult =
        await moduleInternals.paymentProviderService_.getStatus(providerId, {
          data: (session.data as Record<string, unknown> | null) ?? {},
        })
      providerStatus = providerResult?.status ?? null
    } catch (error) {
      providerError = truncate(
        error instanceof Error ? error.message : String(error)
      )
      logger.warn(
        `Reconcile ${runId}: provider status read failed for ${providerId}/${paymentId}: ${providerError}`
      )
    }
  }

  const paymentAmountKey = amountKey(payment.amount)
  const sessionAmountKey = amountKey(session?.amount)
  const amountsDiffer =
    paymentAmountKey !== null &&
    sessionAmountKey !== null &&
    paymentAmountKey !== sessionAmountKey

  const { classification, details } = classifyReconcile({
    localStatus,
    providerStatus,
    providerError,
    paymentCapturedAt,
    amountsDiffer,
  })

  const report: ReconcileReport = {
    run_id: runId,
    payment_id: paymentId,
    provider: providerId,
    classification,
    local: {
      session_status: localStatus,
      payment_captured: !!paymentCapturedAt,
      payment_amount: paymentAmountKey,
      session_amount: sessionAmountKey,
    },
    provider_view: {
      status: providerStatus,
      error: providerError,
    },
    details,
    journal_id: null,
    reconciled_at: new Date().toISOString(),
  }

  // Journal every run (repeat-safe: a run only ever ADDS a journal row with
  // its own run id — it never touches payment state). A journaling failure
  // is reported in the response but does not hide the comparison result.
  try {
    const journalEntry = await journal.journalReconciliation({
      provider: providerId,
      run_id: runId,
      payment_id: paymentId,
      result: report as unknown as Record<string, unknown>,
    })
    report.journal_id = journalEntry.id
  } catch (error) {
    logger.error(
      `Reconcile ${runId}: journal write failed for ${paymentId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  return report
}
