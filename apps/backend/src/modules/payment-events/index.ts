import { Module } from "@medusajs/framework/utils"
import PaymentEventsService from "./service"

/**
 * Payment events module (G2): durable webhook dedup + reconciliation
 * journal, stored in the existing Medusa database.
 *
 * Registered in `medusa-config.ts` as:
 *
 *   modules: [
 *     { resolve: "./src/modules/payment-events" },
 *   ]
 *
 * `Module("paymentEvents", ...)` sets the service's joiner config
 * serviceName to "paymentEvents", which is what `transformModules` reads
 * to derive the registration key — so the service resolves from the
 * container as `resolve("paymentEvents")` and `medusa db:generate
 * paymentEvents` finds it by the same name.
 */
export default Module("paymentEvents", {
  service: PaymentEventsService,
})
