import { listCollections } from "@lib/data/collections"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * A quiet index of every live collection, for shoppers who browse by line
 * rather than by campaign.
 */
const CollectionsIndex = async () => {
  const { collections } = await listCollections({
    fields: "id, handle, title",
  })

  if (!collections?.length) {
    return null
  }

  return (
    <section className="border-t border-mist">
      <div className="content-container py-16 small:py-20">
        <div className="mb-8 flex items-baseline justify-between border-b border-mist pb-5">
          <h2 className="font-display text-display-md text-ink">
            All collections
          </h2>
          <LocalizedClientLink
            href="/store"
            className="text-[13px] font-medium tracking-[0.04em] text-accent hover:text-accent-strong transition-colors duration-fast ease-lux-out link-underline"
          >
            Shop everything
          </LocalizedClientLink>
        </div>
        <ul className="grid grid-cols-1 xsmall:grid-cols-2 small:grid-cols-3 gap-x-8 gap-y-0">
          {collections.map((collection) => (
            <li key={collection.id} className="border-b border-mist">
              <LocalizedClientLink
                href={`/collections/${collection.handle}`}
                className="block py-5 font-display text-[1.25rem] text-ink hover:text-accent transition-colors duration-fast ease-lux-out"
              >
                {collection.title}
              </LocalizedClientLink>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default CollectionsIndex
