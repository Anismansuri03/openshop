/**
 * Read-only sanity report for the local environment. Prints catalog, stock,
 * region, and order summaries as counts/invariants, then exits non-zero if a
 * core invariant fails (suitable for a quick post-setup check).
 *
 *   npx medusa exec ./src/scripts/verify-local-state.ts
 *
 * Never prints secrets: no .env values, no API key values, no JWT/cookie
 * material, no user emails — only counts, statuses, and display metadata.
 *
 * Invariants checked (FAIL sets exit code 1):
 *   1. At least one published product exists.
 *   2. Every inventory item has an inventory level (sellability requires it).
 *   3. At least one region with a shipping option exists.
 * Realistic-stock is reported as WARN (not FAIL) if any level exceeds 10000.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

type LevelRow = {
  id: string
  inventory_item_id: string
  stocked_quantity?: unknown
  raw_stocked_quantity?: { value?: string }
}

/** Handles number | numeric string | BigNumber-shaped raw values. */
function qtyOf(level: LevelRow): number {
  const raw = level.raw_stocked_quantity?.value
  if (raw !== undefined) {
    return Number(raw)
  }
  return Number(level.stocked_quantity ?? 0)
}

export default async function verifyLocalState({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const failures: string[] = []
  const warnings: string[] = []

  async function fetch<T>(entity: string, fields: string[]): Promise<T[]> {
    try {
      const { data } = await query.graph({ entity, fields })
      return data as T[]
    } catch (e) {
      failures.push(`could not query "${entity}": ${(e as Error).message}`)
      return []
    }
  }

  // ---- Catalog ----
  const products = await fetch<{ id: string; status: string }>("product", [
    "id",
    "status",
  ])
  const published = products.filter((p) => p.status === "published").length
  logger.info(`[catalog] products=${products.length} published=${published}`)
  if (published < 1) {
    failures.push("no published products found")
  }

  // ---- Stock ----
  const items = await fetch<{ id: string }>("inventory_item", ["id"])
  const levels = await fetch<LevelRow>("inventory_level", [
    "id",
    "inventory_item_id",
    "stocked_quantity",
    "raw_stocked_quantity",
  ])
  const itemsWithLevel = new Set(levels.map((l) => l.inventory_item_id))
  const unstockedItems = items.filter((i) => !itemsWithLevel.has(i.id)).length
  const quantities = levels.map(qtyOf)
  const min = quantities.length ? Math.min(...quantities) : 0
  const max = quantities.length ? Math.max(...quantities) : 0
  const avg = quantities.length
    ? Math.round(quantities.reduce((a, b) => a + b, 0) / quantities.length)
    : 0
  logger.info(
    `[stock] items=${items.length} levels=${levels.length} min=${min} avg=${avg} max=${max} unstocked=${unstockedItems}`
  )
  if (unstockedItems > 0) {
    failures.push(`${unstockedItems} inventory item(s) have no level`)
  }
  if (max > 10000) {
    warnings.push(
      `max stocked_quantity=${max} looks unrealistic — run seed-demo-inventory-levels.ts`
    )
  }

  // ---- Region + shipping ----
  const regions = await fetch<{ id: string; name: string; currency_code: string }>(
    "region",
    ["id", "name", "currency_code"]
  )
  const shippingOptions = await fetch<{ id: string; name: string }>(
    "shipping_option",
    ["id", "name"]
  )
  logger.info(
    `[region] regions=${regions.length} shipping_options=${shippingOptions.length}`
  )
  if (regions.length < 1) {
    failures.push("no region configured")
  }
  if (shippingOptions.length < 1) {
    failures.push("no shipping options configured")
  }

  // ---- Orders (test/E2E orders — display metadata only) ----
  const orders = await fetch<{
    display_id: number
    status: string
    currency_code: string
    created_at: Date
  }>("order", ["display_id", "status", "currency_code", "created_at"])
  logger.info(`[orders] count=${orders.length}`)
  for (const o of orders) {
    logger.info(
      `  order #${o.display_id} status=${o.status} currency=${o.currency_code} created=${new Date(o.created_at).toISOString()}`
    )
  }

  // ---- Accounts (count only — never identities) ----
  const users = await fetch<{ id: string }>("user", ["id"])
  logger.info(`[accounts] users=${users.length}`)

  // ---- Verdict ----
  for (const w of warnings) {
    logger.warn(`WARN: ${w}`)
  }
  if (failures.length) {
    for (const f of failures) {
      logger.error(`FAIL: ${f}`)
    }
    process.exitCode = 1
    logger.error("verify-local-state: FAILED")
    return
  }
  logger.info("verify-local-state: all invariants OK")
}
