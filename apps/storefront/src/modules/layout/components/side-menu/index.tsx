"use client"

import useToggleState from "@lib/hooks/use-toggle-state"
import { Transition } from "@headlessui/react"
import { XMark } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { Locale } from "@lib/data/locales"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Text } from "@modules/common/components/ui"
import { Dialog } from "@headlessui/react"
import { Fragment, useEffect, useState } from "react"
import CountrySelect from "../country-select"
import LanguageSelect from "../language-select"

const shopLinks = [
  { name: "Store", href: "/store" },
  { name: "Shirts", href: "/categories/shirts" },
  { name: "Sweatshirts", href: "/categories/sweatshirts" },
  { name: "Pants", href: "/categories/pants" },
  { name: "Merch", href: "/categories/merch" },
]

const collectionLinks = [
  { name: "Summer Essentials", href: "/collections/summer-essentials" },
  { name: "Winter Layers", href: "/collections/winter-layers" },
  { name: "Everyday Basics", href: "/collections/everyday-basics" },
  { name: "Limited Run", href: "/collections/limited-run" },
]

const serviceLinks = [
  { name: "Account", href: "/account" },
  { name: "Cart", href: "/cart" },
]

type SideMenuProps = {
  regions: HttpTypes.StoreRegion[] | null
  locales: Locale[] | null
  currentLocale: string | null
}

const SideMenu = ({ regions, locales, currentLocale }: SideMenuProps) => {
  const [open, setOpen] = useState(false)
  const countryToggleState = useToggleState()
  const languageToggleState = useToggleState()

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [open])

  const close = () => setOpen(false)

  const menuLinkClass =
    "group flex min-h-[48px] items-center py-2 font-display text-[1.75rem] small:text-[2.25rem] leading-none text-ink hover:text-accent transition-colors duration-fast ease-lux-out"

  const sectionLabelClass =
    "mb-4 text-[11px] font-medium uppercase tracking-[0.32em] text-subtle"

  return (
    <div className="h-full flex items-center">
      <button
        type="button"
        data-testid="nav-menu-button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="relative flex min-h-[48px] min-w-[48px] items-center justify-center px-2 text-[13px] text-ink hover:text-accent transition-colors duration-fast ease-lux-out focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Menu
      </button>

      <Transition appear show={open} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-[70]"
          onClose={close}
        >
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div
              className="fixed inset-0 bg-ink/25 backdrop-blur-[2px]"
              data-testid="side-menu-backdrop"
              aria-hidden="true"
            />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <Transition.Child
              as={Fragment}
              enter="ease-lux-out duration-base motion-safe:transition-all"
              enterFrom="opacity-0 -translate-y-2"
              enterTo="opacity-100 translate-y-0"
              leave="ease-in duration-fast motion-safe:transition-all"
              leaveFrom="opacity-100 translate-y-0"
              leaveTo="opacity-0 -translate-y-2"
            >
              <Dialog.Panel
                className="min-h-full bg-paper text-ink"
                data-testid="nav-menu-popup"
              >
                <div className="content-container flex min-h-full flex-col pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-6 small:pt-8">
                  {/* top bar: wordmark + close */}
                  <div className="flex items-center justify-between border-b border-mist pb-5">
                    <Dialog.Title className="font-display text-[1rem] small:text-[1.125rem] uppercase tracking-[0.42em] text-ink">
                      Maison
                    </Dialog.Title>
                    <button
                      type="button"
                      data-testid="close-menu-button"
                      aria-label="Close menu"
                      onClick={close}
                      className="-m-2 flex min-h-[48px] min-w-[48px] items-center justify-center p-3 text-subtle hover:text-accent transition-colors duration-fast focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <XMark />
                    </button>
                  </div>

                  {/* editorial statement */}
                  <p className="hidden small:block max-w-xl py-8 font-display text-[1.5rem] leading-snug text-subtle">
                    Considered clothing, cut to last — everyday pieces made to
                    be worn, repaired, and kept.
                  </p>

                  {/* link grid */}
                  <div className="grid flex-1 gap-x-10 gap-y-10 py-8 small:grid-cols-3 small:py-10">
                    <nav aria-label="Shop">
                      <h2 className={sectionLabelClass}>Shop</h2>
                      <ul className="flex flex-col">
                        {shopLinks.map((link) => (
                          <li key={link.href}>
                            <LocalizedClientLink
                              href={link.href}
                              className={menuLinkClass}
                              onClick={close}
                              data-testid={`menu-${link.name.toLowerCase()}-link`}
                            >
                              {link.name}
                            </LocalizedClientLink>
                          </li>
                        ))}
                      </ul>
                    </nav>

                    <nav aria-label="Collections">
                      <h2 className={sectionLabelClass}>Collections</h2>
                      <ul className="flex flex-col">
                        {collectionLinks.map((link) => (
                          <li key={link.href}>
                            <LocalizedClientLink
                              href={link.href}
                              className={menuLinkClass}
                              onClick={close}
                              data-testid={`menu-${link.name
                                .toLowerCase()
                                .replace(/\s+/g, "-")}-link`}
                            >
                              {link.name}
                            </LocalizedClientLink>
                          </li>
                        ))}
                      </ul>
                    </nav>

                    <div className="flex flex-col justify-between gap-y-8">
                      <nav aria-label="Account">
                        <h2 className={sectionLabelClass}>Account</h2>
                        <ul className="flex flex-col">
                          {serviceLinks.map((link) => (
                            <li key={link.href}>
                              <LocalizedClientLink
                                href={link.href}
                                className={menuLinkClass}
                                onClick={close}
                                data-testid={`menu-${link.name.toLowerCase()}-link`}
                              >
                                {link.name}
                              </LocalizedClientLink>
                            </li>
                          ))}
                        </ul>
                      </nav>

                      <div className="flex flex-col gap-y-4">
                        {!!locales?.length && (
                          <div
                            className="flex min-h-[48px] items-center justify-between"
                            onMouseEnter={languageToggleState.open}
                            onMouseLeave={languageToggleState.close}
                          >
                            <LanguageSelect
                              toggleState={languageToggleState}
                              locales={locales}
                              currentLocale={currentLocale}
                            />
                          </div>
                        )}
                        {regions && (
                          <div
                            className="flex min-h-[48px] items-center justify-between"
                            onMouseEnter={countryToggleState.open}
                            onMouseLeave={countryToggleState.close}
                          >
                            <CountrySelect
                              toggleState={countryToggleState}
                              regions={regions}
                            />
                          </div>
                        )}
                        <Text className="txt-compact-small text-subtle">
                          © {new Date().getFullYear()} Maison. All rights
                          reserved.
                        </Text>
                      </div>
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </div>
  )
}

export default SideMenu
