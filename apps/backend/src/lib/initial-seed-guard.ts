/**
 * Guard for the non-idempotent initial data seed.
 *
 * Medusa's migration-script runner tracks finished scripts in the
 * `script_migrations` table, so a routine `medusa db:migrate` does not
 * re-run the seed. This guard covers the paths that bypass that tracking:
 *
 *  1. manual re-execution (`medusa exec ./src/migration-scripts/initial-data-seed.ts`),
 *  2. a previous run that crashed after creating some rows but before the
 *     script recorded `finished_at` (the runner deliberately retries those).
 *
 * In both cases the choice is binary: skip when the seed is clearly complete,
 * or stop with an actionable error when it is partial — never re-create rows,
 * because duplicates here corrupt stores, regions and catalogues.
 */

export type SeedCounts = {
  stores: number
  regions: number
  products: number
}

export type SeedDecision = {
  action: "run" | "skip" | "stop"
  reason: string
}

/** The seed always creates 4 starter products with fixed handles. */
export const STARTER_PRODUCT_COUNT = 4

export function evaluateInitialSeedGuard(counts: SeedCounts): SeedDecision {
  if (counts.stores === 0 && counts.regions === 0) {
    return {
      action: "run",
      reason: "no store or region present; the database has never been seeded",
    }
  }

  if (counts.stores === 0) {
    return {
      action: "stop",
      reason:
        `inconsistent state: ${counts.regions} region(s) exist but no store does; ` +
        "re-running would duplicate regions. Use a fresh database.",
    }
  }

  const looksComplete = counts.regions >= 1 && counts.products >= STARTER_PRODUCT_COUNT

  if (looksComplete) {
    return {
      action: "skip",
      reason: `initial data already present (stores=${counts.stores}, regions=${counts.regions}, products=${counts.products})`,
    }
  }

  return {
    action: "stop",
    reason:
      `partial initial seed detected (stores=${counts.stores}, regions=${counts.regions}, ` +
      `products=${counts.products}); re-running would duplicate core commerce data. ` +
      "Use a fresh database, or remove the partially seeded rows before seeding again.",
  }
}
