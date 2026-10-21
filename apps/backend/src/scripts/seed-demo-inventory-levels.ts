/**
 * Demo stock maintenance — gives every inventory item a realistic stock level
 * at the existing warehouse. Companion to seed-demo-products.ts: the
 * create-products workflow attaches an inventory item to every managed
 * variant, but no level is created for items that appear after the initial
 * migration seed ran, so the Store API reports inventory_quantity = 0 and
 * every demo PDP shows "Out of stock". The initial migration seed also
 * creates one-time placeholder quantities (1,000,000) that this script
 * normalizes on the first run against a fresh database.
 *
 *   npx medusa exec ./src/scripts/seed-demo-inventory-levels.ts
 *
 * Configuration (optional, plain integers/flags — never secrets):
 *   DEMO_STOCK_QUANTITY  flat quantity for every level (default 10)
 *   DEMO_STOCK_VARIED    set to 1/true/yes for a deterministic 5-50 range
 *                        per item, derived from the item's SKU (stable
 *                        across runs: the same SKU always maps to the same
 *                        quantity). Overrides DEMO_STOCK_QUANTITY.
 *
 * Idempotent by construction: levels are created only when missing, updated
 * only when the current quantity differs from the target, and skipped
 * otherwise. Variant-to-item links are never touched — no duplicates are
 * possible.
 */
import {
  createInventoryLevelsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

const DEFAULT_FLAT_QUANTITY = 10
const VARIED_MIN = 5
const VARIED_MAX = 50

type ItemRow = { id: string; sku: string | null }
type LevelRow = {
  id: string
  inventory_item_id: string
  location_id: string
  stocked_quantity?: unknown
  raw_stocked_quantity?: { value?: string }
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value ?? "").toLowerCase())
}

function flatQuantity(): number | null {
  const raw = process.env.DEMO_STOCK_QUANTITY
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_FLAT_QUANTITY
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
    return null
  }
  return parsed
}

/** FNV-1a 32-bit — stable across runs and machines. */
function stableHash(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function variedQuantity(item: ItemRow): number {
  const seed = item.sku && item.sku.length ? item.sku : item.id
  const span = VARIED_MAX - VARIED_MIN + 1
  return VARIED_MIN + (stableHash(seed) % span)
}

/** Handles number | numeric string | BigNumber-shaped raw values. */
function qtyOf(level: LevelRow): number {
  const raw = level.raw_stocked_quantity?.value
  if (raw !== undefined) {
    return Number(raw)
  }
  return Number(level.stocked_quantity ?? 0)
}

export default async function seedDemoInventoryLevels({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const flat = flatQuantity()
  if (flat === null) {
    logger.error(
      `DEMO_STOCK_QUANTITY must be an integer between 1 and 100000 (got "${process.env.DEMO_STOCK_QUANTITY}")`
    )
    process.exitCode = 1
    return
  }
  const varied = isTruthy(process.env.DEMO_STOCK_VARIED)
  const describe = varied
    ? `varied ${VARIED_MIN}-${VARIED_MAX} (deterministic per SKU)`
    : `flat ${flat}`
  logger.info(`Demo stock target: ${describe}`)

  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  })
  const stockLocation = stockLocations[0]
  if (!stockLocation) {
    logger.error("No stock location found. Run the initial data seed first.")
    process.exitCode = 1
    return
  }

  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
  })
  const { data: levels } = await query.graph({
    entity: "inventory_level",
    fields: ["id", "inventory_item_id", "location_id", "stocked_quantity", "raw_stocked_quantity"],
  })

  const targetFor = (item: ItemRow): number =>
    varied ? variedQuantity(item) : flat

  const itemById = new Map(items.map((item) => [item.id, item]))
  const levelsByItem = new Map<string, LevelRow[]>()
  for (const level of levels) {
    const list = levelsByItem.get(level.inventory_item_id) ?? []
    list.push(level)
    levelsByItem.set(level.inventory_item_id, list)
  }

  const toCreate: {
    inventory_item_id: string
    location_id: string
    stocked_quantity: number
  }[] = []
  const toUpdate: {
    id: string
    inventory_item_id: string
    location_id: string
    stocked_quantity: number
  }[] = []
  let skipped = 0

  for (const item of items) {
    const target = targetFor(item)
    const existing = levelsByItem.get(item.id)

    if (!existing || existing.length === 0) {
      toCreate.push({
        inventory_item_id: item.id,
        location_id: stockLocation.id,
        stocked_quantity: target,
      })
      continue
    }

    for (const level of existing) {
      if (qtyOf(level) === target) {
        skipped += 1
        continue
      }
      toUpdate.push({
        id: level.id,
        inventory_item_id: level.inventory_item_id,
        location_id: level.location_id,
        stocked_quantity: target,
      })
    }
  }

  logger.info(
    `[stock] items=${items.length} levels=${levels.length} -> create=${toCreate.length} update=${toUpdate.length} already-ok=${skipped}`
  )

  if (toCreate.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: toCreate },
    })
  }
  if (toUpdate.length) {
    await updateInventoryLevelsWorkflow(container).run({
      input: { updates: toUpdate },
    })
  }

  if (!toCreate.length && !toUpdate.length) {
    logger.info("Every inventory level already matches the target. Nothing to do.")
    return
  }
  logger.info("Finished seeding inventory levels.")
}
