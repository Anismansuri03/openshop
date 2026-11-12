#!/usr/bin/env node
/**
 * Checked `medusa db:migrate` wrapper (Sprint 3, finding F3).
 *
 * Upstream @medusajs/medusa 2.21.2 (`commands/db/migrate.js`) forks a child
 * process for `db:migrate:scripts` but discards its exit code — unlike the
 * search variant right above it, which returns false and exits 1. A run whose
 * migration script (e.g. the initial-data seed) throws therefore prints the
 * error and still exits 0, so CI and scripts see a green migration over a
 * broken database. Reproduced 2026-10-28 against a partial-seed database:
 * "Failed to run migration script ... initial-data-seed.ts" printed, exit 0.
 *
 * This wrapper runs the unmodified upstream command and then verifies the
 * outcome in the database itself, which cannot be swallowed:
 *
 *   - a non-zero upstream exit code is propagated unchanged;
 *   - after an upstream exit 0, every row in `script_migrations` must have
 *     `finished_at` set. The script runner claims a row (finished_at NULL)
 *     before executing a script and stamps it on success, so an unfinished
 *     row after a "successful" migrate means a script failed or died halfway.
 *
 * Usage (from apps/backend, with DATABASE_URL set or .env present):
 *   node scripts/migrate-checked.js [any medusa db:migrate flags, e.g. --skip-scripts]
 *
 * Exit codes: 0 = migrations and scripts verified complete; otherwise the
 * failing exit code (or 1 for verification failures/unfinished scripts).
 */
const { fork } = require("child_process")
const path = require("path")

async function main() {
  // Load .env exactly like the CLI does, so DATABASE_URL is available to the
  // verification step. Values already present in process.env (e.g. a caller
  // pointing at a disposable database) win over the file.
  const { loadEnv } = require("@medusajs/utils")
  loadEnv(process.env.NODE_ENV || "development", process.cwd())

  // Same resolution the upstream command uses for its own child processes.
  const { MEDUSA_CLI_PATH } = require("@medusajs/framework")
  const cliPath = path.resolve(MEDUSA_CLI_PATH, "..", "..", "cli.js")
  const passthrough = process.argv.slice(2)

  const upstreamExit = await new Promise((resolve, reject) => {
    const child = fork(cliPath, ["db:migrate", ...passthrough], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    })
    child.on("error", reject)
    // A signal leaves the code null, which is not a success either.
    child.on("close", (code) => resolve(code ?? 1))
  })

  if (upstreamExit !== 0) {
    console.error(
      `migrate-checked: medusa db:migrate exited with code ${upstreamExit}`
    )
    process.exit(upstreamExit)
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error(
      "migrate-checked: DATABASE_URL is not set (and no .env found); cannot verify migration scripts."
    )
    process.exit(1)
  }

  const { Client } = require("@medusajs/framework/pg")
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const table = await client.query(
      "SELECT to_regclass('script_migrations') AS t"
    )
    if (!table.rows[0].t) {
      // --skip-scripts, or an installation without migration scripts:
      // there is nothing to verify.
      console.log(
        "migrate-checked: no script_migrations table; migration-script verification skipped."
      )
      return
    }

    const unfinished = await client.query(
      "SELECT script_name FROM script_migrations WHERE finished_at IS NULL ORDER BY script_name"
    )
    if (unfinished.rows.length > 0) {
      const names = unfinished.rows.map((r) => r.script_name).join(", ")
      console.error(
        "migrate-checked: medusa db:migrate exited 0 but migration script(s) " +
          `did not finish: ${names}`
      )
      console.error(
        "migrate-checked: failing so a broken seed can never look green " +
          "(upstream exit-code swallowing tracked in docs/PRODUCT_AUDIT.md as F3)."
      )
      process.exit(1)
    }
    console.log("migrate-checked: all migration scripts finished.")
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
