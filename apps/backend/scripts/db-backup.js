#!/usr/bin/env node
/**
 * Database backup via pg_dump (Sprint/Stage B, master mission G1).
 *
 * Creates a logical backup of the database in pg_dump's compressed custom
 * format (`.dump`): portable, restorable with `scripts/db-restore.js`, and
 * restorable by stock PostgreSQL tooling on any machine with the client tools.
 *
 * This is a logical dump, NOT point-in-time recovery: it captures the state at
 * dump time only. WAL-based PITR is out of scope and documented as such in
 * docs/BACKUPS.md.
 *
 * Usage (from apps/backend):
 *   node scripts/db-backup.js [--out <path>]
 *
 * Source database: DATABASE_URL from process.env, else from the .env file
 * loaded exactly like the Medusa CLI (values already in process.env win).
 * The URL (and any password inside it) is never printed.
 *
 * Tool discovery: PG_BIN env var -> PATH -> well-known install locations
 * (Windows: C:\Program Files\PostgreSQL\<version>\bin; unix: /usr/bin,
 * /usr/local/bin, /opt/homebrew/bin). Set PG_BIN if your client tools live
 * somewhere else. pg_dump's major version should be >= the server's.
 *
 * Credentials reach pg_dump through the PGPASSWORD environment variable of the
 * child process only — never on the command line (argv is visible to other
 * local processes).
 *
 * Safety guarantees:
 *   - read-only against the source database (pg_dump never writes);
 *   - refuses to overwrite an existing backup file (exit 1);
 *   - backup files contain the full database (PII, password hashes) — the
 *     default output directory is git-ignored (`.gitignore`: backups/).
 *
 * Exit codes: 0 = backup written and non-empty; 1 = failure (tool missing,
 * connection/dump error, target exists, empty output); 2 = usage error.
 */
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

function fail(message, code = 1) {
  console.error(`db-backup: ${message}`)
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
      "DATABASE_URL is not set (and no .env found). Point it at the database to back up.",
      1
    )
  }
  return url
}

function parseUrl(url, tool) {
  let parsed
  try {
    parsed = new URL(url)
  } catch (error) {
    fail(`${tool}: DATABASE_URL is not a valid URL.`, 1)
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    fail(`${tool}: DATABASE_URL is not a postgres:// URL.`, 1)
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).split(
    "?"
  )[0]
  if (!database) {
    fail(`${tool}: DATABASE_URL has no database name.`, 1)
  }
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
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
    fail(
      `PG_BIN is set but ${candidate} does not exist. Fix PG_BIN or unset it.`
    )
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

function parseArgs(argv) {
  let out = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      out = argv[i + 1]
      if (!out) {
        fail("--out requires a path", 2)
      }
      i++
    } else {
      fail(`unknown argument "${argv[i]}". Usage: db-backup.js [--out <path>]`, 2)
    }
  }
  return { out }
}

function main() {
  const { out } = parseArgs(process.argv.slice(2))
  const conn = parseUrl(loadDatabaseUrl(), "db-backup")

  const safeDbName = conn.database.replace(/[^A-Za-z0-9_-]/g, "_")
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const target = out
    ? path.resolve(out)
    : path.join(
        __dirname,
        "..",
        "backups",
        `${safeDbName}-${timestamp}.dump`
      )

  if (fs.existsSync(target)) {
    fail(
      `refusing to overwrite existing file: ${target}. ` +
        "Pick a different --out path (backups are never overwritten)."
    )
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })

  const pgDump = findTool("pg_dump")
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--no-password",
    "--host",
    conn.host,
    "--port",
    conn.port,
    "--username",
    conn.user,
    "--dbname",
    conn.database,
    "--file",
    target,
  ]
  if (conn.sslmode) {
    args.push("--sslmode", conn.sslmode)
  }

  const env = { ...process.env }
  if (conn.password) {
    env.PGPASSWORD = conn.password
  }

  const started = Date.now()
  const result = spawnSync(pgDump, args, {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30 * 60 * 1000,
  })

  if (result.error) {
    fail(`failed to run pg_dump: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim().split(/\r?\n/).slice(-5).join("\n")
    // pg_dump errors echo host/user/database but never the password.
    fail(`pg_dump exited with code ${result.status}${detail ? `:\n${detail}` : ""}`)
  }

  let size = 0
  try {
    size = fs.statSync(target).size
  } catch (error) {
    fail(`pg_dump reported success but ${target} is missing`)
  }
  if (size <= 0) {
    fail(`pg_dump produced an empty file at ${target}`)
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `db-backup: wrote ${target} (${size} bytes, ${seconds}s) from database "${conn.database}".`
  )
  console.log(
    "db-backup: reminder — this file contains all data of that database " +
      "(including customer PII); keep it private and never commit it."
  )
}

main()
