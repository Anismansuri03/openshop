"use client"

import { addToCart } from "@lib/data/cart"
import { useIntersection } from "@lib/hooks/use-in-view"
import {
  findVariantByOptions,
  isVariantInStock,
  SelectedOptions,
} from "@lib/util/variant"
import { HttpTypes } from "@medusajs/types"
import Divider from "@modules/common/components/divider"
import { Button } from "@modules/common/components/ui"
import OptionSelect from "@modules/products/components/product-actions/option-select"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import MobileActions from "./mobile-actions"
import ProductPrice from "../product-price"

type ProductActionsProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  disabled?: boolean
}

export default function ProductActions({
  product,
  disabled,
}: ProductActionsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [options, setOptions] = useState<SelectedOptions>({})
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const countryCode = useParams().countryCode as string

  // If there is only 1 variant, preselect the options
  useEffect(() => {
    if (product.variants?.length === 1 && product.variants[0].options) {
      const preselect = product.variants[0].options.reduce(
        (acc: SelectedOptions, varopt) => {
          if (varopt.option_id) acc[varopt.option_id] = varopt.value
          return acc
        },
        {}
      )
      setOptions(preselect)
    }
  }, [product.variants])

  const selectedVariant = useMemo(
    () => findVariantByOptions(product.variants, options),
    [product.variants, options]
  )

  // update the options when a variant is selected
  const setOptionValue = (optionId: string, value: string) => {
    setOptions((prev) => ({
      ...prev,
      [optionId]: value,
    }))
  }

  // check if the selected options produce a valid variant
  const isValidVariant = useMemo(
    () => Boolean(findVariantByOptions(product.variants, options)),
    [product.variants, options]
  )

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const value = isValidVariant ? selectedVariant?.id : null

    if (params.get("v_id") === value) {
      return
    }

    if (value) {
      params.set("v_id", value)
    } else {
      params.delete("v_id")
    }

    router.replace(pathname + "?" + params.toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant, isValidVariant])

  const inStock = useMemo(
    () => isVariantInStock(selectedVariant),
    [selectedVariant]
  )

  const inventoryNote = useMemo(() => {
    if (!selectedVariant || !isValidVariant) {
      return null
    }
    if (!inStock) {
      return "Out of stock"
    }
    if (selectedVariant.manage_inventory && !selectedVariant.allow_backorder) {
      const qty = selectedVariant.inventory_quantity ?? 0
      return qty <= 10 ? `Only ${qty} left` : "In stock"
    }
    return "In stock"
  }, [selectedVariant, inStock, isValidVariant])

  const actionsRef = useRef<HTMLDivElement>(null)

  const inView = useIntersection(actionsRef, "0px")

  // add the selected variant to the cart
  const handleAddToCart = async () => {
    if (!selectedVariant?.id) return

    setIsAdding(true)
    setAddError(null)

    try {
      await addToCart({
        variantId: selectedVariant.id,
        quantity: 1,
        countryCode,
      })
    } catch (error) {
      setAddError(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't add this item to the cart. Please try again."
      )
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-y-2" ref={actionsRef}>
      <div>
        {(product.variants?.length ?? 0) > 1 && (
          <div className="flex flex-col gap-y-4">
            {(product.options || []).map((option) => {
              return (
                <div key={option.id}>
                  <OptionSelect
                    option={option}
                    current={options[option.id]}
                    updateOption={setOptionValue}
                    title={option.title ?? ""}
                    data-testid="product-options"
                    disabled={!!disabled || isAdding}
                  />
                </div>
              )
            })}
            <Divider />
          </div>
        )}
      </div>

      <ProductPrice product={product} variant={selectedVariant} />

      {inventoryNote && (
        <p
          className="text-[12px] tracking-[0.06em] uppercase"
          data-testid="inventory-note"
        >
          <span
            className={
              inStock ? "text-graphite" : "text-error"
            }
          >
            {inventoryNote}
          </span>
        </p>
      )}

      <Button
        onClick={handleAddToCart}
        disabled={
          !inStock ||
          !selectedVariant ||
          !!disabled ||
          isAdding ||
          !isValidVariant
        }
        variant="primary"
        className="w-full h-12 min-h-[48px]"
        isLoading={isAdding}
        data-testid="add-product-button"
      >
        {!selectedVariant
          ? "Select variant"
          : !inStock || !isValidVariant
          ? "Out of stock"
          : "Add to cart"}
      </Button>
      {addError && (
        <p
          className="mt-2 text-[13px] leading-5 text-error"
          role="alert"
          data-testid="add-to-cart-error"
        >
          {addError}
        </p>
      )}
      <MobileActions
        product={product}
        variant={selectedVariant}
        options={options}
        updateOptions={setOptionValue}
        inStock={inStock}
        handleAddToCart={handleAddToCart}
        isAdding={isAdding}
        show={!inView}
        optionsDisabled={!!disabled || isAdding}
      />
    </div>
  )
}
