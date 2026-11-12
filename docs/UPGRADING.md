# Upgrading OpenShop

The upgrade and rollback runbook. Like [DEPLOYMENT.md](DEPLOYMENT.md), every
procedure here carries its test status: **[TESTED]** = executed on the
isolated clean installation of 2026-11-05 with the exit code recorded;
**[NOT TESTED]** = reference only; **[SRC]** = read from source.

> **Honest scope note.** The repository currently has a **single version** —
> there is no previous release to upgrade *from*. What has been tested is
> every *mechanism* an upgrade uses (install, build, idempotent migration,
> backup, restore-as-rollback, service resume). A full N → N+1 upgrade with
> forward migrations written between two releases, plus versioning policy,
> CHANGELOG and a release checklist, belongs to release engineering (**G10**)
> and is **[NOT TESTED]**.

---

## 1. What an upgrade consists of

| Layer | Change | Reversible by |
| --- | --- | --- |
| Code | `pnpm install --frozen-lockfile` + `pnpm run build` | redeploy the previous build **[NOT TESTED]** |
| Database | `pnpm run db:migrate` (forward migrations only) | restore the pre-upgrade backup (section 4) **[TESTED mechanism]** |
| Configuration | `.env changes | keep a copy of the previous `.env` **[SRC]** |
| Data | untouched by code deploys | backups (section 3) |

There are **no down-migrations** (Medusa/this project: add-only migrations —
see AGENTS.md). Database rollback therefore always means *restore*, never
*reverse-migrate*.

## 2. Upgrade procedure

```powershell
# 1. Put the store in maintenance mode at your proxy (or accept brief errors)
#    [NOT TESTED — no proxy on the test machine]

# 2. Back up FIRST — this is the rollback point
cd apps/backend
pnpm run db:backup                      # [TESTED — exit 0, section 3]

# 3. Fetch the new code and install exactly what the lockfile says
git pull                                # [NOT TESTED here: this session never pulls]
pnpm install --frozen-lockfile          # [TESTED — exit 0 (1m12s, bare tree)]

# 4. Apply database migrations (forward-only)
pnpm run db:migrate                     # [TESTED twice — exit 0 on a fresh DB
                                        #  and exit 0 re-run on a migrated DB]

# 5. Build both apps (NEXT_PUBLIC_* are inlined — set them before building)
pnpm run build                          # [TESTED — exit 0]

# 6. Restart backend and storefront, then verify
#    backend:  cwd = apps/backend/.medusa/server, then medusa.cmd start --port <p>
#    storefront: cwd = apps/storefront, then pnpm exec next start -p <p>
#    verify: GET /health → 200, GET / → 200, store API with publishable key → 200
#    [TESTED — all three checks exit 0 after the disaster-drill restore]
```

Order matters: **backup → migrate → build → restart**. Migrating before you
have a backup leaves no rollback point; building before migrating can ship a
build that expects schema that does not exist yet.

### 2.1 If the migration itself fails

`pnpm run db:migrate` is the *checked* wrapper: it propagates the upstream
exit code and additionally verifies that every migration-script row has
`finished_at` set, because upstream `medusa db:migrate` (2.21.2) can print a
failed script and still exit 0 (**[SRC]** — see the header of
`apps/backend/scripts/migrate-checked.js`, reproduced 2026-10-28).

- Non-zero exit → the database is **not** in the state the new code expects.
  Do not restart the new version. Restore the pre-upgrade backup (section 4),
  stay on the old build, and investigate.
- Exit 0 → schema and scripts are verified complete (**[TESTED]**).

### 2.2 What you must do yourself (all [NOT TESTED])

- Choosing a maintenance window and draining in-flight requests at a proxy.
- Multi-node rollouts (the tested topology is a single backend + single
  storefront process).
- Rolling back a *code* deployment (redeploying the previous build) — only
  the database side of rollback has been exercised.

## 3. Back up before every upgrade

```powershell
cd apps/backend
pnpm run db:backup
# [TESTED — exit 0: wrote backups\<db>-<timestamp>.dump (450092 bytes, 1.1s);
#  prints the PII reminder on every run]
```

Verify the restore path before you need it — an upgrade rollback you have
never rehearsed is a guess (full semantics: [BACKUPS.md](BACKUPS.md)):

```powershell
pnpm run db:restore -- <dump> <fresh-test-db-name>
# [TESTED — exit 0: "verified 148 tables and row counts against source"]
```

## 4. Rollback

### 4.1 Database rollback (restore) — **[TESTED]**

The disaster drill of 2026-11-05 executed the whole path: source database
dropped → restored from the dump → independent row-count comparison
**148/148 tables, 0 mismatches, PASS (exit 0)** → migrations re-run
**exit 0 (idempotent)** → seed **exit 0** → service resumed with
`GET /health` 200.

Procedure:

1. Stop the backend (no open connections to the database you are replacing).
2. `pnpm run db:restore -- <pre-upgrade.dump> <new-db-name>` — the script
   **refuses to overwrite an existing database** (exit 1), so production can
   never be clobbered by a rollback.
3. Point `DATABASE_URL` at the restored database. **[NOT TESTED]** — the G7
   run restored and verified data; the config repoint itself was not
   exercised as a separate step.
4. Re-run `pnpm run db:migrate` (safe: idempotent — **[TESTED]**) and restart.

Caveat recorded in DEPLOYMENT.md §6.3: restoring into *the same name* that
`DATABASE_URL` already points at makes the script's row-count verification
compare the restored database with itself — structure is really verified,
row counts only meaningfully so when the source is a different database or
you cross-check independently.

### 4.2 Code rollback — **[NOT TESTED]**

Deploy the previous build (previous `pnpm install` + `pnpm run build`
artifacts) and restart. It only works if the database still matches that
version's schema — which is why 4.1 (restore) is the real rollback, and why
restoring the pre-upgrade dump is part of, not after, a failed upgrade.

### 4.3 What cannot be rolled back — **[SRC]**

- Data written *after* the backup was taken (orders placed in the window
  between backup and restore are lost from a restore-to-backup rollback).
- Forward migrations are add-only; there is no `migrate:rollback`.

## 5. Upgrade test matrix (current status)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Fresh install of current version (install → migrate → build → run) | **[TESTED]** | DEPLOYMENT.md §9, phases A–I |
| Migrations re-run on an already-migrated database (idempotency) | **[TESTED]** | phase K, exit 0 |
| Backup → restore → row-count verification (source alive) | **[TESTED]** | phase J, exit 0, 148 tables |
| Disaster restore (source gone) + independent compare | **[TESTED]** | phase K, PASS exit 0 |
| Service resume after restore (health, API, admin) | **[TESTED]** | phase K, `/health` 200 |
| N → N+1 upgrade across two releases with new forward migrations | **[NOT TESTED]** | single version exists (G10) |
| Code-only rollback to a previous build | **[NOT TESTED]** | — |
| `DATABASE_URL` repoint as a standalone step | **[NOT TESTED]** | — |
| Zero-downtime / multi-node rollout | **[NOT TESTED]** | single-node topology tested |
| Versioning policy, CHANGELOG, release checklist | **deferred to G10** | — |

## Related documents

- [DEPLOYMENT.md](DEPLOYMENT.md) — install, configuration, health checks,
  troubleshooting, the full clean-install test record.
- [BACKUPS.md](BACKUPS.md) — backup/restore tooling in depth.
- [local-development.md](local-development.md) — development workflow and
  test procedures.
