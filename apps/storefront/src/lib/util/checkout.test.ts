import { describe, expect, it } from "vitest"
import { getCheckoutStep } from "./checkout"
import { HttpTypes } from "@medusajs/types"

const makeAddress = (
  overrides: Partial<HttpTypes.StoreCartAddress> = {}
): HttpTypes.StoreCartAddress =>
  ({
    id: "addr-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address_1: "1 Rue de la Paix",
    city: "Paris",
    postal_code: "75002",
    country_code: "fr",
    ...overrides,
  }) as HttpTypes.StoreCartAddress

const makeCart = (
  overrides: Partial<HttpTypes.StoreCart> = {}
): HttpTypes.StoreCart =>
  ({
    id: "cart-1",
    email: "shopper@example.com",
    shipping_address: makeAddress(),
    shipping_methods: [],
    ...overrides,
  }) as HttpTypes.StoreCart

describe("getCheckoutStep", () => {
  it("returns address when the shipping address is missing", () => {
    const cart = makeCart({ shipping_address: undefined })
    expect(getCheckoutStep(cart)).toBe("address")
  })

  it("returns address when the address line is empty", () => {
    const cart = makeCart({
      shipping_address: makeAddress({ address_1: "" }),
    })
    expect(getCheckoutStep(cart)).toBe("address")
  })

  it("returns address when the email is missing", () => {
    const cart = makeCart({ email: undefined })
    expect(getCheckoutStep(cart)).toBe("address")
  })

  it("returns delivery when address and email are set but no shipping method exists", () => {
    const cart = makeCart({ shipping_methods: [] })
    expect(getCheckoutStep(cart)).toBe("delivery")
  })

  it("returns payment when a shipping method has been chosen", () => {
    const cart = makeCart({
      shipping_methods: [
        { id: "sm-1", shipping_option_id: "opt-1", name: "Standard" },
      ] as HttpTypes.StoreCartShippingMethod[],
    })
    expect(getCheckoutStep(cart)).toBe("payment")
  })
})
