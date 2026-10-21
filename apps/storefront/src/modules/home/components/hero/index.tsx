import { Heading } from "@modules/common/components/ui"
import InteractiveLink from "@modules/common/components/interactive-link"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

type HeroProps = {
  featured?: {
    title: string
    handle: string
  } | null
}

const Hero = ({ featured }: HeroProps) => {
  return (
    <section className="relative w-full border-b border-mist bg-surface">
      <div className="content-container relative min-h-[72vh] flex flex-col justify-end pt-24 pb-14 small:pb-20">
        <div className="hero-reveal flex max-w-[48rem] flex-col items-start gap-y-7">
          <Heading level="h1" className="text-display-2xl text-ink">
            Considered clothing, cut to last.
          </Heading>
          <p className="max-w-[42ch] text-[15px] leading-7 text-graphite">
            Everyday pieces in honest cloth — made to be worn, repaired, and
            kept.
          </p>
          <div className="hero-reveal-late flex flex-wrap items-center gap-x-8 gap-y-5 pt-2">
            <LocalizedClientLink
              href="/store"
              className="inline-flex h-12 items-center justify-center bg-ink px-7 text-[15px] font-medium tracking-[0.02em] text-paper transition-colors duration-fast ease-lux-out hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Shop the collection
            </LocalizedClientLink>
            {featured && (
              <InteractiveLink href={`/collections/${featured.handle}`}>
                Featuring {featured.title}
              </InteractiveLink>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export default Hero
