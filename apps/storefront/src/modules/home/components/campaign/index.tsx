import { listCollections } from "@lib/data/collections"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import Image from "next/image"
import InteractiveLink from "@modules/common/components/interactive-link"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * Editorial campaign band built from real catalog data only: each campaign
 * pairs a live collection with its first priced product image. No invented
 * imagery or copy about stock.
 */
const Campaign = async ({ countryCode }: { countryCode: string }) => {
  const region = await getRegion(countryCode)
  const { collections } = await listCollections({
    fields: "id, handle, title",
    limit: "2",
  })

  if (!region || !collections?.length) {
    return null
  }

  const campaigns = await Promise.all(
    collections.slice(0, 2).map(async (collection) => {
      const {
        response: { products },
      } = await listProducts({
        regionId: region.id,
        queryParams: {
          collection_id: collection.id,
          fields: "*variants.calculated_price",
          limit: 1,
        },
      })

      const product = products?.[0]
      const image =
        product?.thumbnail ||
        product?.images?.[0]?.url ||
        product?.variants?.[0]?.images?.[0]?.url ||
        null

      return { collection, image, product }
    })
  )

  const visible = campaigns.filter((c) => c.image)

  if (!visible.length) {
    return null
  }

  return (
    <section className="border-t border-mist">
      <div className="content-container py-16 small:py-24">
        <div className="grid grid-cols-1 gap-x-8 gap-y-14 small:grid-cols-2">
          {visible.map(({ collection, image, product }) => (
            <article key={collection.id} className="group flex flex-col gap-y-6">
              <LocalizedClientLink
                href={`/collections/${collection.handle}`}
                className="relative block w-full overflow-hidden bg-surface aspect-[4/5]"
              >
                {image && (
                  <Image
                    src={image}
                    alt={product?.title || collection.title}
                    fill
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    className="object-cover object-center motion-safe:transition-transform motion-safe:duration-slow motion-safe:ease-lux-out motion-safe:group-hover:scale-[1.03]"
                    draggable={false}
                  />
                )}
              </LocalizedClientLink>
              <div className="flex flex-col items-start gap-y-3">
                <h3 className="font-display text-display-md text-ink">
                  {collection.title}
                </h3>
                <InteractiveLink href={`/collections/${collection.handle}`}>
                  Explore the collection
                </InteractiveLink>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Campaign
