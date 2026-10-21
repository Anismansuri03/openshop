"use client"

import { useEffect } from "react"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Button } from "@modules/common/components/ui"

export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="content-container flex min-h-[60vh] flex-col items-start justify-center gap-y-6 py-20">
      <h1 className="font-display text-display-lg text-ink">
        Checkout hit a snag.
      </h1>
      <p className="max-w-[42ch] text-[15px] leading-7 text-graphite">
        Something went wrong while loading checkout. Your cart is safe — you
        can try again, or return to it.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-2">
        <Button onClick={reset} size="large">
          Try again
        </Button>
        <LocalizedClientLink
          href="/cart"
          className="text-[13px] font-medium tracking-[0.04em] text-accent hover:text-accent-strong transition-colors duration-fast ease-lux-out link-underline"
        >
          Return to cart
        </LocalizedClientLink>
      </div>
    </div>
  )
}
