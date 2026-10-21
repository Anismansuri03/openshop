import { ArrowUpRightMini } from "@medusajs/icons"
import LocalizedClientLink from "../localized-client-link"
type InteractiveLinkProps = {
  href: string
  children?: React.ReactNode
  onClick?: () => void
}

const InteractiveLink = ({
  href,
  children,
  onClick,
  ...props
}: InteractiveLinkProps) => {
  return (
    <LocalizedClientLink
      className="group inline-flex gap-x-1.5 items-center text-[13px] font-medium tracking-[0.04em] text-accent hover:text-accent-strong transition-colors duration-fast ease-lux-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      href={href}
      onClick={onClick}
      {...props}
    >
      <span>{children}</span>
      <ArrowUpRightMini
        className="motion-safe:transition-transform motion-safe:duration-base motion-safe:ease-lux-out motion-safe:group-hover:rotate-45"
        color="currentColor"
      />
    </LocalizedClientLink>
  )
}

export default InteractiveLink
