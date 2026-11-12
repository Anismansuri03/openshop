# Security Advisories — OpenShop dependency audit

> Sprint 3, Task 1. Generated from a fresh `pnpm audit --prod` run against the
> working tree at HEAD `ef471159eb9cdc58c22f2d325ac4d24e00bf12ac` (all changes
> uncommitted). Raw audit outputs are preserved outside the repository at
> `%TEMP%\opencode\sprint3-audit*` (see [Reproducing the audit](#reproducing-the-audit)).

## Summary

| Metric (production dependencies) | Before | After (final) |
| --- | --- | --- |
| Advisory records | **36** | **1** |
| Critical (metadata instances) | 0 | 0 |
| High (metadata instances) | **20** | **0** |
| Moderate (metadata instances) | 15 | 0 |
| Low (metadata instances) | 3 | 1 |
| `pnpm audit --prod` exit code | 1 | 1 (one unfixable low remains) |

Notes on counting: pnpm reports two different numbers. **Advisory records** are
unique GHSA entries in the JSON `advisories` map; **metadata instances** count
every affected resolved version (`metadata.vulnerabilities`). The baseline's 36
records carry 38 instances because `@graphql-tools/utils` advisories affected
two installed versions (10.11.0 and 12.0.0).

Counts drift between runs because the advisory feed is live: Sprint 2 recorded
36 records with metadata `0/20/14/2`; this sprint's baseline was 36 records with
`0/20/15/3` (one new moderate/low pair appeared upstream between sprints).

## How every advisory was remediated

All highs and moderates were fixed **without** upgrading Medusa. The mechanism
is `pnpm.overrides` in the root `package.json` (see
[Override location finding](#override-location-finding-pnpm-10-vs-pnpm-11)),
plus two direct dependency bumps. Batch order and audit results:

| Batch | Change | Records after | Metadata after |
| --- | --- | --- | --- |
| baseline | — | 36 | 0/20/15/3 |
| A | direct bumps: `zod` 4.2.0 → 4.6.7 (backend, exact pin), `qs` ^6.12.1 → ^6.17.0 (storefront) | (included in C) | (included in C) |
| B | overrides written to `pnpm-workspace.yaml` — **did not apply** (see finding below) | 36 | 0/20/15/3 |
| C | 14 same-major overrides moved to `package.json#pnpm.overrides` (grpc-js, body-parser, compression, follow-redirects, lodash, multer, source-map-js, vite, postcss, postcss-selector-parser, ajv@8, brace-expansion@1/@5, graphql-tools/utils@12) | 13 | 0/3/7/3 |
| D | second override set: `zod ^4.6.6`, `fast-uri ^3.1.9`, `qs ^6.16.1`, `uuid ^11.1.1` | 4 | 0/2/1/1 |
| E | ungated `@graphql-tools/utils ^12.0.2` (replaces the 12.x-gated selector) + `@opentelemetry/instrumentation-pg ^0.73.0` | **1** | **0/0/0/1** |

Every batch: `npx pnpm@10.11.1 install` exit 0, followed by a fresh audit.
After the final batch the full gate battery was run (see
[Regression coverage](#regression-coverage)).

## Baseline inventory — all 36 advisory records

Columns: severity · package@installed version · GHSA ID · first safe version ·
direct or transitive · realistic exposure. "Direct" means the package is a
declared dependency of `apps/backend` or `apps/storefront` (audit path length 2);
everything else is transitive. Exposure assessments assume a default OpenShop
deployment (Medusa backend + Next.js storefront, no custom OTLP exporter).

### High severity (18 records / 20 instances) — all fixed

| Package@version | Advisory | First safe | Status | Path (sample) and exposure |
| --- | --- | --- | --- | --- |
| `@graphql-tools/utils@10.11.0,12.0.0` | GHSA-7mx3-vvmw-hjmv (CVE-2026-104852) | ≥12.0.1 | fixed (batch C/E) | `backend > @medusajs/cli > @medusajs/utils > @graphql-codegen/core > utils` — prototype pollution in `mergeDeep`; reachable only through Medusa CLI codegen (build/CLI time), not the public HTTP surface. |
| `@graphql-tools/utils@10.11.0,12.0.0` | GHSA-c4qx-w738-7hr3 (CVE-2026-114604) | ≥12.0.2 | fixed (batch C/E) | same path — `mergeIncrementalResult` prototype pollution; same build/CLI-time exposure. |
| `@grpc/grpc-js@1.14.4` | GHSA-m9gg-hp2v-232j (CVE-2026-101916), CVSS 7.4 | ≥1.14.5 | fixed (batch C) | `backend > @medusajs/cli > @medusajs/deps > sdk-node > exporter-logs-otlp-grpc` — unauthorized-certificate acceptance in `getAuthContext`; only relevant if the OTLP **gRPC** exporter with TLS is configured. Default Medusa telemetry does not use mTLS gRPC → low exposure in default config. |
| `body-parser@1.20.6` | GHSA-27r3-jxmh-p828 (CVE-2026-111181), CVSS 7.5 | ≥1.20.9 | fixed (batch C) | `backend > @medusajs/cli > express > body-parser` — DoS via trailing bytes after a compressed body; the Express body parser fronts public API routes → moderate exposure (availability only). |
| `brace-expansion@1.1.18` | GHSA-qhr7-859c-m2p7 (CVE-2026-102278), CVSS 7.5 | ≥1.1.20 | fixed (batch C) | `backend > @medusajs/medusa > yalc > glob > minimatch` — stack-exhaustion DoS; glob runs over local file trees (CLI/build), not attacker input → low exposure. |
| `brace-expansion@5.0.9` | GHSA-qhr7-859c-m2p7 (CVE-2026-102278), CVSS 7.5 | ≥5.0.11 | fixed (batch C) | `backend > @medusajs/cli > glob > minimatch` — same, CLI-time. |
| `brace-expansion@1.1.18` | GHSA-6j4f-fj2g-mc7p (CVE-2026-102276), CVSS 7.5 | ≥1.1.19 | fixed (batch C) | same yalc/glob path — CLI-time. |
| `brace-expansion@5.0.9` | GHSA-6j4f-fj2g-mc7p (CVE-2026-102276), CVSS 7.5 | ≥1.1.19 (5.x: ≥5.0.10) | fixed (batch C) | `@medusajs/cli > glob` — CLI-time. |
| `compression@1.8.1` | GHSA-vc2v-76pw-4v95 (CVE-2026-87776), CVSS 7.5 | ≥1.8.2 | fixed (batch C) | `backend > @medusajs/framework > compression` — memory-leak DoS on premature response close; middleware on public HTTP → moderate (availability). |
| `follow-redirects@1.16.0` | GHSA-q3jh-wrc6-jgq8 (CVE-2026-111756) | ≥1.16.1 | fixed (batch C) | `backend > @medusajs/cli > @medusajs/telemetry > axios` — array-form headers bypass credential stripping on outbound telemetry requests; attacker would need to control telemetry redirect targets → low-moderate. |
| `follow-redirects@1.16.0` | GHSA-8r9p-f939-6h3c (CVE-2026-111755) | ≥1.16.1 | fixed (batch C) | same path — `sensitiveHeaders` regex escape bug can expose credential headers outbound → low-moderate. |
| `lodash@4.17.23` | GHSA-r5fr-rjxr-66jc (CVE-2026-4800), CVSS 8.1 | ≥4.18.0 | fixed (batch C) | `backend > @medusajs/cli > utils > codegen > plugin-helpers > lodash` — code injection via `_.template` key names; only reachable if codegen renders attacker-controlled template keys (build time) → low. |
| `multer@2.4.0` | GHSA-q7qp-rjg7-q26m (CVE-2026-113872), CVSS 7.5 | ≥2.5.0 | fixed (batch C) | `backend > @medusajs/medusa > multer` — DoS via async fileFilter after request teardown; multipart upload routes (admin product images) → moderate, mostly admin-authenticated. |
| `postcss@8.4.31` | GHSA-6g55-p6wh-862q (CVE-2026-45623), CVSS 7.5 | ≥8.5.12 | fixed (batch C) | `storefront > next > postcss` — arbitrary file read via attacker-controlled `sourceMappingURL` **in CSS comments**; postcss runs at build time → exposure limited to build machines processing untrusted CSS. |
| `postcss@8.4.31` | GHSA-r28c-9q8g-f849 (CVE-2026-73646), CVSS 7.5 | ≥8.5.18 | fixed (batch C) | same build-time path — path traversal in source-map auto-loading. |
| `source-map-js@1.2.1` | GHSA-68fv-2mgg-jv7q (CVE-2026-93749), CVSS 7.5 | ≥1.2.2 | fixed (batch C) | `backend > framework > types > vite > postcss > source-map-js` — event-loop DoS on indexed map offsets; build/dev-time → low. |
| `vite@7.3.6` | GHSA-587h-7wmj-h5pm (CVE-2026-112942) | ≥7.3.7 | fixed (batch C) | `backend > framework > types > vite` — `launch-editor` existence-check bypass on Windows; Vite runs in `medusa develop`/build, not `medusa start` → dev-time exposure only. |
| `zod@4.2.0` | GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404), CVSS 7.5 | ≥4.6.6 | fixed (batch A direct + batch D override) | **direct** `backend > zod` — memory exhaustion validating oversized collections. The declared `zod` is **never imported** anywhere in backend source (verified by recursive grep), so direct exposure was nil; the advisory nonetheless also matched the `@medusajs/admin-sdk` transitive instance, which batch D's override cleared. |

### Moderate severity (15 records) — all fixed

| Package@version | Advisory | First safe | Status | Path and exposure |
| --- | --- | --- | --- | --- |
| `@opentelemetry/instrumentation-pg@0.52.0` | GHSA-qqmp-wf37-98f9 (CVE-2026-104872), CVSS 5.8 | ≥0.73.0 | fixed (batch E) | `backend > @medusajs/cli > @medusajs/deps` — unconditional `db.user` span attribute leaks the DB username into traces; only visible when traces are exported to a backend → low-moderate (default deployment exports no spans). |
| `ajv@8.13.0` | GHSA-2g4f-4pwh-qvx6 (CVE-2025-69873) | ≥8.18.0 | fixed (batch C) | `backend > cli > deps > mikro-orm/migrations > umzug > rushstack… > ajv` — ReDoS with `$data` option; migration CLI, `$data` unused → low. |
| `brace-expansion@1.1.18` / `@5.0.9` | GHSA-q2hr-2g5m-vwhr (CVE-2026-102277), CVSS 5.3 | ≥1.1.21 / ≥5.0.12 | fixed (batch C) | same glob/minimatch CLI paths as the highs — CPU DoS → low (CLI-time). |
| `lodash@4.17.23` | GHSA-f23m-r3pf-42rh (CVE-2026-2950), CVSS 6.5 | ≥4.18.0 | fixed (batch C) | same codegen path — prototype pollution via `_.unset`/`_.omit` array paths → build-time. |
| `postcss@8.4.31` | GHSA-qx2v-qp2m-jg93 (CVE-2026-41305), CVSS 6.1 | ≥8.5.10 | fixed (batch C) | storefront build path — XSS via unescaped `</style>` in stringify output; build-time, output is our own CSS → low. |
| `postcss@8.4.31` | GHSA-fxqj-rqcc-2cmp (CVE-2026-69153) | ≥8.5.23 (incomplete-fix follow-up) | fixed (batch C) | storefront build path — incomplete fix of GHSA-6g55-p6wh-862q. |
| `postcss-selector-parser@6.1.4` | GHSA-rj75-hqrm-r3gf (CVE-2026-104844), CVSS 5.9 | ≥6.1.5 | fixed (batch C) | `backend > @medusajs/medusa > admin-bundler > tailwindcss` — quadratic CPU on flat selectors; build-time → low. |
| `qs@6.15.3` ×3 | GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw (CVSS 3.7/5.3/5.3) | ≥6.16.0 / ≥6.16.0 / ≥6.16.1 | fixed (batch A direct + batch D override) | **direct** `storefront > qs` — array-limit bypass DoS, `isBuffer` DoS, `stringify` TypeError. The declared copy is **never imported** in storefront source (verified); the override also cleared the `express > qs` instance on the backend, which parses public query strings → that instance had been the realistic exposure. |
| `uuid@9.0.1` | GHSA-w5hq-g745-h8pq (CVE-2026-41907), CVSS 7.5 | ≥11.1.1 (**major** 9 → 11) | fixed (batch D) | `backend > @medusajs/medusa > event-bus-redis > bullmq > uuid` — missing buffer bounds check in v3/v5/v6 **when `buf` is provided**; bullmq only calls `v4()` with no buffer → practical exposure low. Major bump justified by runtime proof (see below). |
| `vite@7.3.6` ×3 | GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-rq7h-c2jc-7f22 | ≥7.3.7 | fixed (batch C) | dev/build-time tooling (`medusa develop`), not the production `medusa start` path → dev-time exposure only. |

### Low severity (3 records)

| Package@version | Advisory | First safe | Status | Path and exposure |
| --- | --- | --- | --- | --- |
| `@grpc/grpc-js@1.14.4` | GHSA-f596-whhp-79r4 (CVE-2026-101915), CVSS 3.7 | ≥1.14.5 | fixed (batch C) | OTLP gRPC exporter path (see high above) — error messages echoed to client → low. |
| `vite@7.3.6` | GHSA-9jrq-w75r-8gcw (CVE-2026-112945) | ≥7.3.7 | fixed (batch C) | dev-server custom middleware → dev-time. |
| `deepmerge@4.3.1` | GHSA-gcqx-w48m-w2h4 (CVE-2026-93753), CVSS 5.3 | **none — `patched:<0.0.0`** | **NOT FIXABLE (residual)** | `backend > @medusajs/medusa > @medusajs/notification-sendgrid > @sendgrid/mail > @sendgrid/helpers > deepmerge` — prototype poisoning of `mergeObject()` return values. See [Residual advisory](#residual-advisory-deepmerge). |

## Residual advisory: deepmerge

- **No patched version exists** (`patched_versions: <0.0.0` in the advisory
  data), so no override or bump can clear it while `@sendgrid/helpers` remains.
- **Realistic exposure: low.** `deepmerge` is reached only through SendGrid's
  mail-helper library, which merges *our own* template/personalization objects.
  An attacker would first need to control merge inputs inside the SendGrid
  helper call chain; OpenShop does not pass request data into that path, and the
  notification-sendgrid module is not wired as the default notification provider.
- **Remediation options (documented, not executed):**
  1. Upstream fix from `deepmerge`/`@sendgrid/helpers` — track the GHSA.
  2. Remove `@medusajs/notification-sendgrid` if SendGrid email is unused
     (removes the path entirely; requires confirming no runtime `require`).
  3. A pnpm `patched:` override once a fork exists — rejected for now as
     over-engineering for a low-severity, non-reachable-in-default-config issue.
- This is **one** reason `pnpm audit --prod` exits **1** — and since the
  G10-F remediation (2026-11-09) it is the **only** record: the count went
  1 → 3 at the G10-E re-run (2026-11-08, this residual plus two new
  moderates, next section) → **1 again at G10-F** after the approved
  selector override (G10-F section below). The exit code is recorded
  honestly and not suppressed.

## G10-E update (2026-11-08): feed drift — 1 → 3 records

A fresh `pnpm audit --prod` during the G10-E release dry-run (roadmap §14.3,
raw output `%TEMP%\opencode\g10e-audit.txt`) exits **1** with **3 records:
1 low + 2 moderate**. The two moderates are new upstream advisories
published after the Sprint-3 batches above — neither was present in the
36-record baseline, and both are reachable only through `@medusajs/cli`'s
toolchain (build/CLI time):

| Package (audit path) | Advisory | Vulnerable / patched | Status |
| --- | --- | --- | --- |
| `glob` (`apps__backend > @medusajs/cli > glob`) | GHSA-3g3m-2fjr-6pw4 (moderate) — AbortSignal cancellation bypass allows post-timeout filesystem traversal | >=9.0.0 <=14.0.1 / **>=14.0.2** | **OPEN — fix not applied** (needs a transitive override; dependency changes require explicit approval) |
| `minimatch` (`apps__backend > @medusajs/cli > glob > minimatch`) | GHSA-g3hv-75wg-m249 (moderate) | >=7.0.0 <11.0.1 / **>=11.0.1** | **OPEN — fix not applied** (same) |
| `deepmerge@4.3.1` | GHSA-gcqx-w48m-w2h4 (low) | none | residual, unchanged (above) |

- **Exposure assessment:** both packages run inside the Medusa CLI over
  local file trees at build/dev time; neither sits on the public HTTP
  request path. `glob`'s traversal concern requires a cancellable
  (`AbortSignal`) invocation with attacker-influenced paths — not a pattern
  in OpenShop's own code (CLI-internal call chain).
- **Why not fixed here:** clearing either advisory means adding an override
  or bumping a transitive dependency. The Sprint-3 remediation batches were
  explicitly approved work; this session's standing rules reserve
  dependency changes for explicit user approval, so the fix is **recorded
  as a release blocker** (RELEASING §6 item 5, roadmap §14.3) pending a
  go-ahead — nothing was dismissed, downgraded, or filtered.
- **Effect on the summary table above:** "After (final)" counts (1 record,
  0/0/0/1) describe the Sprint-3 remediation result; the standing count is
  **3 records (0/0/2/1)** as of 2026-11-08. The exit code was 1 before and
  is 1 now — for a different, larger set of reasons.

## G10-F update (2026-11-09): remediation approved and applied — 3 → 1 records

Roadmap §15.2. The two moderates left open at G10-E were remediated with
the smallest safe change, validated in an isolated copy before the source
tree was touched.

**Advisory verification (authoritative — GitHub advisories API):**

| Package | Advisory | Vulnerable | Patched | CVE / severity |
| --- | --- | --- | --- | --- |
| `glob` | GHSA-3g3m-2fjr-6pw4 | >=9.0.0 <=14.0.1 | **>=14.0.2** | CVE-2026-118773, moderate |
| `minimatch` | GHSA-g3hv-75wg-m249 | >=7.0.0 <11.0.1 | **>=11.0.1** | CVE-2026-118764, moderate |
| `deepmerge` | GHSA-gcqx-w48m-w2h4 | >=4.2.0 <=4.3.1 | **none** (`first_patched_version: null`) | low — stays tracked (above) |

**Change applied:** a *selector* override `"glob@13.0.6": "^14.0.2"` in
**both** `package.json#pnpm.overrides` and `pnpm-workspace.yaml` (kept in
sync per the pnpm-10-vs-11 split below). The broad form `"glob": "^14.0.2"`
was rejected: it would also force jest/test-exclude/yalc/npm-packlist's
`glob@^7.2.3` to 14.0.4 — an unrelated dev change on a line that is not
even vulnerable (the advisory floor is >=9.0.0). The selector replaces only
the three Medusa packages' exact `glob@13.0.6` pin; `minimatch` >=11.0.1
arrives transitively via `glob` 14's `minimatch ^11` range, so no second
override is needed. Compatibility was verified before use: `glob` 14's
`glob.sync` API shape matches the call at `@medusajs/cli`'s
`migrator.js:109`, and the isolated copy's `db:migrate` (exit 0) executes
it at runtime. Lockfile `settings.overrides` records the selector
(`pnpm-lock.yaml` L32); `pnpm install --frozen-lockfile` exit 0.

**Validation order (copy first, then source tree):**

1. Isolated copy `g10f-repro`: install 0 → **audit exit 1 with exactly 1
   record (`deepmerge`)** → builds 0/0, tsc 0/0, lint 0, unit 89/89 +
   storefront 87/87, HTTP 34/34, migrate 8/8, fresh-DB `db:migrate` 0
   (proves glob@14 inside the Medusa migrator).
2. Source tree: both override files byte-identical to the validated copy
   (SHA-256) → `pnpm install` 0 → frozen 0 → **audit exit 1, 1 record
   (`deepmerge`)** → full re-validation 10/10 exit 0 → **219/219 tests**.

**Effect:** `pnpm audit --prod` still honestly exits **1** — now solely for
the unfixable `deepmerge` low above (unchanged exposure assessment). The two
moderates that had pushed the count outside the "1 low acceptable"
acknowledgment are gone; nothing was dismissed, filtered, or downgraded.

## Override location finding (pnpm 10 vs pnpm 11)

The repository pins `"packageManager": "pnpm@10.11.1"`. Discovery during this
sprint, proven three ways:

1. Overrides written to `pnpm-workspace.yaml` (`overrides:` key) were ignored:
   `npx pnpm@10.11.1 install` reported *"Lockfile is up to date"* and a fresh
   audit still showed all 36 records.
2. `npx pnpm@10.11.1 install --force` (full re-resolution, 1647 packages) still
   did not apply them; the lockfile `settings.overrides` section contained only
   the three entries from `package.json#pnpm.overrides`.
3. Moving the entries into root `package.json#pnpm.overrides` applied them on
   the next plain install; the lockfile immediately recorded all of them.

**Conclusion:** pnpm 10.x reads `package.json#pnpm.overrides`; pnpm 11.x moved
the setting to `pnpm-workspace.yaml` (the globally installed pnpm 11.8.0 emits
the inverse warning: *"The 'pnpm' field in package.json is no longer read"*).
Both files are therefore kept in sync, each annotated with GHSA references,
until the `packageManager` pin moves to pnpm 11 — at which point the
`package.json#pnpm.overrides` block should be deleted in favor of the workspace
file. This split is a trap: an override silently ignored produces no error, so
**any override change must be confirmed by a fresh audit**, not by install
success alone.

**Attribution correction (2026-11-08, G10-E):** the *"The 'pnpm' field in
package.json is no longer read by pnpm"* warning was observed coming from
the **pinned pnpm 10.11.1 itself** — previously it was attributed only to
the global pnpm 11.8.0. Overrides still demonstrably applied in that run
(lockfile `settings.overrides` populated; audit reported 3 records, not the
un-overridden 36), so the warning alone cannot be used to infer that
overrides were skipped; the verify-via-lockfile-and-fresh-audit rule above
remains the only reliable check.

## Regression coverage

Dependency changes cannot be unit-tested directly; the following evidence was
collected for each risky change and the full suite was run after the final
batch:

| Change | Targeted proof | Result |
| --- | --- | --- |
| `uuid` 9 → 11 (major, transitive) | CJS `require` of uuid@11.1.1 (`v4` is a function); `require("bullmq")` loads (`Queue` is a function) | pass |
| `@graphql-tools/utils` 10.x/12.x → 12.1.0 (ungated) | Export-surface diff: 12.1.0 ⊇ 10.11.0 (148 → 157 exports, **0 missing**); all 16/6/6/8 members actually imported by `@graphql-codegen/core`, `plugin-helpers`, `schema-ast`, `visitor-plugin-common` present in 12.1.0; `require` smoke of codegen/core (`codegen` fn), `@graphql-tools/merge` (`mergeTypeDefs` fn), `@graphql-tools/schema` (`makeExecutableSchema` fn); codegen/core's junction resolves to 12.1.0 | pass |
| `@opentelemetry/instrumentation-pg` 0.52 → 0.73 | peer `@opentelemetry/api ^1.3.0` unchanged (installed 1.9.1); `new PgInstrumentation()` instantiates, `enable` present, correct `instrumentationName`; `@medusajs/deps` junction targets 0.73.0 | pass |
| `zod`/`qs` direct bumps | both packages verified **never imported** in application source (recursive grep excluding `node_modules`/`dist`) | pass |

Full gate battery after the final batch (exact exit codes):

| Gate | Command | Exit |
| --- | --- | --- |
| Production audit | `pnpm audit --prod` | **1** (1 unfixable low — expected, not suppressed) |
| Lint | `pnpm run lint` (turbo → both apps) | 0 (4 pre-existing warnings, 0 errors) |
| Backend types | `npx tsc --noEmit` (apps/backend) | 0 |
| Storefront types | `npx tsc --noEmit` (apps/storefront) | 0 |
| Unit tests | `pnpm run test` (jest 17/17 + vitest 43/43) | 0 |
| Production builds | `pnpm run build` (medusa build + next build) | 0 |

## Reproducing the audit

```powershell
# from repo root — pnpm 11 CLI is fine for audit (read-only); installs must use the pinned version
pnpm audit --prod            # human-readable; exit 1 while any advisory remains
pnpm audit --prod --json     # machine-readable; PowerShell `>` writes UTF-16 — parse accordingly
npx pnpm@10.11.1 install     # any dependency/override change
```

Preserved artifacts for this run (local, outside the repo, not committed):

- `%TEMP%\opencode\sprint3-audit-human.txt` — baseline human-readable output (174 KB)
- `%TEMP%\opencode\sprint3-audit.json` — baseline JSON (406 KB)
- `%TEMP%\opencode\sprint3-audit-inventory.txt` — parsed baseline inventory (36 records)
- `%TEMP%\opencode\sprint3-audit-after{C,D,E}-*.txt/.json` — per-batch results
- `%TEMP%\opencode\sprint3-audit-summary.js` — BOM-aware parser used to build the inventories

## Explicitly not done

- **No Medusa major upgrade.** After batches A–E zero high-severity advisories
  remain, so a framework migration was not required as remediation. A Medusa
  upgrade is a broad architectural change (per sprint rules: document and stop)
  and is tracked as separate roadmap work. It would not remove the residual
  `deepmerge` finding, which lives inside SendGrid's SDK.
- **No `patched:` fork of deepmerge** (see residual section — not justified for
  a low-severity, non-default-path issue).
- No advisories were dismissed, downgraded, or filtered out of the audit output.
