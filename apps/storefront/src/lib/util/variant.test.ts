import { describe, expect, it } from "vitest"
import {
  findVariantByOptions,
  isVariantInStock,
  optionsAsKeymap,
  SelectedOptions,
} from "./variant"
import { HttpTypes } from "@medusajs/types"

type VariantOption = HttpTypes.StoreProductVariant["options"]

const optionPair = (color: string, size: string): VariantOption =>
  [
    { id: "ov-1", option_id: "opt-color", value: color },
    { id: "ov-2", option_id: "opt-size", value: size },
  ] as VariantOption

const makeVariant = (
  overrides: Partial<HttpTypes.StoreProductVariant> = {}
): HttpTypes.StoreProductVariant =>
  ({
    id: "variant-1",
    manage_inventory: false,
    allow_backorder: false,
    inventory_quantity: 0,
    options: optionPair("Noir", "M"),
    ...overrides,
  }) as HttpTypes.StoreProductVariant

describe("optionsAsKeymap", () => {
  it("flattens variant options into an option-id keyed map", () => {
    const variant = makeVariant()
    const keymap = optionsAsKeymap(variant.options)
    expect(keymap).toEqual({
      "opt-color": "Noir",
      "opt-size": "M",
    })
  })

  it("returns an empty map when options are missing", () => {
    expect(optionsAsKeymap(undefined)).toEqual({})
  })
})

describe("findVariantByOptions", () => {
  const variants = [
    makeVariant({ id: "v-noir-m" }),
    makeVariant({
      id: "v-noir-l",
      options: optionPair("Noir", "L"),
    }),
    makeVariant({
      id: "v-ivory-m",
      options: optionPair("Ivory", "M"),
    }),
  ]

  it("finds the variant matching the exact selection", () => {
    const selected: SelectedOptions = {
      "opt-color": "Noir",
      "opt-size": "L",
    }
    const found = findVariantByOptions(variants, selected)
    expect(found?.id).toBe("v-noir-l")
  })

  it("returns undefined for a partial selection", () => {
    const selected: SelectedOptions = { "opt-color": "Noir" }
    expect(findVariantByOptions(variants, selected)).toBeUndefined()
  })

  it("returns undefined when no variant matches", () => {
    const selected: SelectedOptions = {
      "opt-color": "Bleu",
      "opt-size": "XL",
    }
    expect(findVariantByOptions(variants, selected)).toBeUndefined()
  })

  it("returns undefined for empty or missing variants", () => {
    const selected: SelectedOptions = {
      "opt-color": "Noir",
      "opt-size": "M",
    }
    expect(findVariantByOptions([], selected)).toBeUndefined()
    expect(findVariantByOptions(null, selected)).toBeUndefined()
    expect(findVariantByOptions(undefined, selected)).toBeUndefined()
  })

  it("matches regardless of option order in the selection", () => {
    const selected: SelectedOptions = {
      "opt-size": "M",
      "opt-color": "Noir",
    }
    const found = findVariantByOptions(variants, selected)
    expect(found?.id).toBe("v-noir-m")
  })
})

describe("isVariantInStock", () => {
  it("is false when no variant is selected", () => {
    expect(isVariantInStock(undefined)).toBe(false)
  })

  it("is true when inventory is not managed", () => {
    const variant = makeVariant({ manage_inventory: false, inventory_quantity: 0 })
    expect(isVariantInStock(variant)).toBe(true)
  })

  it("is true when backorders are allowed", () => {
    const variant = makeVariant({
      manage_inventory: true,
      allow_backorder: true,
      inventory_quantity: 0,
    })
    expect(isVariantInStock(variant)).toBe(true)
  })

  it("is true when managed inventory is positive", () => {
    const variant = makeVariant({
      manage_inventory: true,
      allow_backorder: false,
      inventory_quantity: 3,
    })
    expect(isVariantInStock(variant)).toBe(true)
  })

  it("is false when managed inventory is zero and backorders are not allowed", () => {
    const variant = makeVariant({
      manage_inventory: true,
      allow_backorder: false,
      inventory_quantity: 0,
    })
    expect(isVariantInStock(variant)).toBe(false)
  })

  it("is false when managed inventory quantity is missing", () => {
    const variant = makeVariant({
      manage_inventory: true,
      allow_backorder: false,
      inventory_quantity: undefined,
    })
    expect(isVariantInStock(variant)).toBe(false)
  })
})
