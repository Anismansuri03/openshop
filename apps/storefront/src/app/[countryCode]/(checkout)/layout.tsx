import LocalizedClientLink from "@modules/common/components/localized-client-link"
import ChevronDown from "@modules/common/icons/chevron-down"
import MedusaCTA from "@modules/layout/components/medusa-cta"

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="w-full bg-paper relative small:min-h-screen">
      <div className="h-16 bg-paper border-b border-mist">
        <nav className="flex h-full items-center content-container justify-between">
          <LocalizedClientLink
            href="/cart"
            className="text-[12px] tracking-[0.14em] uppercase text-ink flex items-center gap-x-2 flex-1 basis-0 hover:text-accent transition-colors duration-fast ease-lux-out"
            data-testid="back-to-cart-link"
          >
            <ChevronDown className="rotate-90" size={16} />
            <span className="mt-px hidden small:block text-graphite">
              Back to shopping cart
            </span>
            <span className="mt-px block small:hidden text-graphite">
              Back
            </span>
          </LocalizedClientLink>
          <LocalizedClientLink
            href="/"
            className="font-display text-[1.125rem] tracking-[0.04em] uppercase text-ink hover:text-accent transition-colors duration-fast ease-lux-out"
            data-testid="store-link"
          >
            Maison
          </LocalizedClientLink>
          <div className="flex-1 basis-0" />
        </nav>
      </div>
      <div className="relative" data-testid="checkout-container">{children}</div>
      <div className="py-4 w-full flex items-center justify-center">
        <MedusaCTA />
      </div>
    </div>
  )
}
