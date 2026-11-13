# Releasing OpenShop — versioning, support and release policy

This document is the release policy: how versions are chosen, what is
supported, and the checklist that must be completed before any tag is cut.
Companion documents: [CHANGELOG.md](../CHANGELOG.md) (what changed),
[UPGRADING.md](UPGRADING.md) (upgrade/rollback runbook),
[DEPLOYMENT.md](DEPLOYMENT.md) (operations), [SECURITY.md](../SECURITY.md)
(vulnerability reporting).

Honesty convention used below: **[TESTED — exit code]** = executed locally
with a recorded exit code; **[NOT TESTED]** = explicitly not executed;
**[SRC]** = read from source/config only.

## 1. Current status (2026-11-07)

**There have been no releases.** The repository has zero git tags, no GitHub
Releases, and `package.json` only just gained a `version` field (G10-C,
uncommitted like all current work). Additionally, **no GitHub Actions run has
ever executed remotely** — CI correctness was proven only by local
replication [TESTED — 34/34 and 15/34, roadmap §10].

Consequences that are policy, not accident:

- No tag may be cut while launch **gate 3 (real payments) is FAIL** —
  a first public release implies a payment story it does not have.
- No tag may be cut before the remote CI verification (G9) is green.
- Everything in §6 marked "outstanding" must be closed first.

## 2. Versioning policy

- **Semantic Versioning.** The source of truth is the root
  `package.json` `version` field; the git tag `vX.Y.Z` must equal it
  exactly at release time (the checklist verifies this).
- **0.x until the launch gates pass.** The seeded value is `0.1.0`.
  While `major = 0`:
  - MINOR = new capability (new endpoints, workflows, storefront features),
  - PATCH = fixes (correctness, security, performance) with no intended
    API/schema change,
  - breaking changes are allowed in MINOR but **must** be called out in
    CHANGELOG.md with a migration pointer to UPGRADING.md.
- **1.0.0 eligibility** (all required): gate 3 PASS with a verified sandbox
  gateway; this checklist executed end-to-end once; an N→N+1 upgrade test
  recorded; remote CI green on the release commit.
- **Database migrations are append-only** (never edit a migration that may
  have run — see AGENTS.md); every release that adds migrations must state
  the upgrade command (`pnpm run db:migrate`) and its tested idempotency
  [TESTED — exit 0 twice, roadmap §9].

## 3. Tagging and publishing rules

- Annotated tag on `main`, format `vX.Y.Z` (no `latest` floating tags).
- **Tags, pushes and GitHub Releases require explicit authorization** in
  this project's working sessions; the checklist is executed, then asked.
- GitHub Release notes are taken verbatim from the CHANGELOG section for
  that version.
- A published release is never silently edited: mistakes get a new PATCH
  release. Yanking means a GitHub Release marked "withdrawn" plus a
  CHANGELOG note — the tag stays for auditability.

## 4. Supported versions

- **Latest release only.** Earlier versions receive no backports.
- Security fixes ship as PATCH releases on the latest version
  ([SECURITY.md](../SECURITY.md) defines reporting; advisory history lives
  in [SECURITY_ADVISORIES.md](SECURITY_ADVISORIES.md)).
- Runtime support matrix:
  - Node.js: `>=22.22.0` (root `engines`) [SRC]. **Skew resolved at G10-D:**
    CI's `checks` job now runs a matrix of `22.22.0` (the declared floor)
    and `24` (the line every local record ran on, v24.17.0); the
    `integration` job pins `24` [SRC — YAML-validated locally, **remote run
    green at G9: run 43197912861, both matrix legs success, 2026-11-12,
    roadmap §17**]. Node 22.22.0 has **no recorded local run** [NOT TESTED
    locally] — its CI matrix leg is now the recorded evidence (success).
  - PostgreSQL: 17 is what all local verification ran on [TESTED]; CI's
    service image is now `postgres:17-alpine` — **aligned at G10-D**
    (was 16-alpine) [SRC — YAML-validated, **remotely verified green at G9
    (run 43197912861, integration job success on postgres:17-alpine)**].
  - Package manager: pnpm **10.11.1** exactly (root `packageManager` pin);
    other package managers are not supported (never introduce a second
    lockfile).
- Unsupported: any version older than the latest tag at that time.

## 5. Changelog policy

- Keep a Changelog format; the `[Unreleased]` section accumulates as work
  lands, subdivided into Added / Changed / Fixed / Known issues.
- Every entry must be evidence-tagged (`[RUN]`, `[SRC]`, `[NOT TESTED]`) —
  a release note may never claim more than the recorded runs prove.
- At release: `[Unreleased]` becomes `## [X.Y.Z] — YYYY-MM-DD`, a fresh
  empty `[Unreleased]` opens above it, same day.

## 6. Pre-release checklist (blocking, in order)

Every item is pass/fail; a single fail stops the release.

1. **Gate review:** launch gates read from the readiness report; **gate 3
   must be PASS** (currently FAIL — G2). Gates 8/10/12 must not be
   UNVERIFIED/FAIL without an explicit, recorded acceptance.
2. **Working tree clean:** all current uncommitted work (G10-A CI fix,
   G10-B turbo fixes, G10-C docs, and the pre-existing session changes)
   committed — requires authorization — and pushed.
3. **Remote CI green:** GitHub Actions run on the release commit, `checks`
   **and** `integration` jobs both green (G9). Local replication
   [TESTED — 34/34] does not substitute.
4. **Version + changelog:** bump root `package.json` `version`; reorganize
   CHANGELOG.md per §5; README release references still correct.
5. **Clean-checkout verification** (from a fresh clone into a temporary
   directory, no reused state):
   - `pnpm install --frozen-lockfile` → exit 0. If any
     `Cannot find module` oddity appears, re-run with `--force` and file it
     (a package once under-extracted on Windows — G10-B, root cause open).
   - `pnpm run lint`, both `tsc --noEmit`, both unit suites → exit 0
     (baseline: 313/313 total with the integration suites; 171 backend
     unit + 87 storefront + 47 HTTP + 8 migration/backup — G2, 2026-11-12).
   - Fresh database: `pnpm run db:migrate` → exit 0.
   - HTTP suites (six databases pre-created and pre-migrated — the
     `ci.yml` loop) +
     migration suite → exit 0.
   - `pnpm run build` with `NEXT_PUBLIC_BASE_URL` set to the **public
     origin** → exit 0 (loopback is rejected by design, exit 1).
   - `pnpm audit --prod` → **must be exit 0 for release**. The CI step's
     `continue-on-error: true` is for development only; a release run
     executes it blocking (§7 item 5). Known acceptable: 1 low advisory
     with no available patch — must be explicitly acknowledged in the
     release notes. **G10-E dry-run (2026-11-08): exit 1 with 3 records** — the
     unfixable low plus **2 new moderates** published upstream since the
     Sprint-3 remediation (`glob` GHSA-3g3m-2fjr-6pw4, `minimatch`
     GHSA-g3hv-75wg-m249, both via `@medusajs/cli`); they fell **outside**
     the "1 low acceptable" acknowledgment and blocked release. **G10-F
     (2026-11-09): both moderates remediated** with the approved selector
     override `"glob@13.0.6": "^14.0.2"` (smallest-safe, validated in an
     isolated copy first — roadmap §15.2) → **exit 1 with exactly 1 record,
     the acknowledged unfixable `deepmerge` low**, i.e. back within the
     known-acceptable state (acknowledgment still required in release
     notes; the exit code is still honestly non-zero). See
     [SECURITY_ADVISORIES.md](SECURITY_ADVISORIES.md).
6. **Upgrade test N→N+1** [currently NOT TESTED — single version only]:
   install previous tag, migrate, back up, upgrade, verify data intact
   (procedure in UPGRADING.md).
7. **Release-engineering items from the G10-A audit** — status after
   G10-D (2026-11-07); every applied change was YAML-validated locally
   (js-yaml parse of both workflows), **committed + pushed and remotely
   verified green at G9 (2026-11-12, run 43197912861, roadmap §17)**:
   - [x] `update.yaml`: `actions/checkout@v4`;
     `medusajs/medusa-update-action` pinned to commit
     `02eca016e5b0024bf4ff3beaeff4530bc18fa6e3` (the `v1` target as of
     2026-11-07); top-level `permissions: contents: read`;
     `concurrency: update-medusa` (never cancels); job
     `timeout-minutes: 20`.
   - [x] `ci.yml`: top-level `permissions: contents: read` +
     `concurrency:` (cancels superseded PR runs, never main/tag runs);
     push trigger now includes `v*` tags so releases are verifiable;
     audit step turns **blocking on tag refs**;
     `checks` Node matrix `[22.22.0, 24]`; `integration` on Node 24 +
     `postgres:17-alpine`.
   - [x] Version/CHANGELOG metadata + `license` field (G10-C).
   - [ ] `CODE_OF_CONDUCT.md` still outstanding (routed G14) — **remains
     blocking under this checklist.**
8. **Cut the release:** authorized annotated tag `vX.Y.Z` → push → GitHub
   Release from CHANGELOG → inspect the Actions run for the tag.
9. **Post-release verification:** fresh clone **of the tag** → §5 steps
   1–4 pass → confirm tag == `package.json` version → deploy smoke per
   DEPLOYMENT.md (health/store checks).
10. **Rollback readiness:** UPGRADING.md rollback path re-read for the
    shipped migration set; DB backup taken immediately before any
    production upgrade ([BACKUPS.md](BACKUPS.md)).

## 7. Reproduction requirements (what "verified" means here)

Recorded from the G10-B clean-copy run (roadmap §11); a reviewer
reproducing results needs all of these:

| Requirement | Value / reason |
| --- | --- |
| OS / shell | Windows + PowerShell 5.1 quirks: `$ErrorActionPreference="Stop"` with native `2>&1` throws; `"$var:rest"` parses as a drive reference — use `${var}` |
| Node / pnpm | Node v24.17.0 (>=22.22.0 enforced by `engines`); pnpm 10.11.1 via the `packageManager` pin |
| PostgreSQL | local PG17 for parity with recorded runs (CI aligned to `postgres:17-alpine` at G10-D - skew closed, §4) |
| `NODE_OPTIONS` | `--dns-result-order=ipv4first` |
| `DB_HOST` | `localhost`, never `127.0.0.1` (the latter triggers the test-utils SSL branch against non-SSL Postgres; connections hang) |
| `NEXT_PUBLIC_BASE_URL` | a non-loopback origin at **build** time; the same value must be reused to hit the build cache (different value → cache miss) |
| Suite databases | the five HTTP-suite DBs created and pre-migrated before `test:integration:http` (exact loop: fixed `ci.yml`) |
| Secrets | `.env` files derived from `.env.template`; never printed, never committed |

## 8. Evidence summary

- [TESTED — exit 0] frozen install, migrations, build, lint, typechecks,
  218/218 tests, Turbo cache round-trip with manifest-verified artifact
  restore (G10-B, roadmap §11).
- [TESTED — 34/34 and 15/34] CI configuration replicated locally, fixed
  version and pre-fix version (G10-A, roadmap §10).
- [TESTED — remote, 2026-11-12] GitHub Actions run on `main`
  (G9): run 43197912861 — `checks` (22.22.0) + `checks` (24) +
  `integration` all green in 321 s, incl. the six-suite DB seed step and
  all six HTTP suites (roadmap §17).
- [NOT TESTED] N→N+1 upgrade, any tag cut,
  any release published, reverse proxy/TLS/process manager.
- [SRC] release-workflow hardening in §6 item 7 - applied at G10-D,
  **remotely verified green at G9** (run 43197912861; `CODE_OF_CONDUCT.md`
  absence remains).
- [TESTED - dry-run, 2026-11-08] the full §6 checklist executed as far as
  gates + authorization allow (roadmap §14): every clean-checkout step
  exit 0 (218/218) in a fresh 368-file copy; audit **exit 1 with 3
  records** (§6 item 5 above); steps 1/2/3/8/9 BLOCKED, steps 6/10
  NOT TESTED/NOT REACHED; one **intermittent** `rate-limit.spec.ts`
  failure (33/34 → re-verified 34/34 full-suite and 5/5 isolated; no test
  excluded, no assertion weakened); the G10-B install defect did not
  reproduce. **Root cause and fix recorded at G10-F (below).**
- [TESTED - local, 2026-11-09] G10-F engineering quality close-out
  (roadmap §15): audit remediated **3 → 1 records** (selector override
  `"glob@13.0.6": "^14.0.2"`, validated in an isolated copy first, then
  the source tree — install/frozen/audit exit codes 0/0/1 recorded both
  places); the intermittent `rate-limit.spec.ts` failure **reproduced once
  (attempt 4, 1 failed/33 passed, first failing assertion + timestamps
  preserved), root-caused (15 s window vs the runner's 19 s per-test DB
  restore under full-suite load) and fixed in the test layer** — 3 green
  probes post-fix, +1 regression unit test, **219/219**; `g10e-repro`
  hash-verified against the source tree (368 vs 368, 362 identical,
  6 differ = post-copy G10-E doc edits, 0 unexplained). All runs local —
  no remote CI claimed (G9).
