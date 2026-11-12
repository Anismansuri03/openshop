#!/usr/bin/env node
/**
 * Database restore into a NEW, isolated database (Sprint/Stage B, master
 * mission G1) — the counterpart of scripts/db-backup.js.
 *
 * Usage (from apps/backend):
 *   node scripts/db-restore.js <dump-file> <target-database-name>
 *
 * Safety guarantees (this script never destroys data):
 *   - the target database must not exist; it is created fresh, so an existing
 *     database (including a production one) can never be overwritten — the
 *     script refuses and exits 1;
 *   - nothing is ever dropped or truncated;
 *   - on a failed restore the freshly created target is LEFT IN PLACE for
 *     inspection (the all-or-nothing --single-transaction restore means it
 *     will be empty), and the script prints how to clean it up manually;
 *   - credentials reach pg_restore via the PGPASSWORD child environment only.
 *
 * Verification (what "restore tested" means here):
 *   1. every user table (schema + name) must exist in the restored database;
 *   2. if the source database from DATABASE_URL is still reachable, every
 *      table's row count must match the source exactly — reported as
 *      "verified N tables and row counts against source";
 *   3. if the source is not reachable (the disaster case this tool exists
 *      for), the restored structure alone is verified — reported explicitly
 *      so a weaker check can never be mistaken for the full one.
 *
 * Tool discovery matches db-backup.js: PG_BIN -> PATH -> well-known locations.
 *
 * Exit codes: 0 = restored and verified; 1 = refusal or failure; 2 = usage.
 */
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

function fail(message, code = 1) {
  console.error(`db-restore: ${message}`)
  process.exit(code)
}

function loadDatabaseUrl() {
  try {
    const { loadEnv } = require("@medusajs/utils")
    loadEnv(process.env.NODE_ENV || "development", process.cwd())
  } catch (error) {
    fail(`could not load env helpers: ${error.message}`)
  }
  const url = process.env.DATABASE_URL
  if (!url) {
    fail(
      "DATABASE_URL is not set (and no .env found). It supplies the " +
        "maintenance connection and the source database for verification."
    )
  }
  return url
}

function parseUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch (error) {
    fail("DATABASE_URL is not a valid URL.")
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    fail("DATABASE_URL is not a postgres:// URL.")
  }
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("?")[0],
    sslmode: parsed.searchParams.get("sslmode") || undefined,
  }
}

function findTool(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name

  if (process.env.PG_BIN) {
    const candidate = path.join(process.env.PG_BIN, exe)
    if (fs.existsSync(candidate)) {
      return candidate
    }
    fail(`PG_BIN is set but ${candidate} does not exist. Fix PG_BIN or unset it.`)
  }

  const probe = spawnSync(name, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  })
  if (!probe.error && probe.status === 0) {
    return name
  }

  if (process.platform === "win32") {
    for (const root of [
      "C:\\Program Files\\PostgreSQL",
      "C:\\Program Files (x86)\\PostgreSQL",
    ]) {
      if (!fs.existsSync(root)) {
        continue
      }
      const versions = fs
        .readdirSync(root)
        .filter((entry) => {
          try {
            return fs.statSync(path.join(root, entry)).isDirectory()
          } catch (error) {
            return false
          }
        })
        .sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0))
      for (const version of versions) {
        const candidate = path.join(root, version, "bin", exe)
        if (fs.existsSync(candidate)) {
          return candidate
        }
      }
    }
  } else {
    for (const dir of ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"]) {
      const candidate = path.join(dir, name)
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  fail(
    `${name} was not found. Install the PostgreSQL client tools or set PG_BIN ` +
      `to the directory that contains ${name}.`
  )
}

async function connect(conn, overrides = {}) {
  const { Client } = require("@medusajs/framework/pg")
  const client = new Client({
    host: overrides.host ?? conn.host,
    port: overrides.port ?? conn.port,
    user: overrides.user ?? conn.user,
    password: conn.password || undefined,
    database: overrides.database ?? conn.database,
    ...(conn.sslmode ? { ssl: { rejectUnauthorized: false } } : {}),
    connectionTimeoutMillis: 5000,
  })
  await client.connect()
  return client
}

const TABLES_SQL = `
  SELECT table_schema || '.' || table_name AS name
  FROM information_schema.tables
  WHERE table_type = 'BASE TABLE'
    AND table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY 1
`

async function tableNames(client) {
  const res = await client.query(TABLES_SQL)
  return res.rows.map((row) => row.name)
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`
}

async function rowCounts(client, tables) {
  const counts = {}
  for (const table of tables) {
    const [schema, ...rest] = table.split(".")
    const qualified = `${quoteIdent(schema)}.${quoteIdent(rest.join("."))}`
    const res = await client.query(`SELECT count(*) AS n FROM ${qualified}`)
    counts[table] = Number(res.rows[0].n)
  }
  return counts
}

async function verify(sourceConn, targetClient, targetName) {
  const targetTables = await tableNames(targetClient)
  if (targetTables.length === 0) {
    fail(`restored database "${targetName}" contains no user tables.`)
  }

  let sourceClient = null
  try {
    sourceClient = await connect(sourceConn, {
      database: sourceConn.database,
    })
  } catch (error) {
    console.log(
      `db-restore: source database "${sourceConn.database}" not reachable ` +
        `(${error.code || error.message}); verified restored structure only ` +
        `(${targetTables.length} tables).`
    )
    return
  }

  try {
    const sourceTables = await tableNames(sourceClient)
    const sourceSet = new Set(sourceTables)
    const targetSet = new Set(targetTables)

    const missing = sourceTables.filter((t) => !targetSet.has(t))
    const extra = targetTables.filter((t) => !sourceSet.has(t))
    if (missing.length > 0 || extra.length > 0) {
      fail(
        "table inventory differs between source and restored database.\n" +
          `  missing in restored: ${missing.slice(0, 10).join(", ") || "-"}\n` +
          `  extra in restored:    ${extra.slice(0, 10).join(", ") || "-"}`
      )
    }

    const sourceCounts = await rowCounts(sourceClient, sourceTables)
    const targetCounts = await rowCounts(targetClient, targetTables)
    const mismatches = []
    for (const table of sourceTables) {
      if (sourceCounts[table] !== targetCounts[table]) {
        mismatches.push(
          `${table}: source ${sourceCounts[table]} vs restored ${targetCounts[table]}`
        )
      }
    }
    if (mismatches.length > 0) {
      fail(
        "row counts differ between source and restored database:\n  " +
          mismatches.slice(0, 10).join("\n  ")
      )
    }

    console.log(
      `db-restore: verified ${targetTables.length} tables and row counts ` +
        `against source "${sourceConn.database}".`
    )
  } finally {
    await sourceClient.end()
  }
}

async function main() {
  const [dumpFileArg, targetName] = process.argv.slice(2)
  if (!dumpFileArg || !targetName) {
    fail("usage: db-restore.js <dump-file> <target-database-name>", 2)
  }
  if (process.argv.length > 4) {
    fail("usage: db-restore.js <dump-file> <target-database-name>", 2)
  }

  const dumpFile = path.resolve(dumpFileArg)
  if (!fs.existsSync(dumpFile)) {
    fail(`backup file not found: ${dumpFile}`)
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(targetName)) {
    fail(
      `invalid target database name "${targetName}" — letters, digits and ` +
        "underscores only, must not start with a digit, max 63 characters."
    )
  }

  const sourceConn = parseUrl(loadDatabaseUrl())

  // Fail fast before mutating anything: if pg_restore is missing, no database
  // should have been created yet.
  const pgRestore = findTool("pg_restore")

  // Maintenance connection (any database — CREATE DATABASE cannot run inside
  // a transaction, and pg clients autocommit single statements).
  let maintenance = null
  try {
    maintenance = await connect(sourceConn, { database: "postgres" })
  } catch (error) {
    fail(
      `cannot connect to the maintenance database: ${error.code || error.message}`
    )
  }

  try {
    const existing = await maintenance.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [targetName]
    )
    if (existing.rows.length > 0) {
      fail(
        `database "${targetName}" already exists — refusing to overwrite an ` +
          "existing database. Choose a new name (or remove it manually first)."
      )
    }
    await maintenance.query(`CREATE DATABASE "${targetName}"`)
    console.log(
      `db-restore: created empty database "${targetName}" for restore.`
    )
  } finally {
    await maintenance.end()
  }

  const args = [
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-privileges",
    "--no-password",
    "--host",
    sourceConn.host,
    "--port",
    sourceConn.port,
    "--username",
    sourceConn.user,
    "--dbname",
    targetName,
    dumpFile,
  ]
  if (sourceConn.sslmode) {
    args.splice(args.length - 1, 0, "--sslmode", sourceConn.sslmode)
  }

  const env = { ...process.env }
  if (sourceConn.password) {
    env.PGPASSWORD = sourceConn.password
  }

  const restore = spawnSync(pgRestore, args, {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60 * 60 * 1000,
  })
  if (restore.error) {
    fail(`failed to run pg_restore: ${restore.error.message}`)
  }
  if (restore.status !== 0) {
    const detail = (restore.stderr || "").trim().split(/\r?\n/).slice(-8).join("\n")
    console.error(
      `db-restore: pg_restore exited with code ${restore.status}${detail ? `:\n${detail}` : ""}`
    )
    console.error(
      `db-restore: "${targetName}" was left in place (empty after the rolled-back ` +
        "restore) for inspection. Nothing was dropped. Remove it manually with " +
        `DROP DATABASE "${targetName}" once you no longer need it.`
    )
    process.exit(restore.status || 1)
  }

  let target = null
  try {
    target = await connect(sourceConn, { database: targetName })
  } catch (error) {
    fail(
      `restore wrote no usable database: ${error.code || error.message}`
    )
  }
  try {
    await verify(sourceConn, target, targetName)
  } finally {
    await target.end()
  }
  console.log(
    `db-restore: restore of ${path.basename(dumpFile)} into "${targetName}" complete and verified.`
  )
}

main().catch((error) => {
  console.error(`db-restore: ${error.stack || error.message}`)
  process.exit(1)
})
