import InteractiveLink from "@modules/common/components/interactive-link"

const EmptyCartMessage = () => {
  return (
    <div
      className="py-24 px-2 flex flex-col justify-center items-start"
      data-testid="empty-cart-message"
    >
      <h1 className="font-display text-display-lg text-ink">Cart</h1>
      <p className="mt-4 mb-6 max-w-[32rem] text-[15px] leading-7 text-graphite">
        You don&apos;t have anything in your cart. Let&apos;s change that, use
        the link below to start browsing our products.
      </p>
      <div>
        <InteractiveLink href="/store">Explore products</InteractiveLink>
      </div>
    </div>
  )
}

export default EmptyCartMessage
