import SimPaymentProvider from "./services/sim-payment-provider"

/**
 * OpenShop payment simulator module (G2).
 *
 * Loaded by Medusa's payment module provider loader via the entry in
 * `medusa-config.ts`:
 *
 *   modules: [
 *     {
 *       resolve: "@medusajs/medusa/payment",
 *       options: {
 *         providers: [
 *           { resolve: "./src/modules/dev-payment", id: "default" },
 *           { resolve: "./src/modules/sim-payment", id: "default" },
 *         ],
 *       },
 *     },
 *   ]
 *
 * The loader `require()`s this file and reads the default export's
 * `services` array, registers the class under the container key
 * `pp_sim-payment_default`, and calls its static `validateOptions`
 * eagerly at boot — which is where the production safeguard fires.
 *
 * This module is a development/testing tool. It never contacts a network,
 * never settles real money, and refuses to boot in production unless
 * ENABLE_SIM_PAYMENT_PROVIDER=true acknowledges that payments are simulated.
 */
export default {
  services: [SimPaymentProvider],
}
