"use client"

import { useEffect } from "react"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Button, Heading, Text } from "@modules/common/components/ui"

export default function MainError({
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
      <Heading level="h1" className="text-display-lg text-ink">
        Something went wrong.
      </Heading>
      <Text className="max-w-[42ch] text-graphite">
        An unexpected error occurred while loading this page. You can try
        again, or return to the store.
      </Text>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-2">
        <Button onClick={reset} size="large">
          Try again
        </Button>
        <LocalizedClientLink
          href="/"
          className="text-[13px] font-medium tracking-[0.04em] text-accent hover:text-accent-strong transition-colors duration-fast ease-lux-out link-underline"
        >
          Return to the store
        </LocalizedClientLink>
      </div>
    </div>
  )
}
