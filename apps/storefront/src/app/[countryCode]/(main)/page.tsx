import { Metadata } from "next"

import FeaturedProducts from "@modules/home/components/featured-products"
import Hero from "@modules/home/components/hero"
import Campaign from "@modules/home/components/campaign"
import BrandStatement from "@modules/home/components/brand-statement"
import CollectionsIndex from "@modules/home/components/collections-index"
import { listCollections } from "@lib/data/collections"
import { getRegion } from "@lib/data/regions"

export const metadata: Metadata = {
  title: "Clothing, cut to last",
  description:
    "A house of considered garments — everyday pieces cut for long wear.",
}

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const params = await props.params

  const { countryCode } = params

  const region = await getRegion(countryCode)

  const { collections } = await listCollections({
    fields: "id, handle, title",
  })

  if (!collections || !region) {
    return null
  }

  const featured = collections[0]

  return (
    <>
      <Hero featured={featured} />
      <div className="py-10 small:py-14">
        <ul className="flex flex-col">
          <FeaturedProducts collections={collections} region={region} />
        </ul>
      </div>
      <Campaign countryCode={countryCode} />
      <BrandStatement />
      <CollectionsIndex />
    </>
  )
}
