/**
 * Static brand statement band — editorial copy about the house, no product
 * or inventory claims.
 */
const BrandStatement = () => {
  return (
    <section className="bg-ink text-paper">
      <div className="content-container py-20 small:py-28">
        <div className="flex max-w-[52rem] flex-col items-start gap-y-6">
          <p className="text-[11px] uppercase tracking-[0.24em] text-paper/60">
            The house
          </p>
          <p className="font-display text-[1.75rem] leading-[1.25] small:text-[2.25rem] small:leading-[1.2]">
            We make clothes for the long wardrobe — pieces chosen for cloth,
            cut, and the way they age.
          </p>
        </div>
      </div>
    </section>
  )
}

export default BrandStatement
