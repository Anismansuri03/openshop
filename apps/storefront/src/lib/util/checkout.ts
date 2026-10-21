import { HttpTypes } from "@medusajs/types"

export type CheckoutStep = "address" | "delivery" | "payment"

/**
 * Determines which checkout step the shopper should land on, based only on
 * server-provided cart state. An incomplete address or missing email always
 * routes back to "address"; a cart with no shipping methods routes to
 * "delivery"; everything else proceeds to "payment".
 */
export function getCheckoutStep(cart: HttpTypes.StoreCart): CheckoutStep {
  if (!cart?.shipping_address?.address_1 || !cart.email) {
    return "address"
  } else if (!cart?.shipping_methods?.length) {
    return "delivery"
  } else {
    return "payment"
  }
}
