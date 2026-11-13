# Changelog

All notable changes to this project are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html),
policy defined in [docs/RELEASING.md](docs/RELEASING.md).

**Release status: no versioned release has been tagged yet.** The repository
has zero git tags as of 2026-11-13; versioning starts at `0.1.0` per
docs/RELEASING.md §2, and entries accumulate under `[Unreleased]` until the
first tag. Claims below carry evidence tags: `[RUN]` = executed locally with
a recorded exit code (roadmap/readiness reports), `[SRC]` = read from source
only, `[NOT TESTED]` = explicitly untested. A claim without a tag is
documentation-level (source-read).

## [Unreleased] — snapshot of 2026-11-13

Work staged on top of the upstream Medusa DTC Starter (attribution in
README). Detailed records: `openshop-master-roadmap.md`,
`openshop-global-launch-readiness-report.md`.

### Added

- Backup and tested restoration: `db-backup.js` / `db-restore.js` (pg_dump
  custom format, no-overwrite guards), 6-test restore drill, `docs/BACKUPS.md`
  `[RUN: migrate suite 8/8, exit 0]`.
- Production SEO foundation: canonical/OG metadata, sitemap, robots, and a
  build-time guard that rejects loopback `NEXT_PUBLIC_BASE_URL` in production
  builds `[RUN: guard observed rejecting exit 1, then passing with a public
  origin — G10-B]`.
- Merchant tax configuration path documented end-to-end (`docs/TAX.md`) with
  admin-API validation and actionable errors `[RUN]`.
- Development payment provider (test-only, simulated; refuses production
  without an explicit flag; no webhook surface) — `docs/PAYMENTS.md`
  `[RUN: 41 unit + 9 HTTP tests]`. **It does not satisfy the "real
  payments" launch gate** (see Known issues).
- Payment integration layer (G2, 2026-11-12): official
  `@medusajs/payment-stripe@2.21.2` provider (registers only when
  `STRIPE_API_KEY` is set — no simulator fallback in any code path),
  credential-free deterministic payment simulator `pp_sim-payment_default`
  (signed webhooks, integer minor-unit math, `simulated: true` stamps),
  provider-neutral webhook pipeline with insert-first journal dedup
  (duplicate 200 / in-flight 409 / out-of-order no-write / failure 500),
  reconciliation that never auto-charges, 13-check provider-neutral
  contract, payment config validation — `docs/PAYMENTS.md` §G2,
  `docs/G2_*.md` `[RUN: 313/313 local — 171 unit + 87 storefront + 47 HTTP
  (13 of them g2-payment) + 8 migrate, all exit 0]`. **The real Stripe
  sandbox run (G2-G) is BLOCKED/NOT TESTED — no credentials exist; Gate 3
  stays FAIL** (see Known issues).
- Deployment documentation from a tested clean installation:
  `docs/DEPLOYMENT.md`, `docs/UPGRADING.md` `[RUN: every step's exit code
  recorded]`.
- CI `integration` job (Postgres service, six pre-created and pre-migrated
  suite databases, HTTP + migration suites) — committed and pushed at G9
  (`9642f05`); locally replicated 34/34 (five suites, pre-G2) and 47/47
  (six suites, post-G2) `[RUN]`; **remotely verified green: run
  43197912861, all 3 jobs success, 2026-11-12 `[RUN — GitHub Actions
  API]`**.
- Release engineering (this stage, G10-C): `CHANGELOG.md` (this file),
  `docs/RELEASING.md` (versioning + support policy + pre-release checklist),
  root `package.json` `version` (`0.1.0`) and `license` (`MIT`) fields.
- Security advisories record and dependency overrides: `docs/SECURITY_ADVISORIES.md`
  (sharp, proxy-addr, grpc-js, body-parser, compression, follow-redirects,
  lodash, multer and others pinned via `pnpm-workspace.yaml` overrides)
  `[SRC]`.

### Fixed

- CI five-suite migration gap: the workflow now creates and pre-migrates
  **all six** HTTP-suite databases (sixth = `openshop_g2_payment`, added
  with G2); the pre-fix state was reproduced at
  15/34, exit 1 and the fixed state at 34/34, exit 0 (five suites, then
  47/47 with six) — **committed at G9 (`9642f05`), remote run green**
  `[RUN]`.
- `turbo.json` `build.outputs`: backend artifacts (`.medusa/**`) were never
  archived; a cache hit used to restore nothing (control-proven). Fixed with
  `.medusa/**`, `.next/**`, `dist/**` plus cache-dir exclusions —
  **committed at G9 (`9642f05`), remote run green** `[RUN: cache restore verified file-for-file against cache
  manifests]`.
- Root `build` script (`pnpm -r build`) bypassed Turborepo entirely, so the
  documented `pnpm run build` never hashed or cached anything; now
  `turbo build` — **committed at G9 (`9642f05`), remote run green** `[RUN]`.
- Frozen-install reproducibility caveat: one package under-extracted on a
  first pass (`@graphql-tools/utils`), corrected by
  `pnpm install --frozen-lockfile --force` `[RUN]` — root cause unresolved,
  mitigation documented in docs/RELEASING.md §7.
- G10-F: production audit reduced from 3 advisory records to **1** by the
  selector override `"glob@13.0.6": "^14.0.2"` (root `package.json` +
  `pnpm-workspace.yaml`, kept in sync) — clears `glob`
  GHSA-3g3m-2fjr-6pw4 and `minimatch` GHSA-g3hv-75wg-m249 (both via
  `@medusajs/cli`); validated in an isolated copy first, then the source
  tree (frozen install 0, builds/lint/tsc/tests all green) — **committed at G9 (`9642f05`), remote run green**
  `[RUN]`.
- G10-F: intermittent `rate-limit.spec.ts` failure root-caused and fixed
  in the test layer: the spec's 15 s shared rate-limit window expired
  during the runner's 19 s per-test database restore under full-suite
  load, turning test 3's expected 429 into 401 (failure reproduced once,
  full log preserved). Restructured so tests 1-3 use a 5-minute window and
  the expiry proof runs entirely inside one test; 1 regression unit test
  added (218 → 219 tests). No assertion removed, no timeout raised, no
  product code changed — **committed at G9 (`9642f05`), remote run green** `[RUN: 3 green probes post-fix]`.

### Known issues (open at this snapshot)

- **No validated real payment provider** — the official Stripe provider is
  wired end-to-end (G2) but **G2-G (real Stripe sandbox validation) is
  BLOCKED / NOT TESTED: no credentials exist**; checkout still runs on
  simulated/test providers only, so the "real payments safely" launch
  gate is **FAIL** `[SRC/RUN]`.
- ~~No GitHub Actions run has ever executed remotely~~ — **resolved at
  G9 (2026-11-12): run 43197912861 green, all 3 jobs
  `[RUN — GitHub Actions API]`**.
- `pnpm audit --prod`: **1 advisory record as of the G10-F remediation
  (2026-11-09)** — the known unfixable low (`deepmerge@4.3.1`,
  `first_patched_version: null`). History: 1 → 3 at the G10-E re-run (two
  moderates published upstream afterwards: `glob` GHSA-3g3m-2fjr-6pw4 and
  `minimatch` GHSA-g3hv-75wg-m249, both via `@medusajs/cli`) → back to 1
  when the approved selector override was applied at G10-F (see Fixed);
  the CI audit step remains non-blocking except on release tags (release
  policy requires blocking it at release time — docs/RELEASING.md §6) `[RUN]`.
- `@graphql-tools/utils` first-pass under-extraction on frozen install is
  **intermittent**: reproduced at G10-B (needed `--force`), **not**
  reproduced at G10-E (clean exit 0) — root cause unresolved, mitigation
  documented in docs/RELEASING.md §7 `[RUN]`.
- No N→N+1 upgrade test (single version only) `[NOT TESTED]`;
  reverse proxy/TLS/process manager `[NOT TESTED]`.

<!-- Link definitions -->
[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html
