import { listCategories } from "@lib/data/categories"
import { listCollections } from "@lib/data/collections"
import { Text, clx } from "@modules/common/components/ui"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import MedusaCTA from "@modules/layout/components/medusa-cta"

const columnLabelClass =
  "text-[11px] uppercase tracking-[0.2em] text-subtle"
const columnLinkClass = "text-[13px] text-graphite hover:text-accent transition-colors duration-fast ease-lux-out"

export default async function Footer() {
  const { collections } = await listCollections({
    fields: "*products",
  })
  const productCategories = await listCategories()

  return (
    <footer className="border-t border-mist w-full bg-paper">
      <div className="content-container flex flex-col w-full">
        <div className="grid grid-cols-1 small:grid-cols-12 gap-x-10 gap-y-14 py-16 small:py-24">
          <div className="small:col-span-5 flex flex-col items-start gap-y-5">
            <LocalizedClientLink
              href="/"
              className="font-display text-[1.5rem] leading-none uppercase tracking-[0.28em] pl-[0.28em] text-ink"
            >
              Maison
            </LocalizedClientLink>
            <p className="text-[13px] leading-6 text-graphite max-w-[32ch]">
              Considered clothing, cut to last — everyday pieces made to be
              worn, repaired, and kept.
            </p>
          </div>
          <div className="small:col-span-7 text-small-regular gap-x-12 gap-y-10 grid grid-cols-2 small:grid-cols-3">
            {productCategories && productCategories?.length > 0 && (
              <div className="flex flex-col gap-y-4">
                <span className={columnLabelClass}>Categories</span>
                <ul
                  className="grid grid-cols-1 gap-y-2.5"
                  data-testid="footer-categories"
                >
                  {productCategories?.slice(0, 6).map((c) => {
                    if (c.parent_category) {
                      return
                    }

                    const children =
                      c.category_children?.map((child) => ({
                        name: child.name,
                        handle: child.handle,
                        id: child.id,
                      })) || null

                    return (
                      <li className="flex flex-col gap-y-2.5" key={c.id}>
                        <LocalizedClientLink
                          className={clx(
                            columnLinkClass,
                            children && "font-medium text-ink"
                          )}
                          href={`/categories/${c.handle}`}
                          data-testid="category-link"
                        >
                          {c.name}
                        </LocalizedClientLink>
                        {children && (
                          <ul className="grid grid-cols-1 ml-3 gap-y-2.5">
                            {children &&
                              children.map((child) => (
                                <li key={child.id}>
                                  <LocalizedClientLink
                                    className={columnLinkClass}
                                    href={`/categories/${child.handle}`}
                                    data-testid="category-link"
                                  >
                                    {child.name}
                                  </LocalizedClientLink>
                                </li>
                              ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {collections && collections.length > 0 && (
              <div className="flex flex-col gap-y-4">
                <span className={columnLabelClass}>Collections</span>
                <ul
                  className={clx(
                    "grid grid-cols-1 gap-y-2.5 text-graphite",
                    {
                      "grid-cols-2": (collections?.length || 0) > 3,
                    }
                  )}
                >
                  {collections?.slice(0, 6).map((c) => (
                    <li key={c.id}>
                      <LocalizedClientLink
                        className={columnLinkClass}
                        href={`/collections/${c.handle}`}
                      >
                        {c.title}
                      </LocalizedClientLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-y-4">
              <span className={columnLabelClass}>Maison</span>
              <ul className="grid grid-cols-1 gap-y-2.5">
                <li>
                  <LocalizedClientLink className={columnLinkClass} href="/store">
                    Shop
                  </LocalizedClientLink>
                </li>
                <li>
                  <LocalizedClientLink
                    className={columnLinkClass}
                    href="/account"
                  >
                    Account
                  </LocalizedClientLink>
                </li>
                <li>
                  <LocalizedClientLink className={columnLinkClass} href="/cart">
                    Cart
                  </LocalizedClientLink>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="flex w-full mb-10 justify-between items-center border-t border-mist pt-8 text-subtle">
          <Text className="txt-compact-small">
            © {new Date().getFullYear()} Maison. All rights reserved.
          </Text>
          <MedusaCTA />
        </div>
      </div>
    </footer>
  )
}
