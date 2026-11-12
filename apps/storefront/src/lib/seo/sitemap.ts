import type { MetadataRoute } from "next"

/**
 * Sitemap generation (master mission G11).
 *
 * Two halves, kept separate so the URL logic is unit-testable without a
 * backend:
 *
 * - `buildSitemap` — pure. Emits ONLY whitelisted public route patterns:
 *     /{cc}                      homepage per routable country
 *     /{cc}/store                catalogue listing
 *     /{cc}/products/{handle}    product pages
 *     /{cc}/collections/{handle} collection pages
 *     /{cc}/categories/{path}    product-category pages
 *   Admin, auth, cart, checkout, account, order, verify-account and API
 *   routes are never generated. A Set guarantees no duplicate URL, and
 *   products whose `status` says they are not published are skipped even if
 *   an API response ever contains them (the store API already restricts
 *   itself to publicly visible products — this is defence in depth).
 *
 * - `fetchSitemapData` — reads the PUBLIC catalogue through the same
 *   publishable-key store endpoints the storefront itself uses (no admin
 *   API, no elevated credentials, no auth headers). Every section fails
 *   independently: if the backend is unreachable the sitemap still emits
 *   the static routes (country homepages + /store) instead of erroring, so
 *   a catalogue outage can never take down sitemap.xml/robots.txt.
 *
 * Categories are fetched flat with their parent reference and the URL path
 * is derived from the parent chain, matching the `[...category]` route
 * (`/{cc}/categories/{parent}/{child}`). Internal or inactive categories are
 * skipped together with their subtrees.
 */

export type SitemapProduct = { handle: string; status?: string }
export type SitemapCollection = { handle: string }
export type SitemapCategory = {
  handle: string
  path: string[]
  is_internal?: boolean
  is_active?: boolean
}

export type SitemapData = {
  countries: string[]
  products: SitemapProduct[]
  collections: SitemapCollection[]
  categories: SitemapCategory[]
}

export type FetchSitemapDataOptions = {
  backendUrl: string
  publishableKey: string | undefined
  defaultCountry: string
  fetchImpl?: typeof fetch
}

const PAGE_SIZE = 100
/** Safety cap: 10 pages x 100 = 1000 items per section (sitemap limits are 50k URLs). */
const MAX_PAGES = 10

function warn(section: string, detail: string): void {
  // Section + status/error text only — never headers, keys or URLs with
  // credentials (this endpoint carries none).
  console.warn(`[sitemap] ${section} unavailable (${detail}); emitting partial sitemap`)
}

export function buildSitemap(
  baseUrl: string,
  data: SitemapData
): MetadataRoute.Sitemap {
  const base = baseUrl.replace(/\/+$/, "")
  const seen = new Set<string>()
  const entries: MetadataRoute.Sitemap = []

  const add = (path: string) => {
    const url = `${base}${path}`
    if (!seen.has(url)) {
      seen.add(url)
      entries.push({ url })
    }
  }

  // Array.from (not spread): the storefront tsconfig targets ES5 without
  // downlevelIteration, which forbids spreading a Set.
  const countries = Array.from(
    new Set(
      data.countries
        .map((c) => (c ?? "").trim().toLowerCase())
        .filter((c) => /^[a-z]{2}$/.test(c))
    )
  ).sort()

  for (const country of countries) {
    add(`/${country}`)
    add(`/${country}/store`)

    for (const product of data.products) {
      if (!product?.handle) {
        continue
      }
      // Never index anything that is not explicitly published.
      if (product.status && product.status !== "published") {
        continue
      }
      add(`/${country}/products/${encodeURIComponent(product.handle)}`)
    }

    for (const collection of data.collections) {
      if (!collection?.handle) {
        continue
      }
      add(`/${country}/collections/${encodeURIComponent(collection.handle)}`)
    }

    for (const category of data.categories) {
      if (category.is_internal || category.is_active === false) {
        continue
      }
      if (!category.path?.length || category.path.some((s) => !s)) {
        continue
      }
      add(
        `/${country}/categories/${category.path
          .map((segment) => encodeURIComponent(segment))
          .join("/")}`
      )
    }
  }

  return entries
}

type StoreCategory = {
  id: string
  handle: string
  parent_category?: { id: string } | null
  is_internal?: boolean
  is_active?: boolean
}

function buildCategoryPaths(items: StoreCategory[]): SitemapCategory[] {
  const byId = new Map(items.map((c) => [c.id, c]))
  const out: SitemapCategory[] = []

  for (const item of items) {
    if (!item.handle || item.is_internal || item.is_active === false) {
      continue
    }
    // Walk parent links; guard against pathological cycles by dropping the
    // category (absent from a sitemap is safe, a wrong URL is not).
    const path: string[] = [item.handle]
    const visited = new Set<string>([item.id])
    let parentId = item.parent_category?.id
    let cycle = false
    while (parentId) {
      if (visited.has(parentId)) {
        cycle = true
        break
      }
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent?.handle) {
        cycle = true
        break
      }
      path.unshift(parent.handle)
      parentId = parent.parent_category?.id
    }
    if (cycle || path.length > 50) {
      continue
    }
    out.push({
      handle: item.handle,
      path,
      is_internal: item.is_internal,
      is_active: item.is_active,
    })
  }
  return out
}

export async function fetchSitemapData(
  options: FetchSitemapDataOptions
): Promise<SitemapData> {
  const { backendUrl, publishableKey, defaultCountry } = options
  const fetchImpl = options.fetchImpl ?? fetch

  const defaultCountryCode = (defaultCountry || "dk").trim().toLowerCase()
  const data: SitemapData = {
    countries: /^[a-z]{2}$/.test(defaultCountryCode) ? [defaultCountryCode] : ["dk"],
    products: [],
    collections: [],
    categories: [],
  }

  if (!backendUrl) {
    warn("all catalogue sections", "NEXT_PUBLIC_MEDUSA_BACKEND_URL not set")
    return data
  }

  const headers: Record<string, string> = {
    ...(publishableKey ? { "x-publishable-api-key": publishableKey } : {}),
  }

  const getJson = async (path: string): Promise<Record<string, unknown>> => {
    const res = await fetchImpl(`${backendUrl}${path}`, { headers })
    if (!res.ok) {
      throw new Error(`status ${res.status}`)
    }
    return (await res.json()) as Record<string, unknown>
  }

  /** Paginated list fetch; stops on count, page cap, or a page adding nothing new. */
  const listAll = async (
    path: string,
    rootKey: string
  ): Promise<Record<string, unknown>[]> => {
    const items: Record<string, unknown>[] = []
    const seenIds = new Set<string>()
    for (let page = 0; page < MAX_PAGES; page++) {
      const separator = path.includes("?") ? "&" : "?"
      const json = await getJson(
        `${path}${separator}limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      )
      const chunk = (json[rootKey] ?? []) as Record<string, unknown>[]
      const before = items.length
      for (const entry of chunk) {
        const id = typeof entry.id === "string" ? entry.id : JSON.stringify(entry)
        if (seenIds.has(id)) {
          continue
        }
        seenIds.add(id)
        items.push(entry)
      }
      const count = typeof json.count === "number" ? json.count : items.length
      if (items.length >= count || items.length === before) {
        break
      }
    }
    return items
  }

  // Countries: every country of every region is a routable storefront prefix
  // (the middleware resolves them exactly like this).
  try {
    const json = await getJson("/store/regions")
    const regions = (json.regions ?? []) as Array<{
      countries?: Array<{ iso_2?: string }>
    }>
    const countries = new Set<string>()
    for (const region of regions) {
      for (const country of region.countries ?? []) {
        if (country.iso_2) {
          countries.add(country.iso_2.toLowerCase())
        }
      }
    }
    if (countries.size > 0) {
      data.countries = Array.from(countries)
    } else {
      warn("regions", "no countries returned")
    }
  } catch (error) {
    warn("regions", error instanceof Error ? error.message : "request failed")
  }

  // Products: the store API exposes only publicly visible products for the
  // publishable key's scope; `+status` additionally pulls the status field so
  // the builder can double-check publication state.
  try {
    const products = await listAll("/store/products?fields=%2Bstatus", "products")
    data.products = products.map((p) => ({
      handle: typeof p.handle === "string" ? p.handle : "",
      status: typeof p.status === "string" ? p.status : undefined,
    })).filter((p) => p.handle)
  } catch (error) {
    warn("products", error instanceof Error ? error.message : "request failed")
  }

  try {
    const collections = await listAll("/store/collections", "collections")
    data.collections = collections.map((c) => ({
      handle: typeof c.handle === "string" ? c.handle : "",
    })).filter((c) => c.handle)
  } catch (error) {
    warn("collections", error instanceof Error ? error.message : "request failed")
  }

  try {
    const categories = await listAll(
      "/store/product-categories?fields=*parent_category",
      "product_categories"
    )
    data.categories = buildCategoryPaths(categories as unknown as StoreCategory[])
  } catch (error) {
    warn("categories", error instanceof Error ? error.message : "request failed")
  }

  return data
}
