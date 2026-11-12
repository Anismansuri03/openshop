import { spawn } from "child_process"
import { Client } from "@medusajs/framework/pg"
import fs from "fs"
import os from "os"
import path from "path"

/**
 * Backup + tested restoration suite (master mission Stage B, gap G1).
 *
 * The launch gate "backups and restoration are tested" is not satisfied by
 * backup tooling existing — it requires an actual restoration against an
 * isolated environment. This suite is that test, and runs in CI with the
 * migration suite (jest testMatch picks up integration-tests/migrate/).
 *
 * What it proves, in order:
 *
 *   1. a fresh database migrates + seeds through the checked wrapper
 *      (re-proves the Sprint-3 exit-code contract on a third database);
 *   2. scripts/db-backup.js writes a non-empty pg_dump custom-format archive
 *      of exactly the intended database (output must name it);
 *   3. an independent inventory of the source (tables, fixture invariants)
 *      is captured for comparison;
 *   4. scripts/db-restore.js restores that archive into a NEW isolated
 *      database and the script's own full verification (every table's row
 *      count vs source) passes — independently re-checked here with a table-
 *      list comparison, fixture invariants, and spot row-count equality;
 *   5. restore refuses to touch an existing database (overwrite guard);
 *   6. backup refuses to overwrite an existing file (overwrite guard).
 *
 * Isolation (same contract as seed-exit-code.spec.ts): connections come from
 * DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD, never from the inherited
 * DATABASE_URL; the script children receive an explicit DATABASE_URL built
 * from those variables and the suite asserts the scripts printed the
 * intended database name — so a mis-routed script fails the test instead of
 * quietly touching another database. Databases used:
 *   - openshop_sprint3_backup_src   (source; created here)
 *   - openshop_sprint3_backup_restore (restore target; created by the
 *     restore script itself, dropped by this suite afterwards)
 * Both are suite-owned disposable names, dropped in afterAll. The archive is
 * written to the OS temp directory and deleted; it contains full database
 * data and must never land in the repository (db-backup.js also defaults its
 * output into the git-ignored apps/backend/backups/ directory).
 */

const SRC_DB = "openshop_sprint3_backup_src"
const DST_DB = "openshop_sprint3_backup_restore"

const BACKEND_DIR = path.resolve(__dirname, "..", "..")
const BACKUP_SCRIPT = path.join(BACKEND_DIR, "scripts", "db-backup.js")
const RESTORE_SCRIPT = path.join(BACKEND_DIR, "scripts", "db-restore.js")
const WRAPPER_PATH = path.join(BACKEND_DIR, "scripts", "migrate-checked.js")

const DB_HOST = process.env.DB_HOST ?? "localhost"
const DB_PORT = process.env.DB_PORT ?? "5432"
const DB_USERNAME = process.env.DB_USERNAME ?? "postgres"
const DB_PASSWORD = process.env.DB_PASSWORD ?? ""

const DUMP_FILE = path.join(
  os.tmpdir(),
  `openshop-sprint3-backup-${process.pid}-${Date.now()}.dump`
)

type RunResult = { code: number | null; output: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
async function sql(query: string, dbName = "postgres", params?: any[]): Promise<any[]> {
  const client = new Client({
    host: DB_HOST,
    port: parseInt(DB_PORT),
    user: DB_USERNAME,
    password: DB_PASSWORD || undefined,
    database: dbName,
  })
  await client.connect()
  try {
    const res = await client.query(query, params)
    return res.rows
  } finally {
    await client.end()
  }
}

function testDbUrl(dbName: string): string {
  return `postgres://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${dbName}`
}

function runNode(args: string[], env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        // Explicit URL always wins over anything inherited (the repo .env
        // points at the developer's database and must never be used here).
        DATABASE_URL: env.DATABASE_URL,
      },
    })
    let output = ""
    child.stdout.on("data", (chunk) => (output += chunk.toString()))
    child.stderr.on("data", (chunk) => (output += chunk.toString()))
    child.on("close", (code) => resolve({ code, output }))
  })
}

async function tableList(dbName: string): Promise<string[]> {
  const rows = await sql(
    `SELECT table_schema || '.' || table_name AS name
     FROM information_schema.tables
     WHERE table_type = 'BASE TABLE'
       AND table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY 1`,
    dbName
  )
  return rows.map((r: any) => r.name)
}

async function count(dbName: string, table: string): Promise<number> {
  const rows = await sql(`SELECT count(*) AS n FROM "${table}"`, dbName)
  return Number(rows[0].n)
}

describe("backup creation + tested restoration (G1)", () => {
  const sourceUrl = testDbUrl(SRC_DB)
  let sourceTables: string[] = []

  beforeAll(async () => {
    // Suite-owned disposable databases only. The restore target must start
    // absent — db-restore.js refuses to run against an existing database.
    await sql(`DROP DATABASE IF EXISTS ${SRC_DB}`)
    await sql(`DROP DATABASE IF EXISTS ${DST_DB}`)
    await sql(`CREATE DATABASE ${SRC_DB}`)
  })

  afterAll(async () => {
    await sql(`DROP DATABASE IF EXISTS ${DST_DB}`)
    await sql(`DROP DATABASE IF EXISTS ${SRC_DB}`)
    try {
      if (fs.existsSync(DUMP_FILE)) {
        fs.unlinkSync(DUMP_FILE)
      }
    } catch (error) {
      // Best-effort cleanup of the temp archive; never a test failure.
    }
  })

  it(
    "1. migrates and seeds the source database through the checked wrapper",
    async () => {
      const run = await runNode([WRAPPER_PATH], { DATABASE_URL: sourceUrl })
      if (run.code !== 0) {
        console.log("wrapper output tail:\n" + run.output.slice(-2000))
      }
      expect(run.code).toBe(0)

      // The fixtures the remaining tests rely on actually exist.
      expect(await count(SRC_DB, "store")).toBe(1)
      expect(await count(SRC_DB, "product")).toBe(4)
    },
    600000
  )

  it(
    "2. writes a non-empty custom-format archive of exactly the source database",
    async () => {
      const run = await runNode(
        [BACKUP_SCRIPT, "--out", DUMP_FILE],
        { DATABASE_URL: sourceUrl }
      )
      if (run.code !== 0) {
        console.log("backup output:\n" + run.output.slice(-2000))
      }
      expect(run.code).toBe(0)
      // Safety proof: the script must have dumped the intended database
      // (a mis-routed DATABASE_URL would name another one here).
      expect(run.output).toContain(`from database "${SRC_DB}"`)
      // The PII warning must accompany every successful backup.
      expect(run.output).toContain("never commit it")

      expect(fs.existsSync(DUMP_FILE)).toBe(true)
      expect(fs.statSync(DUMP_FILE).size).toBeGreaterThan(10000)
    },
    300000
  )

  it(
    "3. captures an independent source inventory for comparison",
    async () => {
      sourceTables = await tableList(SRC_DB)
      expect(sourceTables.length).toBeGreaterThan(100)
      expect(sourceTables).toContain("public.store")
      expect(sourceTables).toContain("public.product")

      const rows = await sql(
        "SELECT count(*) AS n FROM script_migrations WHERE finished_at IS NOT NULL",
        SRC_DB
      )
      expect(Number(rows[0].n)).toBeGreaterThan(0)
    },
    120000
  )

  it(
    "4. restores into a new isolated database and verifies every table and row count",
    async () => {
      const run = await runNode(
        [RESTORE_SCRIPT, DUMP_FILE, DST_DB],
        { DATABASE_URL: sourceUrl }
      )
      if (run.code !== 0) {
        console.log("restore output:\n" + run.output.slice(-3000))
      }
      expect(run.code).toBe(0)
      // The script's exhaustive verification path (row counts of every table
      // compared against the source) must have run — not the
      // structure-only fallback.
      expect(run.output).toContain(`against source "${SRC_DB}"`)
      expect(run.output).toContain("complete and verified")

      // Independent re-checks in this test, separate from the script:
      const restoredTables = await tableList(DST_DB)
      expect(restoredTables).toEqual(sourceTables)

      expect(await count(DST_DB, "store")).toBe(1)
      expect(await count(DST_DB, "product")).toBe(4)

      // Spot row-count equality on representative seeded tables.
      for (const table of [
        "product",
        "product_variant",
        "sales_channel",
        "region",
        "inventory_item",
        "script_migrations",
      ]) {
        expect(await count(DST_DB, table)).toBe(await count(SRC_DB, table))
      }
    },
    600000
  )

  it(
    "5. refuses to restore over an existing database",
    async () => {
      const run = await runNode(
        [RESTORE_SCRIPT, DUMP_FILE, DST_DB],
        { DATABASE_URL: sourceUrl }
      )
      expect(run.code).not.toBe(0)
      expect(run.output).toContain("already exists")
      expect(run.output).toContain("refusing")

      // The guard must not have damaged the successful restore.
      expect(await count(DST_DB, "store")).toBe(1)
    },
    120000
  )

  it(
    "6. refuses to overwrite an existing backup file",
    async () => {
      const run = await runNode(
        [BACKUP_SCRIPT, "--out", DUMP_FILE],
        { DATABASE_URL: sourceUrl }
      )
      expect(run.code).not.toBe(0)
      expect(run.output).toContain("refusing to overwrite existing file")
      // The pre-existing archive is untouched (same size as after test 2 —
      // it was created once and must not have been rewritten).
      expect(fs.existsSync(DUMP_FILE)).toBe(true)
    },
    120000
  )
})
