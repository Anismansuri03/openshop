import { ArrowUpRightMini } from "@medusajs/icons"
import { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "404",
  description: "Something went wrong",
}

export default function NotFound() {
  return (
    <div className="flex flex-col gap-4 items-center justify-center min-h-[calc(100vh-64px)]">
      <h1 className="font-display text-display-lg text-ink">Page not found</h1>
      <p className="text-[15px] leading-7 text-graphite">
        The page you tried to access does not exist.
      </p>
      <Link className="flex gap-x-1 items-center group" href="/">
        <span className="text-[13px] font-medium tracking-[0.04em] text-accent hover:text-accent-strong transition-colors duration-fast ease-lux-out">
          Go to frontpage
        </span>
        <ArrowUpRightMini
          className="group-hover:rotate-45 ease-in-out duration-150"
          color="var(--accent, currentColor)"
        />
      </Link>
    </div>
  )
}
