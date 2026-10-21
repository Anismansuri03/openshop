import { Suspense } from "react"

import { listLocales } from "@lib/data/locales"
import { getLocale } from "@lib/data/locale-actions"
import { listRegions } from "@lib/data/regions"
import { StoreRegion } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import Search from "@modules/layout/components/search"
import SideMenu from "@modules/layout/components/side-menu"

const navLinkClass =
  "text-[13px] text-ink hover:text-accent transition-colors duration-fast ease-lux-out"

export default async function Nav() {
  const [regions, locales, currentLocale] = await Promise.all([
    listRegions().then((regions: StoreRegion[]) => regions),
    listLocales(),
    getLocale(),
  ])

  return (
    <div className="sticky top-0 inset-x-0 z-50 group">
      <header className="relative h-16 small:h-20 mx-auto border-b border-mist bg-paper/90 backdrop-blur-md duration-base">
        <nav className="content-container flex items-center justify-between w-full h-full text-ink">
          <div className="flex-1 basis-0 h-full flex items-center gap-x-6">
            <div className="h-full">
              <SideMenu
                regions={regions}
                locales={locales}
                currentLocale={currentLocale}
              />
            </div>
            <LocalizedClientLink
              href="/store"
              className={`${navLinkClass} hidden small:inline-flex min-h-[48px] min-w-[48px] items-center justify-center`}
              data-testid="nav-shop-link"
            >
              Store
            </LocalizedClientLink>
          </div>

          <div className="flex items-center h-full">
            <LocalizedClientLink
              href="/"
              className="flex min-h-[48px] items-center font-display text-[1.0625rem] small:text-[1.25rem] uppercase tracking-[0.3em] pl-[0.3em] text-ink"
              data-testid="nav-store-link"
            >
              Maison
            </LocalizedClientLink>
          </div>

          <div className="flex items-center gap-x-5 small:gap-x-7 h-full flex-1 basis-0 justify-end">
            <Search />
            <div className="hidden small:flex items-center h-full">
              <LocalizedClientLink
                className={`${navLinkClass} flex min-h-[48px] items-center`}
                href="/account"
                data-testid="nav-account-link"
              >
                Account
              </LocalizedClientLink>
            </div>
            <Suspense
              fallback={
                <LocalizedClientLink
                  className={navLinkClass}
                  href="/cart"
                  data-testid="nav-cart-link"
                >
                  Cart (0)
                </LocalizedClientLink>
              }
            >
              <CartButton />
            </Suspense>
          </div>
        </nav>
      </header>
    </div>
  )
}
