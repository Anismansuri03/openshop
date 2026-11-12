import DevPaymentProvider from "./services/dev-payment-provider"

/**
 * OpenShop development payment module (G5).
 *
 * Loaded by Medusa's payment module provider loader via the entry in
 * `medusa-config.ts`:
 *
 *   modules: [
 *     {
 *       resolve: "@medusajs/medusa/payment",
 *       options: {
 *         providers: [{ resolve: "./src/modules/dev-payment", id: "default" }],
 *       },
 *     },
 *   ]
 *
 * The loader `require()`s this file and reads the default export's
 * `services` array (see @medusajs/modules-sdk dist/loaders/
 * module-provider-loader.js), then registers the class under the container
 * key `pp_dev-payment_default` and calls its static `validateOptions`
 * eagerly at boot — which is where the production safeguard fires.
 */
export default {
  services: [DevPaymentProvider],
}
