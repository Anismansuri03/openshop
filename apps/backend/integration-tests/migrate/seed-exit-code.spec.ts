import { spawn } from "child_process"
import { Client } from "@medusajs/framework/pg"
import { MEDUSA_CLI_PATH } from "@medusajs/framework"
import path from "path"

/**
 * Regression suite for finding F3 (Sprint 2, PRODUCT_AUDIT.md §3 /
 * STAGE5_JOURNEY.md §F3): upstream @medusajs/medusa 2.21.2
 * (`commands/db/migrate.js`) forks `db:migrate:scripts` but discards its exit
 * code (the search variant right above it is checked), so a `medusa db:migrate`
 * run whose migration script throws prints the error and still exits 0 — a
 * broken seed looks green to CI and to scripts.
 *
 * Reproduced 2026-10-28 on a disposable database poisoned with a partial seed
 * (store row present, no regions — the state the initial-data-seed re-run
 * guard refuses to touch):
 *
 *   pnpm exec medusa db:migrate
 *     -> "Failed to run migration script ... initial-data-seed.ts" printed
 *     -> exit code 0            <-- the bug
 *     -> script_migrations row left with finished_at NULL
 *
 * The fix is repo-side: `scripts/migrate-checked.js` (npm script
 * `db:migrate`) propagates the upstream exit code and then verifies in the
 * database that every `script_migrations` row has `finished_at` set. This
 * suite pins the wrapper contract:
 *
 *   1. clean-install migration        -> exit 0, no unfinished scripts
 *   2. failed migration script        -> exit non-zero (even though the raw
 *                                       upstream CLI exits 0 — logged, not
 *                                       asserted, so an upstream fix does not
 *                                       break this suite)
 *
 * Isolation: the database URL is built from the DB_* environment variables
 * (same contract as @medusajs/test-utils — defaults localhost/5432/postgres),
 * never from DATABASE_URL, so the developer's configured database is never
 * touched. The database (`openshop_sprint3_migrate_exit_check`) is dropped in
 * afterAll.
 */

const TEST_DB = "openshop_sprint3_migrate_exit_check"
const BACKEND_DIR = path.resolve(__dirname, "..", "..")
const CLI_PATH = path.resolve(MEDUSA_CLI_PATH, "..", "..", "cli.js")
const WRAPPER_PATH = path.join(BACKEND_DIR, "scripts", "migrate-checked.js")

const DB_HOST = process.env.DB_HOST ?? "localhost"
const DB_PORT = process.env.DB_PORT ?? "5432"
const DB_USERNAME = process.env.DB_USERNAME ?? "postgres"
const DB_PASSWORD = process.env.DB_PASSWORD ?? ""

function testDbUrl(dbName: string): string {
  return `postgres://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${dbName}`
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function sql(query: string, dbName = "postgres"): Promise<any[]> {
  const client = new Client({
    host: DB_HOST,
    port: parseInt(DB_PORT),
    user: DB_USERNAME,
    password: DB_PASSWORD || undefined,
    database: dbName,
  })
  await client.connect()
  try {
    const res = await client.query(query)
    return res.rows
  } finally {
    await client.end()
  }
}

async function recreateTestDb(): Promise<void> {
  await sql(`DROP DATABASE IF EXISTS ${TEST_DB}`)
  await sql(`CREATE DATABASE ${TEST_DB}`)
}

type RunResult = { code: number | null; output: string }

function runNode(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        // The disposable target always wins over any inherited DATABASE_URL
        // (.env points at the developer's database and must never be used).
        DATABASE_URL: testDbUrl(TEST_DB),
      },
    })
    let output = ""
    child.stdout.on("data", (chunk) => (output += chunk.toString()))
    child.stderr.on("data", (chunk) => (output += chunk.toString()))
    child.on("close", (code) => resolve({ code, output }))
  })
}

function runCli(extraArgs: string[] = []): Promise<RunResult> {
  return runNode([CLI_PATH, "db:migrate", ...extraArgs])
}

function runWrapper(extraArgs: string[] = []): Promise<RunResult> {
  return runNode([WRAPPER_PATH, ...extraArgs])
}

async function unfinishedScripts(): Promise<string[]> {
  const rows = await sql(
    "SELECT script_name FROM script_migrations WHERE finished_at IS NULL ORDER BY script_name",
    TEST_DB
  )
  return rows.map((r: any) => r.script_name)
}

describe("db:migrate exit codes (F3 regression)", () => {
  afterAll(async () => {
    await sql(`DROP DATABASE IF EXISTS ${TEST_DB}`)
  })

  it(
    "exits 0 on a successful clean-install migration",
    async () => {
      await recreateTestDb()

      const run = await runWrapper()
      if (run.code !== 0) {
        // Surface the tail for diagnosis when this fails.
        console.log("wrapper output tail:\n" + run.output.slice(-2000))
      }
      expect(run.code).toBe(0)

      // The seed must have finished, not merely run.
      expect(await unfinishedScripts()).toEqual([])
    },
    600000
  )

  it(
    "exits non-zero when a migration script fails, even though the raw upstream CLI exits 0",
    async () => {
      await recreateTestDb()

      // 1. Migrations without scripts, then poison the database with the
      //    partial-seed state the initial-data-seed guard refuses to touch
      //    (a store exists, no regions). This is a safe, supported way to
      //    make the seed fail deterministically.
      const skip = await runCli(["--skip-scripts"])
      expect(skip.code).toBe(0)
      await sql(
        "INSERT INTO \"store\" (id, name, created_at, updated_at) " +
          "VALUES ('store_01M619REGRESSION000000', 'Partial seed (F3 test)', now(), now())",
        TEST_DB
      )

      // 2. Document the upstream behaviour: the raw CLI prints the seed error
      //    and exits 0 (F3). Logged, not asserted, so this suite keeps
      //    passing if a future Medusa release fixes the swallowing.
      const raw = await runCli()
      console.log(
        `raw upstream medusa db:migrate exit code on failed seed: ${raw.code}`
      )
      expect(await unfinishedScripts()).toContain("initial-data-seed.ts")

      // 3. The checked wrapper must fail the run (the contract this suite
      //    protects).
      const wrapped = await runWrapper()
      if (wrapped.code === 0) {
        console.log("wrapper output tail:\n" + wrapped.output.slice(-2000))
      }
      expect(wrapped.code).not.toBe(0)
      expect(wrapped.output).toContain("did not finish")
    },
    900000
  )
})
