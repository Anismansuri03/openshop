# OpenShop — Master Engineering Roadmap

Mission: *Audit, Build, Verify, and Prepare for Global Adoption* — turning OpenShop
into a credible open-source Shopify alternative. This is the **living planning and
progress report** for the master mission (the companion gate-status document is
`openshop-global-launch-readiness-report.md`).

Evidence tags used throughout: **[RUN]** executed with recorded exit code this
session or a prior sprint (logs outside the repo in `%TEMP%\opencode\`), **[SRC]**
read from source, **[FRAMEWORK]** verified in Medusa framework/package source,
**[DOC]** documentation only, **[NOT RUN]** never executed — no claim made.

Safety baseline for every session of this mission: no commits/pushes/history
rewrites, no destructive git or database operations, no secrets printed, no
production/unknown databases touched, no disabled tests or hidden failures.

---

## 1. Baseline (Stage A, 2026-10-29)

### Repository state (verified read-only) [RUN]

| Item | Value |
| --- | --- |
| HEAD / branch | `ef471159eb9cdc58c22f2d325ac4d24e00bf12ac` on `main` |
| Remote | `origin` `https://github.com/Anismansuri03/openshop.git`, **0 ahead / 0 behind** (local == remote) |
| Staged / stash | none / none |
| Working tree | 32 changed paths (19 modified + 13 untracked entries = 39 files), all uncommitted: 25 from Sprint 2, 14 from Sprint 3, none staged |
| Stack | Medusa 2.21.2 · Next.js storefront · PostgreSQL **17.11** (local server) · pnpm pinned `pnpm@10.11.1` · Node 22 · Turborepo |
| Reports | Sprint reports (outside repo): `openshop-sprint2-report.md`, `openshop-sprint3-report.md`. Neither mission report existed before this session. |
| Tooling | `pg_dump`/`pg_restore`/`psql` present at `C:\Program Files\PostgreSQL\17\bin`, **not on PATH** → scripts must discover them (`PG_BIN` fallback documented) [RUN] |

### Verification battery re-run for this baseline [RUN] (same working tree; git status
### unchanged before/after)

| Gate | Command | Exit | Result |
| --- | --- | --- | --- |
| Production audit | `npx pnpm@10.11.1 audit --prod` | **1** | 1 record, `deepmerge` low — residual documented, exit honestly non-zero. **G10-E re-run (2026-11-08): still exit 1, now 3 records — 2 new moderates upstream (`glob`, `minimatch`), §14.3 → G10-F (2026-11-09): back to 1 record — both moderates remediated via selector override, §15.2** |
| Lint (both apps) | `pnpm run lint` | 0 | 4 pre-existing warnings, 0 errors |
| Types | `tsc --noEmit` (backend / storefront) | 0 / 0 | |
| Unit tests | root `pnpm run test` | 0 | storefront 43/43 + backend 35/35 |
| HTTP integration | `test:integration:http` ×2 | 0 / 0 | **15/15** (lifecycle 8, tax 2, rate-limit 5) |
| Migration regression | `test:integration:migrate` | 0 | 2/2 (exit-code contract of `db:migrate`) |
| Builds | `medusa build` + `next build` | 0 / 0 | |
| Secret scan | scripted scan of all 39 changed files | 0 | no real secret values present |
| CI YAML | structural parse of `.github/workflows/ci.yml` | 0 | 2 jobs: `checks` (11 steps), `integration` (9 steps, postgres service) |

**What this battery does *not* prove:** GitHub Actions has never actually run the
workflows (no push authorized — remote status **UNVERIFIED**); no performance,
accessibility, or load measurements exist; no real payment flow has ever been
executed; production readiness cannot be inferred from green builds.

### Completed-work ledger (Sprints 2–3 mapped to ROADMAP items)

| Roadmap / finding | Status | Evidence |
| --- | --- | --- |
| P0-1 seed guard (H1) | **Done** | `initial-seed-guard.ts`, 7 unit tests [RUN] |
| P0-2 test-payment badge (H2) | **Done** | provider-id driven, 3 component tests [RUN] |
| P0-3 log redaction (M5) | **Done** | `redact.ts` in `medusa-error.ts`, 22 tests [RUN] |
| P0-4 env validation (M7) | **Done** | fail-fast `validate-env.ts`, 10 tests [RUN] |
| P0-5 test harness (L13) | **Done** | `run-jest.js`, jest config, timeouts [RUN] |
| P0-6 advisory triage (M4) | **Done** | 36 records (0/20/15/3) → **1 record (0/0/0/1)**; all highs fixed via overrides; `docs/SECURITY_ADVISORIES.md` [RUN] |
| P1-1 order-lifecycle suite (H3) | **Done** | 8-area http suite, 15/15 total ×2 + CI `integration` job [RUN] |
| P1-3 rate limiting (M6) | **Done** | `/auth/*` limiter, 18 unit + 5 integration tests, documented limits + multi-instance limitation [RUN] |
| P1-10 migrate exit code (F3) | **Done** | `migrate-checked.js` wrapper + 2-test regression suite [RUN] |
| P1-9 tax rates (F1) | **Partial** | reproduced + characterized + 19% VAT regression test + docs; **clean installs still ship zero tax rates** (product fix open, must not be a hardcoded universal rate) |
| M12 backend:seed no-op | **Done** | real seed script + AGENTS.md corrected [RUN] |
| F2 admin auth route gotcha | **Documented** | `POST /auth/user/emailpass` is the working login [DOC] |

---

## 2. Ranked gap assessment (consolidated from PRODUCT_AUDIT H/M/L + Sprint 3 + mission phases)

Severity = launch impact. "Size" = expected effort for a verified fix.

| # | Sev | Gap | Evidence | Proposed fix | Acceptance test | Size |
| --- | --- | --- | --- | --- | --- | --- |
| **G1** | **High (ops)** | **No backup creation, no tested restoration, no recovery procedure** (M8 head). Operators cannot run OpenShop beyond a laptop. | [SRC] no backup tooling anywhere; PRODUCT_AUDIT §7 | pg_dump-based backup script + restore-into-new-DB script with overwrite guards, docs/BACKUPS.md, DB-backed regression suite proving restore equivalence | Suite: dump → restore to isolated DB → every table list and row count equal → overwrite attempts rejected; exit 0 recorded | **S — this session's milestone** |
| **G2** | **High (commercial)** | **No real payment provider** — test-only `pp_system_default`; no server-side verification of a real gateway; no webhooks *(local payment layer built 2026-11-12: official Stripe provider wired + credential-free simulator + provider-neutral signed-webhook pipeline + reconciliation + provider contract — still no validated real gateway)* | [SRC] medusa-config payment notice; README | Choose provider by official docs (Stripe first candidate: country/currency coverage, test mode, official SDK, signed webhooks); implement with test-mode only until sandbox verified | Sandbox checkout + signed-webhook + idempotency + refund tests recorded | **Local scope DONE 2026-11-12 (§16); remaining = G2-G sandbox run — blocked on provider sandbox credentials (external authorization)** |
| **G3** | **Med-High** | **Tax configuration is expert-level**: clean install has zero rates; checkout silently computes 0 tax; no admin guidance (F1 tail / P1-9) | [RUN] Sprint-3 reproduction; docs updated | Admin-visible setup guidance/validation + actionable errors; **no seeded universal rates** (mission rule) | New-store journey: operator configures region rates without editing source; taxed checkout asserted end-to-end | M |
| **G4** | **Med-High** | **No RBAC**: every authenticated admin identity has full power; no staff roles, no audit trail (M10/P1-6) | [SRC] `wrapWithPoliciesCheck` unused; PRODUCT_AUDIT §5.2 | Medusa RBAC feature flag + policy definitions for owner/admin/manager/staff; deny-by-default tests via direct API calls | Unauthorized direct API calls (role X on resource Y) all rejected — integration tests | M–L |
| **G5** | **Med** | **No email/notification provider**: account verification and order mails silently undeliverable (M9/P1-4) *(numbering note: this is **not** the development-payment-provider milestone, which the stage plan also calls G5 — see §8; this email gap is still open)* | [SRC] no provider configured | Documented optional provider abstraction (e.g. local/dev file provider for development + SMTP/Resend setup guide); honest disclosure of paid email costs | A test flow produces a real verifiable message in dev; docs list provider options + costs | M |
| **G6** | **Med** | **Rate limiter is per-instance in-memory** (Sprint-3 documented limitation) | [SRC] `auth-rate-limit.ts` | Redis-backed store when `REDIS_URL` present, in-memory fallback; document | Integration test against real Redis: N instances share one budget (or documented as single-node-only) | M |
| **G7** | **Med** | **No outbound webhooks with signature verification** (P1-5) | [SRC] none configured | Generic signed webhook emitter (HMAC, timestamp, retry/backoff) + delivery tests | Recorded test delivery with valid/invalid-signature/replay tests | M |
| **G8** | **Med** | **No backups/upgrade guide/changelog/versioning policy** (M8 tail) — release engineering | [SRC] none | docs/UPGRADING.md + CHANGELOG.md seed + versioning/support policy + release checklist (mission §12) | Doc review + clean-checkout follow-through test | S–M — **docs half done 2026-11-05: docs/UPGRADING.md + docs/DEPLOYMENT.md from a tested clean install (stage milestone G7, §9); CHANGELOG seed + versioning/support policy + release checklist + root version/license done 2026-11-07 (G10-C, §12). Acceptance partially covered by G10-B's isolated-copy follow-through (§11, robocopy — not a git clone of a tag); a true clean checkout of a tagged release stays in the release checklist (RELEASING §6.5), pending authorization** |
| **G9** | **Med** | **GitHub Actions never remotely verified** — local YAML validation ≠ passing workflow. HEAD `ci.yml` has **no integration job at all**; the integration job + five-DB fix live only in the uncommitted working copy | [RUN] local parse + full CI-state replication (G10-A, §10): incomplete-seed state **15/34 exit 1** → corrected config **34/34 exit 0** | When push authorized: push branch, inspect real run logs, fix failures | Actual Actions run URL with green `integration` job | S (needs authorization) |
| **G10** | **Med** | **Performance / accessibility / responsive behavior unmeasured** (mission §9) [NOT RUN] | [NOT RUN] PRODUCT_AUDIT §6 | Lighthouse/axe runs at 3 mobile/desktop widths on isolated instance; fix significant findings | Recorded scores/traces + fixed keyboard/contrast issues | M |
| **G11** | **Med-Low** | **SEO**: no sitemap/robots; dead `next-sitemap` config; `metadataBase` localhost fallback (M11) | [SRC] | working `app/sitemap.ts` + robots route or config; remove dead code | Lint/type/build green; generated sitemap lists seeded products on test instance | S |
| **G12** | **Med-Low** | **i18n**: no translated strings; country routing exists but UI strings are English-only (mission §9/13) | [SRC] PRODUCT_AUDIT §6 | Survey stack need first; lightweight string catalogs only if justified — avoid premature framework (mission §9) | Documented decision + at least one locale path proof if implemented | M (or documented-defer) |
| **G13** | **Low (tracked)** | `deepmerge@4.3.1` advisory — no patched version; **the 2 moderates added 2026-11-08 (G10-E): `glob` GHSA-3g3m-2fjr-6pw4, `minimatch` GHSA-g3hv-75wg-m249 — both remediated 2026-11-09 (G10-F selector override, §15.2)** | [RUN] audit exit 1; lockfile path `notification-sendgrid > @sendgrid/helpers@8.0.0 > deepmerge` verified this session; G10-E re-run = 3 records (§14.3) → G10-F = 1 record (§15.2) | Track GHSA; remove SendGrid module if unused | audit either exits 0 or every residual stays documented (currently 1) | S |
| **G14** | **Low (adopt)** | Governance polish: CODE_OF_CONDUCT missing (root `license: "MIT"` field **added at G10-C**, working copy only — uncommitted; LICENSE file always existed, MIT) | [SRC] `node -p license` → UNSET at HEAD (field present uncommitted); `.github/` has issue+PR templates | add CODE_OF_CONDUCT.md (e.g. Contributor Covenant); commit the staged G10-C metadata when authorized | docs link CoC; committed package.json shows license | S |
| **G15** | **Low** | Documentation-command audit (P1-8) + `/store/locales` 404 + metadata nits (L14) | [DOC/SRC] | scripted run-through of every documented command; fix mismatches | Every README/AGENTS/local-dev command executed with recorded exit codes | S |
| **G16** | **Structural** | **Extensibility contract undocumented for third parties** (mission §6): no example module/workflow in repo, no stability/versioning policy | [SRC] PRODUCT_AUDIT §8 barrier 3 | one copy-able example module + docs/EXTENSIBILITY.md marking stable/experimental/internal | A newcomer builds the example from docs alone | M |

Deferred until prerequisites exist: the real-payment sandbox run (G2-G → needs
sandbox credentials; the local payment layer landed at G2, §16),
multi-store/B2B (P4), plugin marketplace (mission §10: not before the extension
contract is stable — G16 first).

---

## 3. Launch gates (from mission §18 / §12)

Evaluated in `openshop-global-launch-readiness-report.md`; summary:

| # | Gate | Status |
| --- | --- | --- |
| 1 | Documented clean install + extend | PASS (local) [RUN] |
| 2 | Merchant configures store without editing source | PARTIAL → improved by G3: tax setup now documented end-to-end (docs/TAX.md) + admin-API validation with actionable errors; no admin onboarding wizard yet |
| 3 | Real payments safely | **FAIL** — the official Stripe provider is now wired end-to-end (G2, §16) but **never validated**: no credentials exist, no sandbox run happened (G2-G BLOCKED/NOT TESTED); checkout still runs on simulated/test providers only (G5 development provider + G2 simulator + `pp_system_default`), and a simulated payment is not a payment integration |
| 4 | Products/inventory/orders/tax/shipping correct | PARTIAL (lifecycle + tax merchant-path tested via G3; refunds/fulfill not tested) |
| 5 | AuthN/AuthZ protect sensitive operations | PASS for authentication + deny-by-default route auth [RUN]; RBAC absent (G4) |
| 6 | Backups and restoration tested | **PASS (local)** [RUN Stage B] |
| 7 | Upgrades/deployment documented and reproducible | **PASS (local)** [RUN — stage milestone G7, gap G8] — `docs/DEPLOYMENT.md` + `docs/UPGRADING.md` written from a **tested** clean installation (isolated copy, fresh database, every step's exit code recorded, roadmap §9). Upgrade mechanisms tested (idempotent `db:migrate`, backup → restore rollback, service resume). Explicitly [NOT TESTED]: reverse proxy/TLS/process manager, N→N+1 upgrade (single version → G10). **Reproducibility re-proven at G10-B (2026-11-07, §11): full build + 218/218 tests reproduced from an isolated clean copy; Turbo cache restore of build artifacts proven file-for-file against cache manifests** |
| 8 | Storefront/admin accessible and responsive | UNVERIFIED (G10) |
| 9 | Automated tests catch regressions | **PASS (313 tests after G2, 2026-11-12: unit 258 [backend 171 incl. +81 G2 + storefront 87] + HTTP 47 incl. +13 G2 + migration/backup 8 — was 219 at G10-F; CI wired — five-suite migration gap found and fixed in the working copy at G10-A §10, locally replicated; **remote run unverified, fix uncommitted** — G9)** |
| 10 | Public releases verifiable and supportable | **PARTIAL** — release engineering exists on paper since G10-C §12 (root `version`/`license`, CHANGELOG seed, docs/RELEASING.md versioning + support policy + blocking release checklist), and G10-E (2026-11-08) **dry-ran that checklist end-to-end** (§14.2: every step PASS/BLOCKED/NOT TESTED with evidence — first blocker is gate 3 itself), but **zero tags/releases have ever been cut**, remote CI remains unverified (G9), and the dry-run surfaced an audit blocker (3 records, §14.3 — **remediated at G10-F, back to the acknowledged 1 low record, §15.2**); PASS requires one release executed through RELEASING §6, which additionally blocks on gate 3 |
| 11 | License and costs transparent | PARTIAL (MIT file ✓, `license: "MIT"` added to root package.json at G10-C §12 but **uncommitted** — committed HEAD still lacks it; costs documented in README/ADOPTION) |
| 12 | Independent users complete merchant journey | UNVERIFIED (no external testers) |

**Overall: NOT LAUNCH-READY.** Green builds and a 36→1 advisory drop do not
make it so — and the feed has since drifted back to **3 records (1 low +
2 moderates) as of G10-E, 2026-11-08** (§14.3), **since re-mediated at
G10-F (2026-11-09) to 1 record — the unfixable `deepmerge` low (§15.2)**,
which does not change the verdict either. Gate 3 remains a hard
FAIL; gate 10 is PARTIAL (release engineering exists and was dry-run-proven
at §14, but zero releases cut and remote CI unverified); gates 6 and 7
cleared locally — 6 at Stage B, 7 with the tested clean install at §9.

---

## 4. Session milestone selection (Stage B)

Criteria: launch-gate impact × safety (no external credentials, no destructive
operations, fully verifiable inside this session, preserves all existing work).

**Selected: G1 — Backup creation + tested restoration.**
It is the highest-ranked gap that is completable *and verifiable* in one session:
it blocks launch gate 6, needs no credentials, only touches uniquely-named
disposable databases, and its acceptance criterion ("a backup feature is not
complete until a restoration has actually been tested") is empirically provable
here with the PostgreSQL 17 client tools found on this machine.

Not selected this session, with reason:
- G2 real payments — requires external sandbox credentials (mission: stop and
  report rather than improvise).
- G4 RBAC — needs Medusa's experimental feature-flag surface verified against
  official docs first (no MCP/skills connected this session).
- G6 Redis limiter — no verified local Redis to test against; untested code must
  not ship (mission rule).
- G9 remote CI — requires push authorization, forbidden.

### Stage plan (mission §16 mapping)

| Stage | Content | Status |
| --- | --- | --- |
| A | Baseline + plan (this document + readiness report) | **complete 2026-10-29** |
| B | Critical blockers: G1 backup/restore (this session); then G3 tax guidance, G11 SEO | **G1 complete 2026-10-29**; **G11 complete 2026-10-30**; **G3 complete 2026-10-31** |
| C | Merchant journey end-to-end incl. G3, G5 (dev provider), G15 doc audit | **G3 complete 2026-10-31**; **G5 complete 2026-11-03** (§8); G15 doc audit planned |
| D | Production capabilities: G2 payments (after credentials), G4 RBAC, G6 Redis, G7 webhooks, G8 upgrade docs | G8's docs half pulled forward as stage milestone **G7 — deployment/upgrade docs complete 2026-11-05 (§9)**; CHANGELOG/versioning/release-checklist half stays with G10; rest planned |
| E | Release verification: full suite, clean-checkout doc verification, G9 remote CI (when authorized) | planned |
| F | Adoption preparation: G10 measurements, demo, G14/G16, launch materials for passed gates only | planned |

---

## 5. Stage B record (backup + tested restoration)

**Milestone: G1 — backup creation + tested restoration. Status: COMPLETE
2026-10-29 (verified).** Launch gate 6 moves from FAIL to PASS-LOCAL; see the
readiness report for the gate table.

### 5.1 Baseline → change set

Baseline: no backup tooling anywhere in the repository (verified by repo-wide
`*backup*`/`*restore*` search), `.gitignore` had no backups entry, backend
`package.json` had no backup/restore scripts. `pg_dump`/`pg_restore` present at
`C:\Program Files\PostgreSQL\17\bin`, not on PATH; server PostgreSQL 17.11.

Files created (5) — all uncommitted, nothing staged, no history touched:

| File | Purpose |
| --- | --- |
| `apps/backend/scripts/db-backup.js` | `pg_dump --format=custom` wrapper: tool discovery (`PG_BIN` → PATH → well-known Windows/Unix install dirs), refuses to overwrite an existing archive, credentials only via child `PGPASSWORD` (never argv), URL never printed, non-empty-output check, PII warning on success |
| `apps/backend/scripts/db-restore.js` | Restore into a **new** database only: refuses existing target names, never drops/truncates, `--exit-on-error --single-transaction` (all-or-nothing), finds `pg_restore` before mutating anything, then verifies **every user table exists + every table's row count equals the source**; structure-only fallback explicitly labeled when the source is unreachable |
| `apps/backend/integration-tests/migrate/backup-restore.spec.ts` | 6-test drill (see 5.3) living in the migrate suite, auto-run locally and by CI's `integration` job |
| `docs/BACKUPS.md` | Operations doc: requirements, scheduling example, restore procedure, **the restore drill**, incident order, honest limitations (logical dump ≠ PITR, large-DB limits, roles/tablespaces, cross-version rules, files outside DB) |
| `docs/local-development.md` (§ Backups) | Short linked section with quick commands |

Files modified (3): `apps/backend/package.json` (+`db:backup`, `db:restore`
scripts), `.gitignore` (+`backups/` — archives contain full PII and can never
be committed), `docs/local-development.md` (link section).

Design invariants honored: the scripts are read-only against the source; the
restore target is always created fresh with an overwrite refusal; nothing in
the code path ever executes `DROP DATABASE`/`TRUNCATE` against a user-supplied
name (the spec's own cleanup drops only its two suite-owned disposable names);
credentials never appear in argv, logs, docs, or reports.

### 5.2 Security implications

- Backup archives contain **all** database data (customer PII, password
  hashes). Mitigations: default output dir git-ignored (`backups/`), PII
  warning printed on every successful backup, docs treat archives as
  production-equivalent secrets.
- Passwords are passed to `pg_dump`/`pg_restore` via the child process env
  (`PGPASSWORD`) only — never on the command line (argv is visible to other
  local processes), never logged. The scripts print database names but never
  URLs or credentials.
- Restore refuses existing databases → a typo in a production name cannot
  overwrite production; the worst case is a new empty database.
- Secret scan of all 9 files created/edited this session: 3 real secret values
  extracted from `.env` (never printed) tested → **0 hits, exit 0** [RUN].

### 5.3 Tests actually run (exact exit codes) [RUN]

Suite: `pnpm run test:integration:migrate` via the proven harness
(`sprint3-runtest.ps1`: exports `DB_*`, deletes `DATABASE_URL`, no inherited
connection strings). The spec manages its own disposable databases
(`openshop_sprint3_backup_src` / `openshop_sprint3_backup_restore`); nothing
was dropped or created manually beforehand.

| Run | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `test:integration:migrate` | **0** | 2 suites / **8 tests passed** (backup-restore 6 in 124.0s, seed-exit-code 2 in 212.4s) |
| 2 (confirming) | `test:integration:migrate` | **0** | 2 suites / **8 tests passed** (seed-exit-code 2 in 175.1s, backup-restore 6 in 82.2s) |
| — | post-run cleanup check | 0 | 0 leftover `openshop_sprint3_backup%` databases, 0 temp archives, no stray `backups/` dir (both runs) |

The 6 Stage B tests, each an acceptance proof:

1. fresh DB migrates + seeds through `migrate-checked.js` (exit-code contract
   re-proven on a third database; fixtures `store=1`, `product=4` asserted);
2. `db-backup.js` writes a non-empty custom-format archive **naming the
   intended database in its output** (mis-routing fails the test) + PII
   warning present;
3. independent source inventory captured (table list > 100 tables,
   `script_migrations.finished_at` set);
4. `db-restore.js` restores into a new isolated DB and its full
   verification path runs (asserted by output text, not the
   structure-only fallback), then re-verified **independently in the spec**:
   exact table-list equality vs source, fixture invariants, spot row-count
   equality on 6 representative tables;
5. overwrite guard: restoring onto the existing target exits non-zero with
   "already exists ... refusing" **and the prior restore is undamaged**;
6. backup overwrite guard: existing archive refused, file untouched.

Fast gates re-run after all Stage B changes:

| Gate | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | 0 errors; backend 2 + storefront 2 pre-existing warnings (unchanged from baseline) |
| `tsc --noEmit` backend | 0 | |
| `tsc --noEmit` storefront | 0 | |
| root `pnpm run test` | 0 | backend 35/35; storefront task served from turbo cache (inputs untouched) |
| storefront `pnpm test` (forced live) | 0 | **43/43** |
| Stage B secret scan (9 files) | 0 | 3 secrets tested, 0 hits |

One transient issue found and fixed during development (pre-execution): the
spec briefly contained a stray assertion in test 2 and `db-restore.js` could
have created the target database before discovering `pg_restore` was missing —
both corrected before the first run; the suite has never been executed in a
failing state that was then suppressed.

### 5.4 Database and environment impact

- Databases created and dropped **by the spec itself**: `openshop_sprint3_backup_src`,
  `openshop_sprint3_backup_restore` (verified absent after both runs).
- Temp archives written to `os.tmpdir()` and deleted by the suite.
- The developer's `.env` database and all protected databases
  (`maison_*`, `beyond_fear_local`) untouched; no server configuration changed;
  ports 8000/9000 untouched; no service was started.
- No new dependencies added (uses `@medusajs/framework/pg` already present);
  lockfile unchanged by this stage.

### 5.5 Acceptance criteria

| Criterion | Status |
| --- | --- |
| Backup creation exists and is documented | **PASS** — `pnpm run db:backup` + `docs/BACKUPS.md` [RUN] |
| Restoration actually tested against an isolated environment | **PASS** — full restore + row-count verification, ×2 runs [RUN] |
| Restore can never overwrite an existing database | **PASS** — test 5 [RUN] |
| Backup refuses destructive overwrite | **PASS** — test 6 [RUN] |
| CI runs the drill | **PARTIAL** — spec auto-discovered by `testMatch` and the CI `integration` job config; **remote run still unverified** (G9, push forbidden) |
| PITR / scheduled backups provided | **NOT CLAIMED** — scheduling is documented as operator responsibility; PITR explicitly out of scope |

### 5.6 Known limitations / not tested

- Not tested: multi-gigabyte databases, cross-version restore (pg_dump 17 →
  older server), WAL-based PITR, scheduled-job execution on a real server,
  restore on a Linux host (local verification is Windows; scripts are
  platform-aware but the unix paths are [SRC]-only), and role/tablespace
  restoration (deliberately excluded via `--no-owner --no-privileges`).
- Structure-only fallback path executes only when the source DB is
  unreachable (the disaster case); it is asserted by code path review and
  its output string exists, but no test simulates an unreachable source.
- Drive-by environment observation (pre-existing, not introduced here):
  system pnpm emits "The `pnpm` field in package.json is no longer read" —
  root `pnpm.overrides` is ignored by this pnpm version. `local-development.md`
  already documents the dual-location policy; advisory state re-confirmed
  unchanged in Stage A.

### 5.7 Blockers and next milestone

No blockers for Stage B — complete. Remaining mission blockers unchanged:
G2 payments (external sandbox credentials required), G9 remote CI (push
authorization required).

**Next exact milestone: G11 — SEO foundation** (working `app/sitemap.ts` +
`robots` handling, remove dead `next-sitemap` config, fix `metadataBase`
localhost fallback), chosen because it is small, safe, fully verifiable in-session
(lint/tsc/build green + sitemap content asserted against a seeded test
instance) and closes a merchant-visible gap. Alternative if a broader unit is
preferred: G3 tax-configuration guidance (admin-side actionable setup, no
hardcoded rates).

---

## 6. G11 — Production SEO foundation (2026-10-29/30)

Scope as executed: framework-native sitemap + robots, validated `metadataBase`,
removal of the dead `next-sitemap` config, focused automated verification, and
a DB-backed production smoke test on an isolated instance. No tax work (G3)
was started; no commits; backend code untouched (its git-changes are the
preserved Sprint 2/3 + Stage B work, file mtimes predate this session [RUN]).

### 6.1 Inspection findings that shaped the design [SRC]

- Next.js **15.5.28** App Router; routes under `src/app/[countryCode]/...`;
  the middleware (`src/middleware.ts`) passes dotted paths straight through
  (`pathname.includes(".")` early return), so `/sitemap.xml` and `/robots.txt`
  reach the metadata routes without being redirected to `/{cc}/...` [SRC].
- No `robots.txt`/`sitemap` existed anywhere (public/ holds only favicon and
  social images); the only related artifact was `apps/storefront/next-sitemap.js`
  whose package (`next-sitemap`) was **not in `package.json`, not in
  `pnpm-lock.yaml`, not installed** — a config file that could never have run
  (it also referenced the nonexistent `NEXT_PUBLIC_VERCEL_URL`) [SRC][RUN].
- `metadataBase` came from `getBaseURL()` = `NEXT_PUBLIC_BASE_URL ||
  "https://localhost:8000"` — a `https://localhost` fallback (browsers would
  warn) and, worse, a silent localhost canonical/OG origin in misconfigured
  production builds [SRC].
- Seeded catalogue: 1 region "Europe" with 7 countries (gb,de,dk,se,fr,es,it),
  4 published products, 4 active flat categories, 0 collections [SRC][RUN].

### 6.2 Files changed (all uncommitted, working tree)

| File | Change |
| --- | --- |
| `apps/storefront/src/app/sitemap.ts` | NEW — metadata route -> `/sitemap.xml`, `revalidate = 3600` |
| `apps/storefront/src/app/robots.ts` | NEW — metadata route -> `/robots.txt` |
| `apps/storefront/src/lib/seo/sitemap.ts` | NEW — pure `buildSitemap` + fault-tolerant `fetchSitemapData` |
| `apps/storefront/src/lib/seo/robots.ts` | NEW — pure `buildRobots` |
| `apps/storefront/src/lib/seo/sitemap.test.ts` | NEW — 30 tests |
| `apps/storefront/src/lib/seo/robots.test.ts` | NEW — 6 tests |
| `apps/storefront/src/lib/util/env.ts` | REWRITTEN — validated origin resolution (see 6.3) |
| `apps/storefront/src/lib/util/env.test.ts` | NEW — 8 tests (validation matrix) |
| `apps/storefront/next-sitemap.js` | DELETED — dead config (justified in 6.5) |
| `apps/storefront/.env.template` | Documented format + production rule |
| `.github/workflows/ci.yml` | Build-verify origin `http://localhost:8000` -> `https://ci-build.example` (loopback now rejected by design) |
| `docs/local-development.md` | Production-build note + "SEO: sitemap and robots" section |

No dependency was added or removed, so **no lockfile change was needed**
(`next-sitemap` never appeared in `pnpm-lock.yaml`; verified [RUN]).

### 6.3 metadataBase fix (`src/lib/util/env.ts`)

`NEXT_PUBLIC_BASE_URL` is the single validated source for every emitted
absolute URL (metadataBase in both `src/app/layout.tsx` and
`(main)/layout.tsx`, OG images, sitemap, robots). Rules: absolute http(s)
origin, no path/query/hash/credentials. Production (`NODE_ENV=production`):
REQUIRED; a loopback value (localhost / *.localhost / 127.0.0.1 / ::1) is
rejected — the build **fails loudly** instead of publishing localhost URLs.
Dev/test: unset falls back to `http://localhost:8000` (replacing the old
`https://localhost` bug), loopback allowed. Validation errors never echo the
raw value (a mispasted origin can contain credentials) [SRC][RUN-tests].

### 6.4 Sitemap and robots behaviour

Sitemap emits ONLY whitelisted public patterns, per routable country:
`/{cc}`, `/{cc}/store`, `/{cc}/products/{handle}`, `/{cc}/collections/{handle}`,
`/{cc}/categories/{path}`. Excluded by construction: admin, auth, cart,
checkout, account, order, verify-account, API, transfer-preview routes.
Non-published products are skipped (`status !== "published"`, defence in
depth — the store API already hides them); internal/inactive categories are
skipped with their subtrees; a Set guarantees no duplicate URL; handles are
URL-encoded. Data comes exclusively from PUBLIC store endpoints
(`/store/regions`, `/store/products?fields=%2Bstatus`, `/store/collections`,
`/store/product-categories`) authenticated only with the publishable key —
no admin API, no elevated credentials. Each section fails independently:
backend down => static fallback (country homepages + `/store`) instead of a
500, with a warning naming only the section. Pagination caps: 10 pages x 100
items per section, with id-dedup loop guard. Robots: allow `/`; disallow the
private surfaces in both bare and `/*/`-prefixed forms + `/api`; absolute
sitemap line. Robots rules are crawler etiquette, not access control
(documented in code and docs).

### 6.5 next-sitemap removal justification

Package never in `package.json`, never in the lockfile, not installed on
disk, no script or code references — only the orphaned config file existed.
Framework-native routes fully replace its intended function (sitemap +
robots generation), so the config file was deleted; the only remaining
"next-sitemap" strings in code are doc comments in the new files explaining
the replacement [SRC][RUN].

### 6.6 Verification — exact commands and exit codes [RUN]

| Check | Result |
| --- | --- |
| Targeted SEO tests (`vitest run` 3 files, storefront cwd) | **exit 0 — 44/44** |
| Full storefront suite (`pnpm --filter @dtc/storefront test`) | **exit 0 — 87/87** (43 pre-existing + 44 new; file count 7) |
| Storefront TypeScript (`tsc --noEmit`) | **exit 0** (after fixing 8 real errors: read-only `NODE_ENV` restore blocks replaced with `vi.unstubAllEnvs()`; ES5 `Set` spreads replaced with `Array.from`) |
| Lint (root, turbo) | **exit 0** (pre-existing warnings only) |
| Storefront production build (`next build`, `NEXT_PUBLIC_BASE_URL=https://store.example.com`) | **exit 0**; route table confirms `/sitemap.xml` static with **Revalidate 1h** — empirical proof Next 15.5.28 honors `revalidate` on metadata routes — and the backend-down degradation ran live during prerender |
| Backend build (`pnpm --filter @dtc/backend build`) | **exit 0** (needed only to run the smoke instance; backend source untouched) |
| CI YAML re-parse after edit (`yaml` package) | **exit 0** — jobs `checks,integration` intact |

**Isolated production smoke test** (disposable DB `openshop_g11_smoke`,
backend `:9100`, storefront `next build`+`next start` `:8457`, teardown dropped
only the suite-owned DB and own PIDs; ports 8000/9000 never touched; the
publishable key was read from the disposable DB into env only, never printed):
- `pnpm run db:migrate` via `scripts/migrate-checked.js` against the
  disposable DB: **exit 0**, "all migration scripts finished" [RUN].
- Direct store-API probe: 4 products, draft canary absent (see below).
- `/robots.txt`: **200**, correct disallow list, `Sitemap:
  https://store.example.com/sitemap.xml`, no localhost [RUN].
- `/sitemap.xml`: **200**, `application/xml`, **70 URLs** = 7 countries x
  (1 home + 1 store + 4 products + 4 categories), collections 0 (seed has
  none); **0 duplicates, 0 non-absolute, 0 localhost, 0 private paths** [RUN].
- Homepage `/dk`: **200**; `og:image` = `https://store.example.com/...`,
  zero localhost metas [RUN].
- Draft-exclusion proof: a **draft product was inserted into the disposable
  DB and linked to the default sales channel** (`g11-draft-canary`); the
  store API returned 4 published products only, and the served sitemap
  contains no draft handle [RUN]. (Builder-level filter is additionally
  asserted by unit tests with explicit `status` values.)

### 6.7 Known limitations / not covered

- **Canonicals on individual pages** were not changed: only the categories
  page sets `alternates.canonical` today (pre-existing, kept as-is). G11
  makes the base origin correct; a follow-up could add per-product/collection
  canonicals + `og:url`. Not claimed as done.
- Next's metadata-route `Cache-Control` is framework-controlled
  (`public, max-age=0, must-revalidate` observed); regeneration cadence is
  the segment `revalidate = 3600` (confirmed 1h in the build table), not an
  `s-maxage` header.
- The 10-page x 100-item cap means >1000 products/categories/collections per
  section would be truncated silently (warn-free by design; far above seed
  scale, revisit before very large catalogues).
- Store API visibility depends on the publishable key's sales-channel
  scoping; the smoke test used the seeded default channel. Multi-channel
  visibility semantics were not exercised.
- No hreflang/i18n alternates (the storefront renders English-only content
  under country prefixes); country-prefix pages are emitted as plain URLs.
- Remote CI was NOT run (no push authorized) — the ci.yml edit is
  parse-validated only.
- SEO outcome (rankings, indexing, traffic) is explicitly NOT claimed; this
  milestone verifies technical output only.

### 6.8 Gate status and next milestone

- **G11 acceptance criteria: PASSED (local)** — sitemap + robots served
  correctly from a production build against a live seeded backend; validated
  metadataBase; dead config removed; automated verification green with exact
  exit codes above. Launch-gate impact: storefront technical-SEO gate moves
  to PASS **(local only)**; gates 3 (real payments) and 7 (remote deployment
  verification) remain FAIL/BLOCKED, gate 10 (remote CI evidence) unverified.
  OpenShop is NOT production-ready on the strength of this milestone.

**Next exact milestone: G3 — tax configuration guidance** (admin-side
actionable setup, no hardcoded rates), as recorded in section 5.7.

---

## 7. Stage D record (G3 — merchant tax configuration and onboarding)

**Milestone: G3 — merchant tax configuration and onboarding. Status:
COMPLETE 2026-10-31 (verified local).** Launch gates 2 and 4 improve from
"tax guidance gap" to evidence-backed (both remain PARTIAL for non-tax
reasons); see the readiness report for the gate table.

Design constraint honored: the smallest complete merchant-facing solution
that **reuses the stock Medusa admin** — no custom tax UI, no parallel tax
engine, no seeded universal rate. Authoritative calculation stays
server-side in Medusa's tax module exactly as before; nothing the client
submits is ever trusted as a tax amount.

### 7.1 Baseline → change set

Baseline (verified [SRC]/[RUN] this session): the seed created tax regions
for seven countries but zero rates, so a clean install silently computed
`tax_total = 0` at checkout; the admin accepted any `rate` number via API
(upstream validates `z.number().optional()` with no bounds — the
dashboard's min/max are advisory HTML attributes only); no tax-setup
documentation existed beyond a README bullet pointing at an open roadmap
item; `docs/local-development.md` incorrectly claimed the integration-test
runner disables the admin HTTP API (empirically disproved: the API is
mounted; only the dashboard *UI* is disabled, and the admin auth pattern —
`create-users-workflow` → `authService.register("emailpass")` →
`updateAuthIdentities` → `POST /auth/user/emailpass` → Bearer token — works
inside the suites).

Change set (all uncommitted, working tree):

1. `apps/backend/src/migration-scripts/initial-data-seed.ts` — after
   seeding tax regions, log a prominent warning when `tax_rate` is empty:
   checkout will compute 0 tax until the operator configures rates in
   **Settings > Tax regions**; explicitly states that no default rate is
   assumed on the merchant's behalf (mission rule). Verified firing in
   migrate output [RUN].
2. `apps/backend/src/lib/tax-rate-validation.ts` (new) — bounds validation
   for tax-rate input: `TAX_RATE_MIN = 0`, `TAX_RATE_MAX = 100`;
   `validateTaxRateValue` / `validateTaxRateBody` (top-level `rate` and
   nested `default_tax_rate.rate`); `createTaxRateValidationMiddleware`
   rejecting with HTTP 400 and `{message, type: "invalid_data"}` (Medusa's
   error shape, so admin clients surface it like any other validation
   failure). Omitted/`null` rate stays valid (zero-rated/exempt — the
   system provider maps it to 0); only non-numeric (NaN/Infinity/string)
   or out-of-range values are rejected, and the message names the field,
   the accepted range, and the received value.
3. `apps/backend/src/api/middlewares.ts` — the middleware registered on the
   three stock admin tax routes that accept rate input: `POST
   /admin/tax-rates`, `POST /admin/tax-rates/*` (the update route is POST
   in this Medusa version), and `POST /admin/tax-regions` (tax-region
   create can carry an inline `default_tax_rate`). It validates request
   bodies only; it does not calculate tax, does not modify stored rates,
   and does not replace the tax module.
4. `apps/backend/src/lib/__tests__/tax-rate-validation.unit.spec.ts` (new)
   — 13 unit tests: null/omitted allowed; 0 and 100 allowed; -5/150/250
   rejected with the range in the message; NaN/Infinity/"19"/[] rejected
   as non-numeric; nested `default_tax_rate.rate` validated; non-object
   bodies pass through (route-level schema handles them).
5. `apps/backend/integration-tests/http/tax-configuration.spec.ts` (new)
   — the G3 merchant-path suite (10 scenarios, see 7.3). Every rate and
   setting is created through the stock **admin API with a real
   authenticated admin session** (the same calls the dashboard makes),
   then a real store checkout is verified against the configured rules.
6. `docs/TAX.md` (new) — how to configure tax from the admin screens;
   the server-side rate-selection priority order (province+product rule →
   province+shipping → province default → country+product → country+
   shipping → country default); province codes require explicit country
   parent regions; tax-**inclusive** pricing (region toggle for
   region-priced amounts, plus the pre-existing `currency_code` price
   preference via `POST /admin/price-preferences` for currency-priced
   amounts — creating a second preference for the same key returns 400
   "already exists"); rate bounds; the historical-orders guarantee (rate
   changes are prospective — stored orders keep their persisted tax
   lines); explicit limitations (no external tax service, no VAT-number
   validation/B2B reverse-charge flows, no filings/reporting, no
   product-level tax exemptions beyond rate priority) and the disclaimer
   that configuration is not legal or accounting advice.
7. `docs/local-development.md` — false admin-API claim replaced with the
   verified admin-auth pattern; the new suite added to the suite list;
   TAX.md linked from the clean-install tax note. `README.md` tax bullet
   now points at docs/TAX.md instead of "tracked in ROADMAP (P1-9)".
   `tax-calculation.spec.ts` stale comment (repeated the false claim)
   corrected to point at the merchant-path suite.

Explicitly NOT done (mission scope rules): no payment-provider work (G2
untouched); no custom admin widget or route (the stock screens are the
intended experience); no tax amounts accepted from any client; the 19%
VAT figure appears only as a test fixture, never as a production default;
no country-compliance claims anywhere in code or docs.

### 7.2 Security and correctness implications

- The bounds middleware closes a real input-validation gap: upstream's
  schema would store a negative or >100 rate that the system tax provider
  multiplies into every subsequent order total. Failure mode is a 400 with
  an actionable message; no stored data is touched.
- No new network dependencies, no new env vars, no new ports, no changes
  to auth, the storefront, or any payment surface.
- The suites never print credentials; the admin test user is created per
  run inside the disposable database and dies with it.

### 7.3 Tests actually run (exact exit codes) [RUN]

All runs on the same working tree; the DB-backed runner drops its
disposable database after each run, so each DB-backed invocation was
preceded by a fresh `CREATE DATABASE` + `medusa db:migrate` (exit 0) for
every suite-owned database. No failure was suppressed or weakened.

| Check | Result |
| --- | --- |
| Targeted G3 suite (`test:integration:http -- tax-configuration`, DB `openshop_g3_tax_config`) | **exit 0 — 10/10** |
| Full HTTP regression (`test:integration:http`, 4 suites on freshly pre-migrated disposable DBs; re-run after the final type fixes) | **exit 0 — 25/25** (order-lifecycle 8, tax-calculation 2, tax-configuration 10, rate-limit 5) |
| Targeted unit (`test:unit -- tax-rate-validation`) | **exit 0 — 13/13** |
| Full backend unit (`test:unit`) | **exit 0 — 48/48** (35 pre-existing + 13 new) |
| Migration/backup suite (`test:integration:migrate`) | **exit 0 — 8/8** (proves the seed-warning change is safe and `db:migrate` still exits 0 on clean installs) |
| Backend + storefront build (`pnpm run build`) | **exit 0** — first run **exit 1** with 5 real TypeScript errors from the new code (middleware signature vs Medusa's generic `MedusaRequest` type; untrusted-body types too narrow for test fixtures); all 5 fixed properly, none suppressed |
| Root lint (`pnpm run lint`, turbo both apps) + explicit storefront lint | **exit 0 / 0** — 4 pre-existing warnings (2 backend MedusaError-style, 2 storefront react-hooks), unchanged from baseline; no `@medusajs/*` rule disabled |
| Storefront build/tsc | **N/A** — storefront untouched by G3 |
| Seed-warning firing | observed in `db:migrate` output on every pre-migration of the four disposable DBs [RUN] |

Merchant workflow verified end-to-end on the isolated disposable DB
(`openshop_g3_tax_config`): authenticated admin session → tax region +
rate creation through stock admin routes → store checkout → configured
totals → persisted order tax lines reconcile with rates × unit price ×
quantity (+ shipping amount) → historical order unchanged after a rate
change. Ports 8000/9000 were never used; every database touched was
explicitly created for these runs and dropped by the runner afterwards.

Scenario coverage vs. the mission's §5 matrix: no tax config (0 tax, no
lines) ✓; valid rate (1.90 + 1.90 = 3.80, total 23.80) ✓; multiple rates
via priority (province 5% beats country 19%) ✓; product-scoped rate on
items vs. default rate on shipping ✓; inclusive and exclusive pricing ✓;
shipping tax ✓; address/region matching (DE rate not applied to FR
address) ✓; missing/invalid region config (404 `treg_missing`, invalid
rates 400) ✓; tax changes not retroactive ✓; correct totals + persisted
order tax lines reconciled ✓.

### 7.4 Known limitations / not covered

- **No tax compliance claims.** OpenShop stores the rates the merchant
  configures and applies Medusa's built-in priority rules. Whether those
  rates are legally correct for a given country, product class, or
  customer type is the merchant's responsibility; docs/TAX.md says so
  explicitly. No external tax service (TaxJar/Avalara/VATress) is
  integrated, and OSS/marketplace, reverse-charge, and VAT-number
  validation flows are not supported.
- **Filings, remittance, and reporting are out of scope entirely.**
- Tax-inclusive pricing for **currency-priced** amounts requires the
  extra price-preference step documented in TAX.md; a merchant who only
  flips the region toggle will see inclusive behavior only for
  region-priced amounts. This is Medusa's semantics, documented rather
  than patched.
- Province tax regions need an explicit parent country region (no
  auto-resolution); province/country codes normalize to lowercase.
- The bounds middleware guards the three rate-accepting admin routes. It
  is not a general request sanitizer, and it deliberately does not touch
  calculation.
- The end-to-end verification ran against disposable local databases on
  this machine; remote CI has still never executed (G9, push
  authorization required).
- Launch blockers unchanged: gates 3 (real payments), 7 (upgrade/
  deployment docs), 10 (release engineering) remain FAIL; gates 8 and 12
  remain UNVERIFIED. G3 does not change the NOT-LAUNCH-READY verdict.

### 7.5 Gate status and next milestone

- **G3 acceptance criteria: PASSED (local)** — the merchant configures tax
  entirely through the intended admin experience; nothing assumes a
  universal rate; checkout uses the configured authoritative rules; tax
  lines and order totals reconcile; historical orders retain their tax
  records; invalid configuration fails with understandable errors; the
  test matrix scenarios above are demonstrated; documentation covers
  setup and limitations. All with the exact exit codes in 7.3.
- Gates 2 and 4 improve on the tax axis and stay PARTIAL overall (no
  onboarding wizard; refunds/fulfillment/capture still untested).

**Next exact milestone: G2 — real payments via a dev/sandbox provider**
(needs external sandbox credentials; mission rule: stop and report rather
than improvise), or G5 (development payment provider + documented merchant
journey) if credentials remain unavailable — both recorded in the stage
plan (Stage C/D continuation).

**G5 was selected and completed on 2026-11-03** because credentials remain
unavailable; the full record is §8 below. G2 stays the payments milestone.

---

## 8. G5 — Development payment provider (2026-11-03)

> **Numbering note.** The §2 gap table's `G5` row (email/notification
> provider) predates the stage plan's use of `G5` for the development
> payment provider (§4 Stage C, §7.5). This section follows the
> mission/stage-plan designation. The email gap itself is unchanged and
> still open — a note was added to that row so the two are not confused.

### 8.1 Goal and honesty boundary

G5 delivers a clearly labelled **development payment provider**: a
self-contained provider that exercises Medusa's real payment interfaces
end to end while never processing money. It is deliberately **not** a
payment integration.

- **Gate 3 (real payments safely) stays FAIL.** A simulated successful
  payment is not a real payment integration: no gateway, no card data, no
  webhooks, no settlement, no sandbox run. **G2** remains the payments
  milestone and stays blocked on external sandbox credentials.
- No other gate moves. G5 changes only test coverage (gate 9) and the
  documentation's honesty about what checkout runs on.

### 8.2 Baseline → change set (all uncommitted) [SRC]

New:

- `apps/backend/src/modules/dev-payment/services/dev-payment-provider.ts` —
  provider extending `AbstractPaymentProvider` (full interface: initiate,
  authorize, capture, refund, cancel, status, retrieve, update, delete,
  account-holder no-ops, webhook method).
- `apps/backend/src/modules/dev-payment/index.ts` — module entry exporting
  the service.
- `apps/backend/src/modules/dev-payment/__tests__/dev-payment-provider.unit.spec.ts`
  — 41 unit tests.
- `apps/backend/integration-tests/http/dev-payment.spec.ts` — 8 HTTP tests.
- `docs/PAYMENTS.md` — architecture, state machine, idempotency, the seven
  safeguards, the 5-step merchant walkthrough, and the G2 relationship.

Modified:

- `apps/backend/medusa-config.ts` — payment-module `providers` entry
  (modules-merge: a user `providers` list replaces the default payment
  entry, last-entry-wins by serviceName) + boot notice.
- `apps/backend/.env.template` — `ENABLE_DEV_PAYMENT_PROVIDER` documented.
- Storefront: `src/lib/constants.tsx` (`isDevPayment` / `isTestPayment`),
  `payment-container`, `payment-button` — "Development Payment (test
  only)" label + test badge.
- Payment claims corrected in `README.md`, `SECURITY.md`,
  `docs/ADOPTION.md`, `docs/local-development.md` (all now state that a
  simulated payment is not a payment integration and link `docs/PAYMENTS.md`).
- One type-only fix in G3's HTTP spec — see 8.5.

Deliberately **not** changed: the seed does not register the provider on
any region, so "enable the provider for your region" stays a real merchant
step (the tests enable it in `beforeAll`).

### 8.3 Design summary [SRC]

- Container key `pp_dev-payment_default`; all provider state lives in
  `data.dev_payment`, always stamped `simulated: true` and
  `provider: "development"`, state machine
  `initiated → authorized → captured → refunded | canceled | error`.
- Amounts rounded to 6 decimals with a 1e-6 epsilon; **capture is
  assignment, not addition**, so repeated captures can never double-count;
  refunds accumulate in `refunds[]` keyed by the module's idempotency key.
- Simulation directives via session-create `data.simulate`: `decline`
  (sticky `failure_reason: "simulated_decline"`, checkout → HTTP 400, no
  order created), `auto-capture`; any other value → `INVALID_DATA` naming
  the supported values.
- Idempotency: duplicate initiation returns current state; duplicate
  capture/refund keys are no-ops; duplicate session creation and duplicate
  cart completion never duplicate an order.
- Every one of the 14 failure paths throws `MedusaError` with a real type
  (bad input → `INVALID_DATA`, state-machine violation →
  `UNEXPECTED_STATE`, production guard → `NOT_ALLOWED`), so invalid client
  input maps to 400 instead of 500. That also fixed the
  `@medusajs/use-medusa-error-not-generic-error` rule properly rather than
  suppressing it (backend lint warnings 16 → 2, both pre-existing).
- **Seven safeguards** (detail in `docs/PAYMENTS.md`): production boot
  refusal unless `ENABLE_DEV_PAYMENT_PROVIDER=true`; a warning line on
  every boot/migration; the provider accepts no options; `simulated` state
  stamps; storefront test label + badge; the `medusa-config.ts` notice; and
  `getWebhookActionAndData()` always returning `not_supported` (no webhook
  surface exists to spoof).

### 8.4 Security implications

- No new secret, no new external egress, no new network surface: the
  provider never calls out and holds no credentials.
- Payment `data` is server-owned; no client-submitted amount or state is
  trusted.
- The production refusal runs in `validateOptions` while the payment module
  loads — before any request can be served.

### 8.5 Tests actually run (exact exit codes) [RUN]

All DB-backed runs used the documented two-step procedure
(`docs/local-development.md`: inline `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD`
parsed from `.env` in-process, values never printed; the runner deliberately
ignores `DATABASE_URL`). Every suite database was recreated and
pre-migrated immediately before each full run.

| Check | Result |
| --- | --- |
| Targeted G5 unit (`test:unit -- dev-payment-provider.unit.spec`) | **exit 0 — 41/41** |
| Full backend unit (`test:unit`) | **exit 0 — 89/89** (48 pre-existing + 41 G5) |
| Targeted G5 HTTP (`test:integration:http -- dev-payment.spec.ts`, DB `openshop_g5_dev_payment`) | **exit 0 — 9/9** (test 9 = simultaneous duplicate capture/refund, see below) |
| Full HTTP regression (`test:integration:http`, 5 suites on freshly pre-migrated disposable DBs) | **exit 0 — 34/34** (order-lifecycle 8, tax-calculation 2, tax-configuration 10, rate-limit 5, dev-payment 9) |
| Migration/backup suite (`test:integration:migrate`, re-run after the final provider change) | **exit 0 — 8/8** |
| Backend build (`pnpm run build`, backend) | **exit 0** — first run **exit 1** with 2 real contract errors (TS2417: `validateOptions` static override incompatible with `AbstractPaymentProvider`; TS2554: webhook method call arity); both fixed to match the base class, none suppressed |
| Root lint (`pnpm run lint`, both apps) | **exit 0** — 4 warnings total, all pre-existing (2 backend `MedusaError`-style at `medusa-config.ts:19` / `initial-data-seed.ts:69`, 2 storefront react-hooks); G5's own 14 warnings were fixed, not silenced |
| `tsc --noEmit` backend / storefront | **0 / 0** — backend raw tsc first **exited 2** on 2 pre-existing type errors in G3's HTTP spec (`tax_lines` read off inline param types that omitted it). G3 never ran raw backend tsc (it recorded storefront tsc N/A) and `medusa build` only type-checks `src/`, which is why G3's build passed. Fixed type-only (`tax_lines?: unknown[]` + explicit `reduce<number>`), then G3's suite re-run **exit 0 — 10/10** |
| Storefront lint / tsc / tests | **exit 0 / exit 0 / 87/87** (storefront touched only for the payment label) |
| Root production build (`pnpm run build`) | **exit 0** — `next build` run with the documented public `NEXT_PUBLIC_BASE_URL` (the stock localhost `.env` is refused by the G11 loopback guard, exactly as `docs/local-development.md` documents) |
| Secret scan (7 credential patterns × 12 G5-changed files) | **0 real secrets** — 3 matches are pre-existing doc placeholders (`postgres://USER:YOUR_PASSWORD@localhost`) |

Honesty about first attempts: the first HTTP run failed **before any
assertion** (SASL `client password must be a string`) because the required
`DB_*` variables were not set — an environment/procedure miss, not a code
defect, resolved by following the documented two-step procedure. One
background prep wrapper reported exit 1 while printing
`all suite databases ready`; the databases were verified present by direct
query before the run that followed.

Merchant walkthrough verified: configure provider → enable for region →
place test order → inspect payment status (`docs/PAYMENTS.md`, 5 steps),
with the decline path proven to produce HTTP 400 and no order.

Concurrency follow-up (flagged 2026-11-04, verified): test 9 fires four
identical capture requests and four identical full-refund requests at the
same instant through the real admin routes (`Promise.allSettled` over
`POST /admin/payments/:id/capture` and `/refund` with a merchant session,
created the G3 way). Result: exactly one capture transaction and exactly
one full refund land, the payment never exceeds the captured amount, and
the provider state machine stays consistent — idempotency holds under
simultaneous requests, not only sequential retries (tests 3-4). First run
failed only on the test's own sign assertion (order refunds are recorded
NEGATIVE, documented in test 4); fixed to compare magnitudes, then
9/9 exit 0.

### 8.6 Known limitations / not covered

- **Simulated only.** No card data, no gateway, no provider webhooks, no
  settlement, no disputes, no PCI scope. Refund/cancel update provider
  state only; no money moves.
- No real sandbox run (G2, blocked on credentials) and no claim of
  payment readiness anywhere in the docs.
- The storefront production build requires a public
  `NEXT_PUBLIC_BASE_URL` (G11 guard); the local `.env` value is refused by
  design.
- Email/notification provider (the §2 `G5` row) remains open and untouched.

### 8.7 Gate status and next milestone

- **Gate 3 stays FAIL** — explicitly recorded in `docs/PAYMENTS.md`,
  `README.md`, `SECURITY.md`, `docs/ADOPTION.md` and the readiness report.
- Gate 9 improves with coverage: 168 → **218** automated tests, all green
  locally (see 8.5).
- **Next exact milestone: G10** — release engineering (CHANGELOG seed,
  versioning/support policy, release checklist) plus the CI fixture gap
  recorded in 9.4; **G2** only once sandbox credentials exist (mission rule:
  stop and report rather than improvise). G7 (this section) completed
  2026-11-05 → §9.

---

## 9. G7 — Deployment documentation with a tested clean install (2026-11-05)

Stage milestone **G7** (launch gate 7); the gap table numbers the same
substance **G8** (its `docs/UPGRADING.md` half — CHANGELOG/versioning/release
checklist stay with G10).

### 9.1 Goal and acceptance rule [SRC]

Hard constraint from the milestone brief: *"documentation must describe a
deployment that has actually been tested. A successful local build is not
proof that a clean production installation works."* Nine required subjects:
(1) architecture/prerequisites; (2) env-var reference + secret management;
(3) PostgreSQL provisioning/migrations/initial setup; (4) storefront/backend
config + domains; (5) HTTPS/reverse proxy/production security; (6)
backup/restore/recovery; (7) upgrade/rollback; (8) health checks/logs/
troubleshooting; (9) a clean installation test on an isolated environment.

### 9.2 Deliverables [SRC]

- **`docs/DEPLOYMENT.md`** — all nine subjects; every claim tagged
  **[TESTED — exit code]**, **[NOT TESTED]** or **[SRC]**; its §9 is the full
  clean-install test record.
- **`docs/UPGRADING.md`** — upgrade/rollback runbook with the same tagging;
  N→N+1 and versioning policy explicitly deferred to G10.
- README adoption paragraph links both. No existing doc was weakened; all
  payments honesty (gate 3 FAIL) preserved in both new documents.

### 9.3 The clean installation test [RUN]

Environment: isolated copy at `Temp\opencode\g7-clean` (robocopy **exit 1**
= files copied, 365 files = source count, `.env` excluded — secret check
False), fresh database `openshop_g7_clean_install`, ports **9101/9102**
(8000/9000 reserved and never touched), random `JWT_SECRET`/`COOKIE_SECRET`,
placeholder origin `https://g7-clean.example`, `ENABLE_DEV_PAYMENT_PROVIDER`
deliberately unset for the refusal test.

Phases (all exit 0 unless noted):

| Phase | Run | Result |
| --- | --- | --- |
| A | clean copy (no secrets, no build artifacts) | robocopy exit 1 (success), 365 = 365 files |
| B | `pnpm install --frozen-lockfile` | exit 0 — 1m12.1s, pnpm 10.11.1 |
| C | fresh backend (7→8 keys) + storefront (5 keys) `.env` from templates | OK, values never printed |
| D | `CREATE DATABASE` + `pnpm run db:migrate` | exit 0 — migrations + guarded initial-data seed (region/7 countries, 4 starter products, publishable key, inventory) |
| E | publishable key → storefront `.env` (file only) | exit 0 — `pk_…`, 67 chars |
| F | `pnpm run build` (both apps) | exit 0 — Next 15.5.28, admin frontend 73.25s |
| G | `medusa start` **without** the dev-payment flag | **exit 1**, refusal message seen, **no port bound** (9101 + 9000 free) |
| H | `medusa.cmd start --port 9101` from `.medusa/server` | `/health` 200 `OK`; `/store/regions` 200 with key (1 region, dk/fr/de/it/es/se/gb) / **400 without**; `/app` 200 |
| I | `next start -p 9102` | `/`, `/dk`, `robots.txt`, `sitemap.xml` all 200; sitemap initially 2 URLs → route-cache cleared → **70 URLs**, correct origin |
| J | `db:backup` + `db:restore` into a second DB (source alive) | exit 0 (439.5 KB, 1.1s); exit 0 — **verified 148 tables and row counts against source** |
| K | disaster drill (below) | drop exit 0; restore exit 0; independent compare **PASS exit 0** (148/148 tables, 0 mismatches); `db:migrate` re-run **exit 0 (idempotent)**; `backend:seed` **exit 0** (50/50 products, search index 54); restart → `/health` 200, 54 products, admin 200 |
| teardown | stop services, drop both G7 DBs, port sweep | both drops exit 0 (0 `openshop_g7%` databases remain); 8000/9000/9101/9102 all free |

Phase K disaster drill detail: the source database was **dropped** to
simulate total loss, restored from the phase-J dump into the same name, and
row counts were then cross-checked against an **independent** pre-disaster
copy (`openshop_g7_restore_check`, itself verified while the source was
alive): 148/148 tables, 0 missing, 0 extra, 0 mismatches — PASS.

### 9.4 Findings recorded in the docs [RUN]

1. **`medusa start` must run with cwd = `apps/backend/.medusa/server`.** The
   CLI takes its project directory from the cwd; the admin loader serves
   `<cwd>/public/admin`, which exists only inside the build output. From
   `apps/backend` it fails with `Could not find index.html in the admin build
   directory`. Also `loadEnv` reads the cwd, so `apps/backend/.env` must be
   supplied via the process environment when launching from `.medusa/server`.
2. **`medusa start` sets `NODE_ENV=production` itself** and honours
   `--port`/`PORT` (default 9000) — port and refusal behaviour verified with
   9101 bound and 8000/9000 never touched.
3. **Stale sitemap fallback lives in `.next/server/route-cache/`.** With the
   backend down at build time the route serves the 2-URL static fallback for
   up to `revalidate = 3600`. Deleting `.next/server/app/sitemap.xml.*` or
   `.next/cache` was **not** enough; clearing `route-cache` with the backend
   up regenerated **70 URLs** with zero warnings. Documented as a
   troubleshooting entry.
4. **`backend:seed` exists only in the root `package.json`** — running it
   from `apps/backend` fails `ERR_PNPM_NO_SCRIPT` (exit 1); from the root:
   exit 0, 50/50 demo products.
5. **`db-restore` same-name quirk:** restoring into the name `DATABASE_URL`
   points at makes "verified against source" a self-comparison (the source
   name is recreated as the target). Structure verification stays real; row
   counts are only meaningful against a *different* source or an independent
   cross-check (as done in phase K). Documented in DEPLOYMENT/UPGRADING.
6. **`GET /health` is a static 200** (upstream's own source comment admits
   it) — liveness, not database readiness; docs recommend pairing it with a
   store-API call.
7. **CI gap (for G10; statically verified, remote unverified):** `ci.yml`
   pre-migrates only `openshop_sprint3_order_lifecycle` +
   `openshop_sprint3_tax_regression`; the `tax-configuration` and
   `dev-payment` HTTP suites need seeded fixtures the runner never creates —
   `@medusajs/test-utils` migrates schema/links/search but **never runs
   migration scripts** (verified across its `dist`), and CI invokes neither.
   Those two suites would fail on a real Actions run. `rate-limit` needs no
   fixtures (hits `/auth/*` only).
   **[G10-A, 2026-11-06] Fixed in the working copy — locally verified,
   uncommitted:** replication of this state gave **15/34, 3/5 suites, exit 1**
   (exactly the two fixture-dependent suites failed); the corrected workflow
   pre-migrates all five suite DBs and re-ran **34/34, exit 0**. Full record:
   §10. Remote Actions run still pending (G9); HEAD's committed `ci.yml`
   still has no integration job at all.

### 9.5 Known limitations / not covered

- **No Docker/nginx/Caddy/OpenSSL/certbot/pm2/nssm on the test machine** —
  reverse proxy, TLS and process-manager sections are explicitly
  **[NOT TESTED]** reference material in both documents.
- No real domains/DNS, no Redis (the boot log's `fake redis instance`
  fallback was observed and used), no browser-side CORS exercise (checks
  were server-side HTTP), no admin user creation/login in this run
  (`medusa user` [NOT TESTED]).
- Same OS/machine as development (Windows, Node v24.17.0): a bare tree and a
  virgin database, but not a different OS or network topology.
- N→N+1 upgrade impossible with a single version — only the mechanisms
  (install, idempotent migrate, backup, restore, resume) were exercised.
- Gate 3 unchanged: the deployment tested is the one with the **simulated**
  payment provider (refusal itself is what phase G proves).

### 9.6 Gate status and next milestone

- **Gate 7: FAIL → PASS (local)** — deployment/upgrade documentation exists
  *and* a clean installation was actually executed end-to-end with every
  step's exit code recorded; untested surfaces are labelled as such instead
  of implied.
- Gates 3 and 10 unchanged at the G7 stage (hard fails); gate 10 later
  moved FAIL → PARTIAL at G10-C (§12) and was dry-run-proven at G10-E
  (§14), gate 3 still FAIL. Overall verdict stays **NOT LAUNCH-READY**.
- **G10 is now complete** and the next milestone is **G2** once sandbox
  credentials exist: **G10-A done** (§10 — CI correctness + five-suite
  migration fix, PASS local, remote pending), **G10-B done** (§11 —
  reproducible builds from an isolated clean copy, PASS local, two fixes
  mirrored uncommitted), **G10-C done** (§12 — versioning, CHANGELOG seed,
  release policy, uncommitted), **G10-D done** (§13 — workflow hardening,
  YAML-validated, uncommitted), **G10-E done** (§14 — release dry-run: all
  ten RELEASING §6 steps recorded; first blocker is gate 3; new audit
  blocker 3 records; intermittent `rate-limit.spec.ts` finding),
  **G10-F done** (§15 — audit 3 → 1 records via the approved selector
  override; `rate-limit.spec.ts` reproduced, root-caused and fixed;
  `g10e-repro` hash-verified against the source tree). Earlier,
  if separately authorized: G9 remote CI verification, G14
  CODE_OF_CONDUCT.

---

## 10. G10-A — CI correctness audit + five-suite migration fix (2026-11-06)

**Status: PASS (local). Real GitHub Actions verification: PENDING — requires
push authorization (G9), not granted.** No commit, push, tag or workflow
trigger was performed; the only repo file modified is
`.github/workflows/ci.yml` (working copy), all other uncommitted work
untouched.

### 10.1 Committed vs working-copy distinction (read first)

- HEAD `ef471159eb9cdc58c22f2d325ac4d24e00bf12ac` (= origin): the committed
  `.github/workflows/ci.yml` is **78 lines with no integration job at all** —
  it runs only `checks` and states integration tests are intentionally not
  run. A fresh clone therefore executes **zero** integration tests remotely.
- The `integration` job (Postgres services, five suite databases, HTTP +
  migrate suites) exists **only in the uncommitted working copy**, as does
  the five-database fix verified below.
- Nothing in this record describes a workflow that has run on GitHub, and
  nothing here is in the committed repository yet.

### 10.2 Static audit findings (recorded, no edits except ci.yml)

| Finding | Disposition |
| --- | --- |
| HEAD `ci.yml` runs no integration tests (78 lines, `checks` only) | documented here + §9.4.7; remote run pending (G9) |
| Working-copy `ci.yml` pre-migrated only 2 of 5 suite DBs | **fixed in working copy** (§10.4) |
| `turbo.json` `build.outputs` omits `.medusa/**` | **G10-B work item** |
| `update.yaml`: checkout@v3, unpinned `medusajs/medusa-update-action@v1`, `ANTHROPIC_API_KEY` (manual dispatch only) | recorded → G10-C release-policy scope |
| Root `package.json`: no `version`, no `license` field | recorded → G10-C / G14 |
| No CHANGELOG.md, no CODE_OF_CONDUCT.md | recorded → G10-C / G14 |
| `pnpm audit` step is `continue-on-error: true` | recorded → G10-C (release check must be blocking) |
| No `permissions:` / `concurrency:` blocks in workflows | recorded → G10-C |
| CI `node-version: 22` vs `engines` `>=22.22.0`; CI Postgres 16 vs local 17 | recorded as version-skew observations |

### 10.3 Empirical CI-state replication [RUN]

Procedure (local harness, Windows): parse `DB_*` from the source `.env`
in-process (credentials never printed), force `DB_HOST=localhost`, remove
`DATABASE_URL` before invoking the runner; `NODE_OPTIONS=--dns-result-order=ipv4first`.

| State | Suites | Result |
| --- | --- | --- |
| Incomplete-seed replication (2 DBs seeded, 3 schema-only — the pre-fix working-copy behavior) | 3/5 | **15/34, exit 1** — `tax-configuration` TypeError `regions[0].id` and `dev-payment` `deTaxRegions.length = 0`, both because seed fixtures the runner never creates are missing; `rate-limit` passed (fixture-free) |
| All five DBs created + pre-migrated (post-fix behavior) | 5/5 | **34/34, exit 0** |

- First attempt reported 0/34: a **local harness bug**, not CI — `.env`'s
  `DB_HOST=127.0.0.1` triggers `configLoaderOverride`'s SSL branch
  (`config.js:22`) and every connection hangs. Fixed by forcing
  `DB_HOST=localhost`; CI already sets `localhost`.
- The runner drops all five suite DBs post-run (verified); only pre-existing
  `openshop_sprint5` / `*_repro_*` leftovers remain, untouched.

### 10.4 Fix applied (working-copy `.github/workflows/ci.yml` only)

- Single loop creates **all five** suite databases via `docker exec psql` and
  pre-migrates each with `DATABASE_URL=… pnpm run db:migrate` (mimicking the
  Linux CI path; `--skip-scripts` seeding as required per suite).
- Three stale comments/step names corrected to match actual behavior.
- YAML re-validated: jobs `checks` + `integration`, 7 steps, parses clean.

### 10.5 Acceptance and limits

- Acceptance met **locally**: corrected configuration demonstrably runs all
  five suites green from a CI-replicated state, with exit codes recorded.
- **Not claimed:** any GitHub Actions run. The fix is uncommitted; G9 (real
  Actions verification) stays open until push is separately authorized.

### 10.6 Next

G10-B - reproducible builds (steps 2-8 of the approved plan), executed and
recorded in §11, then G10-C.

---

## 11. G10-B — reproducible builds (2026-11-07)

**Status: PASS (local).** Every acceptance step of the approved plan (steps
2–8) executed with exit codes recorded below. Safety: **no commit, push, tag
or workflow trigger**; ports 8000/9000 never bound (0 listeners at teardown);
credentials parsed in-process and never printed; the source tree was modified
only by mirroring the two verified fixes (§11.3) — both **uncommitted** — and
all 51 prior uncommitted changes remain intact. No tests excluded, no
assertions weakened, no dependencies upgraded.

### 11.1 Isolated copy (step 2)

`robocopy` from the source tree excluding `.git`, `node_modules`, `.medusa`,
`.next`, `.turbo`, `.local-logs`, `backups`, all `.env*` secrets and
`*.tsbuildinfo` → **366 files, 3.9 MB** at
`C:\Users\Debian\AppData\Local\Temp\opencode\g10b-repro`. Verified before use:
zero `.env` files, zero git/build state, both `.env.template` files present,
`ci.yml` present (the G10-A working-copy version).

### 11.2 Frozen install (step 3) — one genuine reproducibility defect found

| Command | Exit | Note |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 (78 s) | pnpm **10.11.1** via `packageManager` pin (global 11.8.0 superseded) |
| `pnpm run db:migrate` (first attempt) | 1 | **defect:** `Cannot find module './loaders.js'` — first install silently under-extracted `@graphql-tools/utils@12.1.0` (missing `cjs/loaders.js` + `cjs/executor.js`; its `package.json` intact, same hash as source) |
| `pnpm install --frozen-lockfile --force` | 0 (52 s) | fixes it; both files restored, migrate then exit 0 |

Full `.pnpm` file-list diff (source 140,470 files vs copy 115,941): 24,529
"missing in copy" = **12 stale nested `.bin` shims + source-side leftovers**
(61 old peer-variants, 28 pre-security-override versions, 13 broken-name
dirs — all superseded by current-lockfile variants that exist in the copy);
**0 files extra in the copy**; every app-level bin present (`vite`, `vitest`,
`next`, `medusa`, `turbo`, `tsc`, `eslint`, `jest`). **Unresolved:** root cause
of the one incomplete extraction is unknown (suspected transient Windows
extraction failure); documented mitigation: if a `Cannot find module` oddity
appears after a frozen install, re-run with `--force`.

### 11.3 Findings + fixes (step 4) — two, both mirrored uncommitted

1. **`turbo.json` `build.outputs` mismatch:** declared `["dist/**",
   ".next/**"]`, but the backend emits `.medusa/**` (391 files, 9.8 MB —
   `cache/ client/ server/ types/`) and **no `dist/` exists anywhere**; the
   storefront's `.next/**` matched. Turbo itself later proved the defect with
   `WARNING no output files found for task @dtc/backend#build`. **Fixed:**
   `[".medusa/**", "!.medusa/cache/**", ".next/**", "!.next/cache/**",
   "dist/**"]` (cache dirs excluded per Turborepo practice — they are
   build-time caches, not deliverables; ~411 MB of `.next/cache` and the
   eslint cache stay out of the archive).
2. **Root `build` script bypassed Turborepo:** `"build": "pnpm -r build"`
   (while `start`/`lint`/`test` all use `turbo …`) — so the documented
   `pnpm run build` performed **no hashing and no caching whatsoever**; all
   earlier "cache never hits" observations were this, not a Turbo bug, and
   fix 1 alone would have been unreachable through the documented command.
   **Fixed:** `"build": "turbo build"`.

Both fixes were validated in the copy first, then mirrored to the original
tree and verified **byte-identical** (SHA-256) — uncommitted, minimal diffs.

### 11.4 Environment + production builds (step 5)

- Copy `.env` files derived **in-process** from the source `.env` (values
  never printed): backend with `DB_HOST=localhost` + database swapped to
  fresh `openshop_g10b`; storefront with the publishable key read from that
  fresh DB.
- `pnpm run db:migrate` → **exit 0** (guarded initial-data seed: region,
  starter products, publishable key).
- Build #1 → **exit 1**: the G11 guard rejected the template's loopback
  `NEXT_PUBLIC_BASE_URL` — *expected, documented behavior, not a defect*.
- Build with the documented build-time origin
  `NEXT_PUBLIC_BASE_URL=https://ci-build.example` (same value `ci.yml` uses)
  → **exit 0** (54 s). Artifacts: `.medusa` 391 files/9.8 MB, `.next` 260
  files/418.8 MB.

### 11.5 Full test battery (step 6) — 218/218

| Check | Exit | Result |
| --- | --- | --- |
| `tsc --noEmit` backend / storefront | 0 / 0 | clean |
| root `lint` (turbo) | 0 | 2/2 tasks, 4 pre-existing warnings (unchanged) |
| backend `test:unit` | 0 | **89/89** |
| storefront `vitest run` | 0 | **87/87** |
| five suite DBs create + pre-migrate (fixed-ci.yml state) | 0 | all seeded |
| `test:integration:http` | 0 | **34/34, 5/5 suites** (286 s) |
| `test:integration:migrate` (backup/restore + seed-exit-code) | 0 | **8/8** (242 s) |

Same counts as the source tree — reproduction is exact.

### 11.6 Turbo cache test (step 7)

| Step | Command | Exit / time | Result |
| --- | --- | --- | --- |
| Run A | `pnpm run build` (fixed scripts) | 0 / 38 s | backend **HIT** (1/2 cached), storefront MISS → wrote entry (`5d897fa2de766090`, 1.8 MB — cache dirs excluded) |
| Run B | `pnpm run build` again | 0 / **173 ms** | **FULL TURBO** — 2/2 cached |
| Restore | delete `.medusa` + `.next` → `pnpm run build` | 0 / **1.08 s** | FULL TURBO; artifacts restored |
| Control | revert `outputs` to old → delete `.medusa` → build (miss) → delete → build (**hit**) | 0 / 173 ms | turbo warns `no output files found for task @dtc/backend#build`; after the HIT **`.medusa` is absent** — a green cached build with zero backend artifacts. Proves fix 1 is load-bearing |
| Final | restore fixed `turbo.json` → `pnpm run build` | 0 / **982 ms** | FULL TURBO; `.medusa` 390 files restored |

**Manifest verification** (restored tree vs the cache manifests themselves):
backend manifest 391 entries = **390 `.medusa` files all restored, 0 missing,
0 extra** + turbo's own task log; storefront 247 = **246 `.next` files all
restored** + log. The expected deltas are exactly the excluded cache files
`.medusa/cache/.eslintcache` (1) and `.next/cache/**` (14 files ≈ 411 MB).
Caveats recorded: (a) a cache **hit requires the same env values** the entry
was written with (a different `NEXT_PUBLIC_BASE_URL` → miss → rebuild → G11
guard applies); (b) turbo restores archived files **without pruning**
non-manifest leftovers (after the control runs `.next` held 276 files = 246
archived + stale build caches) — harmless for serving, cleaned by a full
build.

### 11.7 Exact command record + environment requirements (step 8)

Commands (run from the copy root unless noted; every exit code above came
from `$LASTEXITCODE`): `pnpm install --frozen-lockfile` [`--force` retry] →
`pnpm run db:migrate` → `pnpm run build` (with `NEXT_PUBLIC_BASE_URL` set as
**process env**) → `pnpm exec tsc --noEmit` (both apps) → `pnpm run lint` →
`pnpm run test:unit` / `pnpm run test` → five-suite pre-migration →
`pnpm run test:integration:http` → `pnpm run test:integration:migrate` →
cache/restore/control builds → teardown (`DROP DATABASE openshop_g10b` exit 0).

**Environment requirements for reproduction:**

| Requirement | Value / reason |
| --- | --- |
| OS / shell | Windows + PowerShell 5.1 quirks: `$ErrorActionPreference="Stop"` + native `2>&1` **throws** (use `Continue`, no `2>&1`); `"$scheme$user:…"` parses as a drive ref (use `${scheme}`) |
| Node / pnpm | Node **v24.17.0**; pnpm **10.11.1** (honored via `packageManager`; global 11.8.0 is superseded) |
| Postgres | local **PG17** (CI workflow uses PG16 — recorded version skew) |
| `NODE_OPTIONS` | `--dns-result-order=ipv4first` |
| `DB_HOST` | **`localhost`, never `127.0.0.1`** — the latter triggers `configLoaderOverride`'s SSL branch against the non-SSL local Postgres and every connection hangs (seen as 0/34 in G10-A) |
| `NEXT_PUBLIC_BASE_URL` | non-loopback origin **at build time** (G11; documented value `https://ci-build.example`); same value needed again for cache hits |
| Suite databases | five HTTP-suite DBs pre-created + pre-migrated (the fixed `ci.yml` behavior); the runner self-drops them |
| Secrets | `.env` files derived in-process from templates/source; never printed or committed |

### 11.8 Teardown + unresolved

- `openshop_g10b` dropped (`DROP DATABASE … WITH (FORCE)` exit 0); all five
  suite DBs self-dropped by the runner; only the three pre-existing
  session leftovers (`openshop_sprint5`, two `*_repro_20261028`) remain,
  untouched; **ports 8000/9000: 0 listeners**. The isolated copy is kept at
  `%TEMP%\opencode\g10b-repro` for reference.
- **Unresolved / pending:** under-extraction root cause (§11.2);
  **remote GitHub Actions verification still pending (G9 — needs push
  authorization)**; benign `pnpm.overrides` location warning and the
  ignored-build-scripts notice (repo policy: `onlyBuiltDependencies:
  @medusajs/telemetry`) both unchanged from baseline.
- **G10-C next:** versioning, CHANGELOG seed, release/support policy —
  incorporating the G10-A/B routing (§10.2, §11.3). *(Executed: §12.)*

---

## 12. G10-C — versioning, CHANGELOG seed and release policy (2026-11-07)

**Status: Completed** — documentation and package metadata only, all
**uncommitted** like the rest of the working tree. **No tag, push, release
or workflow trigger was made** (none is authorized; none was attempted).

### 12.1 Deliverables

| Artifact | Content |
| --- | --- |
| `CHANGELOG.md` (new) | Keep a Changelog seed: evidence-tagged `[RUN]`/`[SRC]`/`[NOT TESTED]` `[Unreleased]` snapshot (Added / Fixed / Known issues) covering G1–G10-C, with an explicit "zero git tags exist; versioning starts at 0.1.0" status header |
| `docs/RELEASING.md` (new) | §1 honest current status (no releases; gate 3 blocks; remote CI pending) · §2 SemVer policy (0.x until gates pass; 1.0.0 eligibility; append-only migrations) · §3 tagging rules (annotated `vX.Y.Z`, authorization required, no silent edits/yanks) · §4 support policy (latest release only; Node ≥22.22.0 vs CI `22` skew and PG17-local vs PG16-CI skew recorded as blockers; pnpm 10.11.1 pin) · §5 changelog policy · §6 **blocking 10-step pre-release checklist** (gates → clean tree → remote CI green → version/changelog → clean-checkout battery → N→N+1 upgrade test → workflow hardening → tag → post-release verification → rollback readiness) · §7 reproduction requirements carried over from G10-B (PS 5.1 quirks, `DB_HOST=localhost`, build-time `NEXT_PUBLIC_BASE_URL`, five pre-seeded suite DBs, `--force` install caveat) · §8 evidence summary |
| root `package.json` (edited) | added `"version": "0.1.0"` and `"license": "MIT"` (G10-A audit finding; the repo's LICENSE is MIT, © 2022 Medusa). **Validated:** JSON parses; a subsequent `pnpm install --frozen-lockfile` in the G10-B copy = **exit 0, 4 s** — pnpm's lockfile importer records no own-version, so the lockfile is untouched and still frozen-valid |
| `README.md` (edited) | Contributing paragraph now links CHANGELOG.md and docs/RELEASING.md |

### 12.2 Scope decisions (recorded, not silently skipped)

- **`CODE_OF_CONDUCT.md` deliberately not added here** — routed to G14 to
  keep this stage inside the stated scope (versioning/changelog/release
  policy); noted as outstanding in RELEASING §6.7.
- **Workflow hardening not applied unilaterally** (update.yaml pinning /
  `permissions` / `concurrency`, blocking audit at release, Node/PG skew):
  recorded as *blocking checklist items* in RELEASING §4/§6 instead of
  further editing uncommitted workflows during a docs stage. `ci.yml`
  keeps only the G10-A integration fix.
- **Gate 10: FAIL → PARTIAL.** Policy, checklist, changelog and version
  metadata now exist, but the gate's substance — a *verifiable public
  release* — has never happened: zero tags, zero releases, remote CI
  unverified (G9), and RELEASING §6 blocks any release on gate 3 (FAIL).
  PASS requires one fully executed release.
- **G8 gap:** all its documentation deliverables are now complete
  (UPGRADING/DEPLOYMENT at G7; CHANGELOG/versioning/checklist at G10-C);
  its acceptance test "clean-checkout follow-through" is *partially*
  covered by G10-B's isolated copy (which excluded `.git` by design) —
  the true test is a fresh clone **of a tagged release**, kept in the
  release checklist pending authorization.

### 12.3 Next

G10-D and G10-E per the session order (scope to be confirmed when
reached), then back to **G2** once sandbox credentials exist. Standing
constraints unchanged: nothing committed/pushed/tagged, gate 3 stays FAIL,
verdict stays **NOT LAUNCH-READY**.

---

## 13. G10-D — workflow hardening (2026-11-07)

**Status: Completed** — the two workflow files in the working copy were
hardened per the RELEASING §6.7 checklist and validated **locally by YAML
parse only**. Everything remains **uncommitted**; no push, tag or Actions
trigger (remote execution stays pending behind G9).

### 13.1 Changes applied

`.github/workflows/ci.yml`:

| Change | Detail |
| --- | --- |
| Top-level `permissions: contents: read` | least privilege by default (no job needs more than checkout) |
| Top-level `concurrency:` | one run per ref; superseded PR/branch runs cancelled, `main` and `v*` tag runs never killed mid-flight (`cancel-in-progress: ${{ github.ref != 'refs/heads/main' && !startsWith(github.ref, 'refs/tags/') }}`) |
| Tag trigger `push.tags: ["v*"]` | release tags now run the full battery — previously a tag push ran nothing |
| Audit step | `continue-on-error` changed from `true` to `${{ !startsWith(github.ref, 'refs/tags/') }}` — informational on branches/PRs, **blocking on release tags** (RELEASING §6.5) |
| Node skew | `checks` job → matrix `["22.22.0", "24"]` (engines floor + the line every local record ran on, v24.17.0); `integration` → `24`. Was a single unpinned `22` |
| Postgres skew | service image `postgres:16-alpine` → `postgres:17-alpine` (aligns CI with every local verification record) |

`.github/workflows/update.yaml`:

| Change | Detail |
| --- | --- |
| `actions/checkout@v3` → `@v4` | matches ci.yml |
| `medusajs/medusa-update-action@v1` → commit SHA | `02eca016e5b0024bf4ff3beaeff4530bc18fa6e3` — fetched live from `api.github.com/repos/medusajs/medusa-update-action/git/ref/tags/v1` during this stage (never invented); in-file comment records pin date + re-pin procedure. Important because this job pushes commits and holds `ANTHROPIC_API_KEY` |
| Top-level `permissions: contents: read` | job-level `contents: write` + `pull-requests: write` kept (explicit escalation for the PR it opens) |
| `concurrency: update-medusa`, `cancel-in-progress: false` | one update run at a time, never cancelled mid-flight (avoids a half-updated branch) |
| `timeout-minutes: 20` | runaway runs bounded |

`docs/RELEASING.md` updated accordingly: §4 skews now marked "resolved at
G10-D", §6.7 items marked applied-uncommitted (with the SHA), §8 evidence
note refined.

### 13.2 Validation [RUN]

- Both workflows parsed with **js-yaml 4.3.1** (workspace store): exit 0
  each; echoed structure confirmed jobs, matrix, image, pins,
  `permissions`, `concurrency`, and both expressions intact as intended.
- Action SHA provenance = live GitHub API response (above).
- **[NOT TESTED]: actual Actions execution** — YAML parsing cannot prove
  the matrix/expressions run green; that is **G9**, pending until a push
  is separately authorized. The first remote `checks` run will also be
  the first build through the new `turbo build` root script (§11.3),
  though the identical command passed locally.

### 13.3 Safety

Both workflow edits join the same uncommitted set as the G10-A fix; no
prior work disturbed, no dependency or test changes. Remaining
RELEASING §6.7 blocker: `CODE_OF_CONDUCT.md` (routed G14).

---

## 14. G10-E — release dry-run of the RELEASING §6 checklist (2026-11-08)

**Status: Completed (dry-run only — nothing was released).** Every §6 step
was executed as far as it can be without authorization or a passing gate 3,
and each recorded PASS / BLOCKED / NOT TESTED. **The dry-run confirms no
release is possible today: the very first blocking point is step 1
(gate 3 FAIL).** Verdict stays **NOT LAUNCH-READY**; no commits, pushes,
tags or Actions triggers at any point.

### 14.1 Execution (fresh copy, in order)

Isolated copy `g10e-repro` (robocopy exit 1, **368 files** = G10-B's 366 +
the two G10-C docs — cross-check exact; no `.env`, `.git`, build state or
`node_modules` carried over; source tree untouched). Harness scripts derived
from G10-B's, with DB credentials parsed in-process from the copy's derived
`.env` and **never printed**; all databases fresh and disposable.

| Step | Command (cwd = copy root unless noted) | Exit | Time | Result |
| --- | --- | --- | --- | --- |
| Frozen install | `pnpm install --frozen-lockfile` | 0 | 68 s | **G10-B's extraction defect did NOT reproduce** — probed `@graphql-tools/utils` `cjs/loaders.js` + `executor.js` both present; `--force` not needed. Supports the transient classification; root cause **still open** |
| Fresh-DB migrate | `pnpm run db:migrate` (copy `.env` → fresh `openshop_g10e`) | 0 | — | "Migration scripts completed" |
| Lint | `pnpm run lint` (turbo, both apps) | 0 | 21 s | 2/2 tasks; 4 pre-existing warnings, unchanged |
| Types | `tsc --noEmit` backend / storefront | 0 / 0 | — | 0 errors each |
| Unit | backend `test:unit` / storefront `test` | 0 / 0 | 13 s / 4 s | **89/89 + 87/87** |
| Production audit | `pnpm audit --prod` | **1** | — | **3 records (1 low + 2 moderate)** — §14.3 |
| Build | `pnpm run build` (`NEXT_PUBLIC_BASE_URL=https://ci-build.example`) | 0 | 104 s | via the G10-C/G10-B `turbo build` root script |
| HTTP suites | `pnpm run test:integration:http` (five suite DBs pre-created + pre-migrated by `g10e-ci-prep.ps1`, the fixed-ci.yml loop) | **1 → 0** | — | **run 1: 33/34 exit 1** (`rate-limit.spec.ts`, 90.8 s); DBs re-seeded, **run 2: 34/34 exit 0**; isolated re-run of that spec: **5/5 exit 0** — §14.4 |
| Migrate/backup suite | `pnpm run test:integration:migrate` | 0 | 136 s + 180 s suites | **8/8** |

Battery total: **218/218** — identical to G10-B and the source tree — with
one intermittent HTTP failure recorded honestly (no test excluded, no
assertion weakened).

### 14.2 RELEASING §6 dry-run status — all ten steps

| # | Step | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Gate review (gate 3 must PASS) | **BLOCKED** | gate 3 **FAIL** (simulated payments); gates 8/12 UNVERIFIED; gate 10 PARTIAL — the checklist's first item already stops the release |
| 2 | Working tree clean (commit + push) | **BLOCKED** | ~54 uncommitted entries (G10-A/B/C/D fixes, both reports, pre-existing session work); committing/pushing requires explicit authorization, never given |
| 3 | Remote CI green (`checks` + `integration`) | **BLOCKED (G9)** | no GitHub Actions run has ever executed remotely; local replication (34/34; 218/218) explicitly does not substitute per §6.3 |
| 4 | Version + changelog | **PASS** | root `version 0.1.0` + `license MIT` (G10-C, frozen-install-validated: exit 0, 4 s), `CHANGELOG.md` Keep a Changelog seed, README links — every §6.4 item present |
| 5 | Clean-checkout verification | **PARTIAL — audit sub-item FAILS** | install/migrate/lint/tsc/unit/build/HTTP/migrate-suite all exit 0 (§14.1, 218/218); **`pnpm audit --prod` exit 1 with 3 records** — §6.5 demands exit 0 at release, and its "1 low acceptable" acknowledgment no longer covers the two new moderates |
| 6 | Upgrade test N→N+1 | **NOT TESTED** | zero git tags — there is no previous version to install (unchanged) |
| 7 | Release-engineering items (G10-A audit) | **PARTIAL** | workflow + metadata items applied and YAML-validated but **uncommitted** (§13); `CODE_OF_CONDUCT.md` outstanding (G14), explicitly still blocking |
| 8 | Cut the release (authorized tag) | **BLOCKED** | depends on steps 1–7 and on explicit tagging authorization (never given) |
| 9 | Post-release verification | **BLOCKED** | no tag exists to clone |
| 10 | Rollback readiness | **NOT REACHED** | release-time step; prerequisites exist (`UPGRADING.md` rollback path, tested restore drill 8/8, `BACKUPS.md`) but the pre-upgrade backup is a release-time action |

**Dry-run verdict: no release is possible today.** Hard stops: step 1
(gate 3 FAIL), steps 2–3 (authorization + G9), step 5 (audit exit 1);
steps 6/10 untestable/untouched until then.

### 14.3 Finding: production audit drifted 1 → 3 records [RUN]

`pnpm audit --prod` in the fresh copy (2026-11-08) exits **1** with
**3 records (1 low + 2 moderate)** vs the recorded baseline of 1 low:

| Package | Advisory | Severity | Vulnerable / patched | Path |
| --- | --- | --- | --- | --- |
| `glob` | GHSA-3g3m-2fjr-6pw4 — AbortSignal cancellation bypass allows post-timeout filesystem traversal | moderate | ≥9.0.0 ≤14.0.1 / **≥14.0.2** | `apps__backend > @medusajs/cli > glob` |
| `minimatch` | GHSA-g3hv-75wg-m249 | moderate | ≥7.0.0 <11.0.1 / **≥11.0.1** | `apps__backend > @medusajs/cli > glob > minimatch` |
| `deepmerge@4.3.1` | GHSA-gcqx-w48m-w2h4 (known residual, G13) | low | none / none | notification-sendgrid path |

Both new moderates are **live-feed drift** — published upstream after the
Sprint-3 remediation (`docs/SECURITY_ADVISORIES.md` already documents that
the feed moves between runs). Both sit in `@medusajs/cli`'s toolchain
(build/CLI time, not the public HTTP surface) and both **have patched
versions**, but clearing them requires an override/bump of transitive
dependencies — a dependency change, which this session's standing rules
reserve for explicit user approval. **Recorded as a release blocker, not
fixed** (RELEASING §6.5; G13 gap row updated). Raw output:
`%TEMP%\opencode\g10e-audit.txt`. Documented in the G10-E update section of
`docs/SECURITY_ADVISORIES.md`.

Side-observation [RUN]: the pinned **pnpm 10.11.1 itself** emits *"The
'pnpm' field in package.json is no longer read … pnpm.overrides"* — the
warning previously attributed only to the global pnpm 11.8.0. Overrides
demonstrably still applied (lockfile `settings.overrides` populated; audit
3 records, not 36), so no behavior change was observed; the attribution
note in `SECURITY_ADVISORIES.md` was annotated accordingly.

### 14.4 Finding: `rate-limit.spec.ts` is intermittently flaky [RUN]

- Full-suite run #1: **33/34, jest exit 1** — `rate-limit.spec.ts` failed
  after 90.8 s amid `[Search] Failed to seed "product": Transaction query
  already complete` boot errors. The exact failing assertion was **not
  captured** (the harness's output filter dropped it) — recorded honestly
  rather than reconstructed.
- Isolated re-run of the same spec (fresh seed): **5/5, exit 0** (86.5 s).
- Full-suite run #2 after re-seeding all five DBs: **34/34, exit 0**.
- The `[Search] Failed to seed` errors also occur in the **passing** runs
  (4 occurrences in run #2) — recurring boot noise, not the discriminator.

Classification: **intermittent/timing-related, not a deterministic
regression** (0/2 reproduction on retry). Nothing was excluded and no
assertion weakened. Residual risk: a timing-sensitive interaction between
rate limiting and search seeding can fail under load; if it recurs in
remote CI (G9) it needs a root-cause fix, not a retry.

**Resolved at G10-F (§15.3):** the failure was reproduced under a bounded
plan, the exact failing assertion captured (429 → 401 at line 154) and the
root cause established with timestamps — the spec's 15 s shared window
expired during the runner's 19 s per-test database restore under
full-suite load. Fixed in the test layer; 3 green probes post-fix, +1
regression unit test.

### 14.5 Teardown [RUN]

- `openshop_g10e` → `DROP DATABASE` **exit 0**.
- All five HTTP-suite databases self-dropped after the suite runs (verified
  via `pg_database` listing; only pre-existing `openshop_sprint5` + two
  `*_repro_20261028` leftovers remain, untouched).
- Ports 8000/9000: **0 listeners** — never bound during the dry-run.
- Isolated copies kept for reference under `%TEMP%\opencode`:
  `g10b-repro`, `g10e-repro` (safe to delete at any time; they carry no
  secrets).

### 14.6 G10 complete — next

G10-A … G10-E all done. Gate 10 stays **PARTIAL**: the release engineering
now exists on paper *and* has been dry-run-proven end-to-end — but zero
tags/releases, remote CI unverified (G9), gate 3 still FAIL, and the dry-run
itself surfaced the audit blocker. Standing constraints unchanged: nothing
committed, pushed, tagged or triggered; verdict stays **NOT LAUNCH-READY**.
Next: **G2** once sandbox credentials exist (earlier, if authorized: G9
remote verification, G14 CODE_OF_CONDUCT).

---

## 15. G10-F — engineering quality close-out (2026-11-09)

**Status: Completed.** Three workstreams: (A) resolve the G10-E production
audit drift (3 → 1 records) with the smallest safe remediation, validated
in an isolated copy before touching the source tree; (B) root-cause the
intermittent `rate-limit.spec.ts` failure with a bounded, evidence-preserving
experiment plan — reproduced, root-caused and fixed; (C) hash-verify the
`g10e-repro` copy against the source tree with every discrepancy explained.
All work local and uncommitted; verdict stays **NOT LAUNCH-READY** (gate 3
FAIL unchanged); no push/tag/Actions trigger; no test excluded, weakened, or
retried into green.

### 15.1 Pre-flight [RUN]

HEAD `ef471159eb9cdc58c22f2d325ac4d24e00bf12ac`, branch `main` (tracks
origin/main), 0 staged, 27 M + 1 D unstaged, 46 untracked (`git status
--porcelain -uall` = 74 entries; the default view collapses untracked dirs
to 27), 0 tags, no stash. Non-template databases: **9** — `postgres` plus
the 8 named pre-existing leftovers (`openshop_sprint5`, the two
`*_repro_20261028`, four `maison_*`, `beyond_fear_local`), all present and
untouched at teardown. Ports 8000/9000/9100/9101/9102/8457: 0 listeners.
Repro copies present: `g10b-repro`, `g10e-repro` (reference, never
modified). No anomaly vs the recorded baseline.

### 15.2 Workstream A — production audit 3 → 1 records [RUN]

**Advisory verification (authoritative, `api.github.com` advisories API):**

| Package | Advisory | Vulnerable | Patched | CVE / severity |
| --- | --- | --- | --- | --- |
| `glob` | GHSA-3g3m-2fjr-6pw4 | ≥9.0.0 ≤14.0.1 | **≥14.0.2** | CVE-2026-118773, moderate |
| `minimatch` | GHSA-g3hv-75wg-m249 | ≥7.0.0 <11.0.1 | **≥11.0.1** | CVE-2026-118764, moderate (published 2026-10-30) |
| `deepmerge` | GHSA-gcqx-w48m-w2h4 | ≥4.2.0 ≤4.3.1 | **none (`first_patched_version: null`)** | low — **stays tracked** |

Both moderates enter via `@medusajs/cli`'s toolchain (build/CLI time, not
the public HTTP surface). Installed path verified: `apps__backend >
@medusajs/cli > glob@13.0.6 > minimatch@10.2.6` (prod), plus dev-only
`minimatch` instances (`typescript-estree`, `glob@7.2.3`) that the
advisory ranges do not cover (`glob` 7.x is below the ≥9.0.0 floor).

**Remediation chosen (smallest safe):** a *selector* override
`"glob@13.0.6": "^14.0.2"` in **both** `package.json#pnpm.overrides` and
`pnpm-workspace.yaml` (kept in sync per the documented pnpm-10-vs-11 split).
The broad form `"glob": "^14.0.2"` was **rejected**: it also forces
jest/test-exclude/yalc/npm-packlist's `glob@^7.2.3` → 14.0.4 — an unrelated
dev-dependency change touching a line that is not even vulnerable. The
selector replaces only the three Medusa packages' exact `glob@13.0.6` pin;
`glob@14.0.2`'s API was verified compatible before use
(`require('glob').glob.sync` is a function and executes — the exact call
shape at `migrator.js:109`; tested exit 0 in an isolated temp dir), and
upstream evidence exists that `@medusajs/cli` 2.22.3+ itself moved to
`glob@14.0.2` (a Medusa upgrade remains out of scope — investigated,
deferred). `minimatch` ≥11.0.1 comes along transitively via `glob` 14's
`minimatch ^11` range — no second override needed.

**Isolated-copy validation first** (copy `g10f-repro`, robocopy exit 1,
368 files = source count, 0 path differences, no `.env`/`.git` carried):
override applied → `pnpm install` exit 0 → lockfile
`settings.overrides` records `glob@13.0.6: ^14.0.2` → frozen install exit 0
→ **audit exit 1 with exactly 1 record (`deepmerge`)** → fresh DB
`openshop_g10f` + `db:migrate` exit 0 (**proves glob@14 works in the
Medusa migrator at runtime**) → full battery (§15.5) all exit 0. Only then
was the change applied to the source tree: both override files copied
byte-identical from the validated copy (SHA-256 verified), `pnpm install`
exit 0 (lockfile L32 records the selector), `pnpm install --frozen-lockfile`
exit 0, re-audit **exit 1, 1 record (`deepmerge`)**.

**Audit before/after:** G10-E 3 records (2 moderate + 1 low) → **G10-F
1 record (deepmerge low only)**; `deepmerge` is unfixable upstream
(`first_patched_version: null`) and stays tracked in
`docs/SECURITY_ADVISORIES.md` / G13. Nothing was dismissed, filtered, or
downgraded; the CI/release gate (`pnpm audit --prod`, blocking on tag refs)
still honestly exits 1 — as it has since the Sprint-3 remediation — and the
two moderates that fell outside the "1 low acceptable" acknowledgment are
gone.

**Environmental observation (not a repo defect, root cause not pinned):**
every fresh `pnpm install` performed in `%TEMP%\opencode` this session
produced **truncated `node_modules` despite exit 0** — 2213/2224 packages
with fewer files than the source tree (e.g. `next` 1775/7278 files, 105 MB
missing), deterministic across all four Temp copies (g7/g10b/g10e/g10f)
while Downloads trees stay complete (source-tree `next` re-verified
7278/7278 at teardown). The pnpm store was exonerated: store content and
index both complete (7278 index entries for `next`; content SHA-512 paths
present), disk fine, cross-directory hardlinks working. `pnpm install
--force` repaired it (exit 0, `next` 7278/7278) and post-repair
frozen-install + audit re-verified (exit 0 / 1 record). This generalizes
G10-B's one-off `@graphql-tools/utils` under-extraction: **fresh installs
in this environment need a `--force` spot-check; mitigation documented,
root cause open.**

### 15.3 Workstream B — `rate-limit.spec.ts` flake: reproduced, root-caused, fixed [RUN]

**Bounded plan (fixed in advance; stop on first failure; evidence preserved
before any re-run):**

| Attempt | Run | Result | Note |
| --- | --- | --- | --- |
| 1 | battery-B full suite | **34/34, exit 0** | rate-limit 80.4 s |
| 2 | full suite | 5/34, exit 1 — **invalid as a flake probe** | four suites failed with the exact G10-A missing-seed signatures (`deTaxRegions.length`, `regions[0].id`) while rate-limit passed; cause: the runner self-drops the suite DBs after each run and the loop did not re-seed (ci.yml provisions fresh seeded DBs per run). Recorded as a re-demonstration of the G10-A seed gap; evidence `g10f-EVIDENCE-attempt2.log` (850,730 B); plan amended (documented) to re-run ci-prep before every attempt |
| 3 | full suite (re-seeded) | **34/34, exit 0** | rate-limit took 4603 s: its app boot hit knex `Connection Error: Connection ended unexpectedly` and recovered after a 4557 s silent gap; tests then passed. Environmental DB-connection instability under load (evidence `g10f-r3.log`) |
| 4 | full suite (re-seeded) | **1 failed/33 passed, exit 1 — FAILURE REPRODUCED** | `rate-limit.spec.ts` 81.6 s; full log preserved BEFORE any re-run: `g10f-EVIDENCE-attempt4.log` |

**First failing assertion (verbatim from the preserved log):** test
*"3. answers 429 with retry info once the limit is exceeded"* at
`rate-limit.spec.ts:154:30` — `expect(blocked.status).toBe(429)` →
**Expected: 429, Received: 401**.

**Root cause (H1 confirmed with timestamps from the app's own console
capture):** the limiter's fixed window was 15 s and tests 1-3 share one
budget; the runner's per-test database restore + workflow wait took **19 s**
between tests 1 and 2 under full-suite parallel load (02:46:02 → 02:46:21),
so the window expired (02:46:17) before test 3's request (02:46:24) — the
bucket reset, authentication processed the wrong password, and the expected
429 arrived as a 401. The search-seed `Transaction query already complete`
errors are load symptoms present in passing runs too, not the discriminator;
the discriminator is the 19 s gap vs the 15 s window. 1 failure in 4
pre-fix attempts (matching G10-E's 1-in-2 observation); isolated and
light-load runs always finished tests 1-3 inside 15 s.

**Fix (test layer only — the product limiter was not defective; its unit
suite was already green and its documented behavior is exactly what
happened):**

- `rate-limit.spec.ts` restructured **in the isolated copy first**,
  validated, then mirrored byte-identically to the source tree
  (SHA-256 verified): tests 1-3 keep their shared budget but on
  `/auth/user/emailpass` (wrong password → 401) with `AUTH_WINDOW_MS`
  15000 → **300000** (5 min ≈ 15× the worst observed gap; any gap large
  enough to exceed it would trip jest's own per-test timeouts first).
  Test 3's Retry-After bound is computed from the constant, so it scales
  (≤300 s) — no assertion changed. Test 4 now proves expiry **entirely
  inside one test**: exhaust a fresh bucket on the never-before-used
  customer route under a short window (`EXPIRY_WINDOW_MS=10000`, read per
  request by design), assert it blocks (429 + remaining 0 — a *new*
  pre-state assertion), sleep past the stamped `resetAt`, assert
  401 + fresh remaining + no `Retry-After` — no runner DB-restore gap can
  sit between the exhaust and the check any more. Test 5 unchanged
  (its login bucket always has headroom). **No assertion removed, one
  added, no timeout raised (all stay 120 s), test count stays 5, zero
  product-code changes.**
- Regression unit test added to `auth-rate-limit.unit.spec.ts`:
  *"expires a bucket by the resetAt stamped at creation, not by a later
  window change"* — pins the invariant that made the redesign necessary
  (a live bucket keeps its stamped `resetAt` when the per-request window
  config is retuned).

**Validation (all exit 0):** unit 90/90 (89 + the new test), isolated
rate-limit 5/5 (56.8 s), full suite 34/34 twice with ci-prep re-seeding,
backend `tsc --noEmit` 0 (edited spec type-checks; spec files are
eslint-ignored by pre-existing config, product file lints clean). Post-fix:
3 green probes vs 1 failure in 4 pre-fix probes — the timing dependency was
**removed**, not hidden. Full evidence chain:
`%TEMP%\opencode\g10f-workstream-b-record.txt`.

### 15.4 Workstream C — `g10e-repro` vs source tree: PASS [RUN]

Path + SHA-256 inventory (`g10f-compare.ps1` → `g10f-compare.txt`) after
explicit exclusions (dirs `.git`, `node_modules`, `.medusa`, `.next`,
`.turbo`, `.local-logs`, `backups`; files `.env`, `*.tsbuildinfo`):
**368 vs 368 files — 362 identical, 6 differ, 0 only-source, 0 only-copy.**
The 6 are exactly the G10-E doc files edited in the source tree *after* the
copy was made. Delta verification (`g10f-c-delta-verification.txt`):
line-set comparison per file shows every removed line is a line G10-E
rewrote (old audit counts, gate-10 rows, verdict/next-step lines) and every
added line carries G10-E content (glob/minimatch tables, GHSA IDs,
§14 sections) — no unrelated content in either direction. **Discrepancies
fully explained; neither copy modified.** `.env.template` and workflows,
docs, manifests, lockfiles and tests were all inside the compared set (not
silently ignored).

### 15.5 Combined regression battery (exact exit codes)

**Isolated copy `g10f-repro` (remediation applied):**

| Step | Result |
| --- | --- |
| backend build (direct) / storefront build (direct, CI origin) | **0 / 0** |
| `tsc --noEmit` backend / storefront | **0 / 0** |
| root turbo build run 1 / run 2 | **0** (2 cache-miss) / **0** (2 cache-hit, 0 miss) — `.turbo` excluded from the copy, so run 1 was cold |
| root lint | **0** (4 pre-existing warnings, 0 errors) |
| backend unit / storefront vitest | **0 — 89/89** / **0 — 87/87** |
| prep (fresh DB + `.env` + `db:migrate`) / ci-prep (five suite DBs) | **0 / 0** |
| HTTP suite (five files) | **0 — 34/34** (rate-limit PASS) |
| migrate/backup suite | **0 — 8/8** |
| Workstream B attempts 1-4 | see §15.3 table (1 invalid-harness, 1 reproduced failure, 2 green) |
| Fix validation: unit / isolated / full ×2 | **0 — 90/90** / **0 — 5/5** / **0 — 34/34**, **0 — 34/34** |

**Source tree (post-mirror + post-remediation):**

| Step | Result |
| --- | --- |
| `pnpm install` (pinned 10.11.1) / `--frozen-lockfile` | **0 / 0** (lockfile L32 records `glob@13.0.6: ^14.0.2`) |
| `pnpm audit --prod` | **1 — exactly 1 record (`deepmerge` low)**; was 3 at G10-E |
| `tsc --noEmit` backend / storefront | **0 / 0** |
| root lint | **0** (4 pre-existing warnings) |
| backend unit / storefront vitest | **0 — 90/90** / **0 — 87/87** |
| root turbo build run 1 / run 2 | **0** (2 miss — lockfile changed) / **0** (2 hit, 0 miss) |
| ci-prep (five suite DBs) / HTTP suite | **0 / 0 — 34/34** (rate-limit PASS 60.8 s) |
| migrate/backup suite | **0 — 8/8** |

Source-tree total: **219/219** (90 + 87 + 34 + 8) — the 218 baseline plus
the one new regression unit test. No skipped test counted as passing; no
claim of a clean audit while advisories remain (1 remains, documented); no
remote CI verification claimed anywhere (G9 still pending).

### 15.6 Teardown [RUN]

- `openshop_g10f` → `DROP DATABASE` **exit 0**; all five HTTP-suite DBs
  self-dropped after the runs (verified via `pg_database`: only the 8
  pre-existing leftovers + `postgres` remain, every named baseline DB
  present and untouched).
- Ports 8000/9000: **0 listeners** — never bound.
- Isolated copies kept under `%TEMP%\opencode` (no secrets; `g10e-repro`
  untouched as the Workstream C reference): `g7-clean`, `g10b-repro`,
  `g10e-repro`, `g10f-repro`.
- Credentials never printed; audit/test harnesses parse `.env` in-process.

### 15.7 Gate impact and next

- **Audit blocker from G10-E §14.3 is cleared** (3 → 1 records; the
  remaining low is the documented, unfixable `deepmerge` already covered
  by the "1 low acceptable" acknowledgment). RELEASING §6.5's audit
  sub-item returns to its pre-G10-E state: honestly non-zero, one
  acknowledged low — the two moderates that had pushed it out of
  acknowledgment are gone.
- The intermittent `rate-limit.spec.ts` risk is **root-caused and fixed**
  (was: unresolved risk carried from G10-E).
- Gates otherwise unchanged: 1/5/6/7/9 PASS (local), 2/4/11 PARTIAL,
  **3 FAIL**, 8/12 UNVERIFIED, 10 PARTIAL. Verdict: **NOT LAUNCH-READY**.
- Standing constraints unchanged: nothing committed, pushed, tagged or
  triggered. Next: **G2** once sandbox credentials exist (earlier, if
  authorized: G9 remote verification, G14 CODE_OF_CONDUCT).

---

## 16. G2 - payment integration layer (2026-11-12)

Milestone selection: **G2** with **Stripe as the first reference provider**
(user decision). Everything below ran locally with **no Stripe credentials
anywhere** — the sandbox run (G2-G) remains BLOCKED and is recorded as
such in `docs/G2_SANDBOX_VALIDATION.md`; nothing in this section claims a
real-provider transaction.

### 16.1 Phase 0 pre-flight and audit-first order

- Pre-flight verified the pre-existing state before any edit: HEAD
  `ef471159eb9cdc58c22f2d325ac4d24e00bf12ac` (= origin/main), 74 working-tree
  entries (27 modified + 1 deleted + 46 untracked files, counted per-file),
  0 tags, 0 stash. No commit/push/tag/reset/stash/clean/rebase was performed
  at any point; the tree was never forced back to old counts.
- **Audit before code** (read-only): `docs/G2_PAYMENT_ARCHITECTURE_AUDIT.md`
  (component map, gap assessment, verified official Stripe support in the
  installed 2.21.2 packages, 16-area provider contract, approved 9-item
  plan) and `docs/G2_PROVIDER_SUPPORT_MATRIX.md` (Stripe/PayPal/Adyen/
  Razorpay/Cashfree availability from dated official sources; India
  eligibility noted; **no universal-availability claims**). Implementation
  started only after both documents existed.
- Dependency: `@medusajs/payment-stripe@2.21.2` added as a direct dep of
  `apps/backend` at the exact installed version (lockfile resolution
  already present; **no Medusa upgrade, no unrelated version change**).

### 16.2 What was built (details: `docs/PAYMENTS.md` §G2)

1. **Official Stripe provider** registered from `medusa-config.ts` only
   when `STRIPE_API_KEY` exists (container key `pp_stripe_stripe`); no
   simulator fallback in any code path; `validate-env.ts` payment rules
   (live key ⇒ production + `STRIPE_MODE=live`; API key without webhook
   secret ⇒ hard error; simulator-secret rules; production +
   `ENABLE_SIM_PAYMENT_PROVIDER` without secret ⇒ hard error);
   `.env.template` payment block.
2. **Payment simulator** `pp_sim-payment_default` — separate module from
   `dev-payment` (G5 untouched), same `AbstractPaymentProvider` contract,
   deterministic scenarios (decline/pending/timeout/requires_more/
   provider_drift), integer minor-unit math only, `simulated: true` stamps,
   production refusal, Stripe-style `t=…,v1=…` signed webhooks with a 300 s
   replay window.
3. **Provider-neutral webhook pipeline** `POST /webhooks/:provider` —
   raw-body preserved, verify-first (400 bad signature / 404 unknown
   provider, nothing journaled), insert-first dedup on unique
   `(provider, event_id)` in the new **payment-events journal** (same DB),
   duplicate ⇒ 200 `{received, duplicate}`, in-flight ⇒ 409 not applied,
   stale/out-of-order ⇒ acknowledged `not_supported` with zero money-state
   change, apply failure ⇒ journal `failed` + 500 (retryable), success ⇒
   official `processPaymentWorkflow` (order recovery from pending carts).
4. **Reconciliation** `POST /admin/payments/:id/reconcile` — local vs
   provider view classified (`in_sync`/`status_mismatch`/
   `capture_mismatch`/`amount_mismatch`/`provider_error`), every run
   journaled with a unique `rec_*` id (repeat-safe), **never mutates state,
   never auto-charges**.
5. **Provider-neutral contract** `runPaymentProviderContract` — 13 ordered
   checks; full run vs the simulator; broken-provider negatives (double
   capture, decline-becomes-success) prove the guards; Stripe runs the
   offline subset only (G2-G owns the end-to-end run).
6. **Storefront/admin** — `pp_sim-payment_default` labelled "Simulated
   Payment (test only)" via `isTestPayment`/`isSimPayment`; provider list
   stays region-scoped and fetched live; no secrets in frontend/admin; no
   hard-coded Stripe.

### 16.3 Commands and exit codes [RUN] — full detail in `docs/G2_PAYMENT_TESTING.md`

| Command (cwd) | Exit | Result |
| --- | --- | --- |
| `pnpm exec tsc --noEmit -p tsconfig.json` (`apps/backend`) | **0** | 0 errors |
| `pnpm run test:unit` (`apps/backend`) | **0** | **171/171** (was 90 at G10-F) |
| `%TEMP%\opencode\regression-prep.ps1` (six suite DBs) | **0** | all six created + migrated + seeded |
| `pnpm run test:integration:http` (`apps/backend`, DB_* env) | **0** | **47/47**, 6 suites (was 34) |
| `pnpm run test:integration:migrate` (`apps/backend`) | **0** | **8/8** |
| `pnpm run test` (`apps/storefront`) | **0** | **87/87** |
| `pnpm run lint` (root) | **0** | backend 0 errors / 22 warnings (advisory), storefront 2 (pre-existing) |
| `NEXT_PUBLIC_BASE_URL=https://ci-build.example pnpm run build` (`apps/storefront`) | **0** | build complete |

Source-tree total: **313/313** (219 at G10-F → +94 G2 tests). No test
skipped, disabled, or weakened.

### 16.4 Bugs found and fixed during bring-up (failure evidence preserved)

The first `g2-payment` HTTP run failed **5/13** (exit 1); two real bugs
were fixed (never papered over), then 13/13 and 47/47:

1. `findEvent` used an invalid list shape (`{where: …, take: 1}`) —
   Medusa list methods are `list(filters, config)`; fixed, plus a comment
   pinning the rule.
2. `isDuplicateKeyError` missed Medusa DAL's `dbErrorMapper` output (raw
   Postgres 23505 is rewritten to a `MedusaError INVALID_DATA
   "…already exists."` with no `code`/`constraint`), so duplicate/in-flight
   deliveries answered 500 instead of 200-duplicate/409; fixed and pinned
   with +5 unit tests covering all three error shapes and false positives.

First-run failure output preserved at
`%TEMP%\opencode\g2-http-run1-fail-5of13.out`.

### 16.5 Working tree, teardown, evidence

- HEAD unchanged (`ef471159…`); tracked changes still 27 modified + 1
  deleted (identical set to baseline); untracked files 46 → 70 (**+24 G2
  files**); nothing staged, nothing committed.
- After the runs `pg_database` shows only the **8 pre-existing databases**
  (identical to G10-F teardown) — all six suite DBs self-dropped by the
  runner; ports 8000/9000: **0 listeners**; credentials parsed
  in-process, never printed.
- Prep/evidence scripts kept under `%TEMP%\opencode` (`g2-prep.ps1`,
  `regression-prep.ps1`, `g2-evidence.ps1`).

### 16.6 Gate impact and next

- **Gate 3 stays FAIL** — the official provider is wired but unvalidated
  (G2-G BLOCKED/NOT TESTED; a simulated success is not a payment
  integration). Gate 9 → **313 tests** locally; gates 1/5/6/7 PASS (local),
  2/4/11 PARTIAL, 8/12 UNVERIFIED, 10 PARTIAL. Verdict:
  **NOT LAUNCH-READY**.
- New docs: `docs/G2_PAYMENT_ARCHITECTURE_AUDIT.md`,
  `docs/G2_PROVIDER_SUPPORT_MATRIX.md`, `docs/G2_PAYMENT_TESTING.md`,
  `docs/G2_SANDBOX_VALIDATION.md`, `docs/G2_COMPLETION_REPORT.md`
  (per-gate G2-A…G2-H verdicts with commands/exit codes);
  `docs/PAYMENTS.md` §G2.
- Standing constraints unchanged: nothing committed, pushed, tagged or
  triggered. Next: **G2-G** once sandbox credentials exist (earlier, if
  authorized: G9 remote verification, G14 CODE_OF_CONDUCT).
