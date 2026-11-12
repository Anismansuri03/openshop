# Backups and Restoration

A store's database is the business: products, orders, customers, payments
references. This document describes how to back up an OpenShop database, how to
restore one, and — most importantly — how to *test* that your backups actually
work. Backup tooling that has never been restored from is not a backup.

> **Scope**: this covers the OpenShop application database (PostgreSQL). It does
> not cover uploaded files (local asset storage), Redis state, or DNS. If you
> store product images on disk, back up that directory separately.

## What these tools are (and are not)

| | |
| --- | --- |
| **Is** | A logical dump (`pg_dump --format=custom`, compressed) of one PostgreSQL database, plus a restore-into-a-new-database script that verifies the result row-for-row against the source. |
| **Is not** | Point-in-time recovery (PITR). A dump captures the state at dump time only. For continuous archiving, configure PostgreSQL WAL archiving with `archive_command` + `restore_command` on your server — that is a database-server concern, not an OpenShop concern. |
| **Is not** | A scheduled job. Scheduling (cron, systemd timer, cloud scheduler) is yours to configure; the scripts are the building blocks. |

## Requirements

- Node.js 20+ and the OpenShop backend installed (`pnpm install` at repo root).
- PostgreSQL **client** tools on the machine that runs the backup:
  `pg_dump` (backup) and `pg_restore` (restore). The server may be remote.
  - The scripts look for them in this order: `PG_BIN` environment variable →
    `PATH` → well-known install locations (`C:\Program Files\PostgreSQL\<ver>\bin`
    on Windows, `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin` elsewhere).
  - If yours live elsewhere, set `PG_BIN` to the directory containing them.
  - Use a `pg_dump` version **greater than or equal to** the server's major
    version (e.g. pg_dump 17 for a PostgreSQL 17 server). Older dumps restore
    into newer servers; the reverse is not supported.
- Connectivity and credentials for the target database (`DATABASE_URL`,
  normally from `apps/backend/.env`). The scripts never print the URL or the
  password.

## Creating a backup

```bash
cd apps/backend
pnpm run db:backup                    # writes apps/backend/backups/<db>-<timestamp>.dump
pnpm run db:backup -- --out /path/to/backup.dump   # explicit destination
```

Behavior:

- The source database is read-only for this operation (`pg_dump` never writes).
- The script **refuses to overwrite an existing file** (exit 1). Backups are
  never silently replaced — pick a new path.
- Exit code 0 means the archive exists and is non-empty; the output names the
  database it came from. Anything else is a failure — treat a non-zero exit as
  "no backup exists".
- Output lands in `apps/backend/backups/` by default, which is git-ignored.

> **The archive contains everything in the database** — customer names,
> emails, addresses, order history, staff password hashes. Treat a backup file
> with the same care as production database access: encrypt it at rest if it
> leaves the server, restrict file permissions, and never commit it to git.

### Scheduling (example)

Linux server with cron, nightly at 03:15, keeping 14 days:

```cron
15 3 * * * cd /srv/openshop/apps/backend && PG_BIN=/usr/bin DATABASE_URL="$PROD_DB_URL" ./node_modules/.bin/node scripts/db-backup.js --out /var/backups/openshop/openshop-$(date +\%F).dump && find /var/backups/openshop -name 'openshop-*.dump' -mtime +14 -delete
```

This is an example only — adjust paths, user, and retention to your
infrastructure. Test it once by hand before trusting the schedule.

## Restoring

Restoration always targets a **new, empty, uniquely named database**. The
script never drops, truncates, or overwrites anything; if the target name
already exists, it refuses and exits 1.

```bash
cd apps/backend
DATABASE_URL="postgres://user:pass@host:5432/postgres" \
  pnpm run db:restore -- /path/to/backup.dump openshop_restore_20261029
```

- `DATABASE_URL` supplies the maintenance connection (to create the target
  database) and, for verification, the source database to compare against. It
  must point at the *same server* that can see both.
- The restore runs with `--single-transaction --exit-on-error`: either the
  whole restore succeeds or it rolls back completely.
- On failure the freshly created (empty) target is left in place for
  inspection — nothing is auto-dropped. The script prints how to remove it
  manually once you are done.

### What "verified" means

After restoring, the script compares the restored database against the source:

1. every user table (schema + name) must exist;
2. every table's **row count** must match the source exactly.

If the source database is unreachable (the disaster case this tool exists
for), the script verifies the restored **structure only** and says so
explicitly in its output — a weaker check is never presented as a full one.

To point the application at the restored database, copy the connection URL
into a separate environment file (never overwrite your production
`.env`) and start the backend against it:

```bash
cd apps/backend
DATABASE_URL="postgres://user:pass@host:5432/openshop_restore_20261029" pnpm run backend:dev
```

Check the storefront and admin, then promote the restored database by
switching `DATABASE_URL` — or keep it as an isolated read-only copy for
forensics.

## The restore drill (test your backups)

Run this whenever you change backup configuration, and at least once before
relying on backups in production. The repository automates the entire drill as
an integration suite — this is the same flow, by hand:

```bash
cd apps/backend
# 1. Back up the database.
pnpm run db:backup -- --out /tmp/drill.dump
# 2. Restore into a fresh, uniquely named database (never an existing one).
pnpm run db:restore -- /tmp/drill.sql ... # see usage above
# 3. Read the script output: it must say "verified N tables and row counts
#    against source" — NOT "verified restored structure only".
# 4. Spot-check business data in the restored database (row counts of key
#    tables, a known order, a known product).
# 5. Remove the drill database when finished.
```

The automated version — `apps/backend/integration-tests/migrate/backup-restore.spec.ts`,
run by `pnpm run test:integration:migrate` — performs all of this against
disposable databases in CI and local development: backup, restore into an
isolated database, full table-inventory and row-count comparison, plus the
overwrite-refusal guards for both tools.

## Incident order (data loss)

1. **Stop writes.** Take the application offline. Every second of writes after
   a corruption event widens the damage.
2. **Do not run migrations or seeds** against the affected database.
3. Identify the last good backup (file naming includes the timestamp).
4. Restore into a **new** database — never over the original. The original may
   be needed for forensic recovery (e.g. undelete rows).
5. Verify (the script does this automatically), then point `DATABASE_URL` at
   the restored database and restart.
6. Investigate the cause from the preserved original before resuming writes.
7. Take a fresh backup immediately after recovery.

## Known limitations

- **Logical dump, not PITR**: recovery point = last successful dump. Choose
  schedule/retention against your tolerance for data loss.
- **Large databases**: `pg_dump --format=custom` is single-threaded on the
  dump side; multi-terabyte databases need `pg_dump` section parallelism
  (`-j` with directory format) or physical backups (`pg_basebackup`,
  snapshotting). Not exercised by this project's tests.
- **Roles and tablespaces are not restored** (`--no-owner --no-privileges`):
  the restore assumes the target cluster already has a suitable role. This
  keeps restores portable and free of privilege escalation.
- **Cross-version restores** work from older dumps into newer servers only.
- **Files and assets** stored on local disk are outside the database dump.
