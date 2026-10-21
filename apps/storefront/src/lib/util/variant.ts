import { HttpTypes } from "@medusajs/types"
import { isEqual } from "lodash"

export type SelectedOptions = Record<string, string | undefined>

/**
 * Flattens a variant's options into an option-id keyed map so selections can
 * be compared regardless of option order.
 */
export const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"] | undefined
): Record<string, string> => {
  return variantOptions?.reduce((acc: Record<string, string>, varopt) => {
    if (varopt.option_id) acc[varopt.option_id] = varopt.value
    return acc
  }, {}) ?? {}
}

/**
 * Finds the variant whose options exactly match the current selection.
 * Returns undefined when the selection is incomplete or matches nothing —
 * callers must never treat a partial selection as a sellable variant.
 */
export const findVariantByOptions = (
  variants: HttpTypes.StoreProductVariant[] | null | undefined,
  selected: SelectedOptions
): HttpTypes.StoreProductVariant | undefined => {
  if (!variants || variants.length === 0) {
    return undefined
  }

  return variants.find((v) => {
    const variantOptions = optionsAsKeymap(v.options)
    return isEqual(variantOptions, selected)
  })
}

/**
 * Whether the selected variant can be added to the cart, based on the
 * inventory signals the Store API returns. Unmanaged inventory and
 * backorder-enabled variants are always sellable; managed inventory
 * requires a positive quantity.
 */
export const isVariantInStock = (
  variant: HttpTypes.StoreProductVariant | undefined
): boolean => {
  if (!variant) {
    return false
  }

  if (!variant.manage_inventory) {
    return true
  }

  if (variant.allow_backorder) {
    return true
  }

  return (variant.inventory_quantity ?? 0) > 0
}
