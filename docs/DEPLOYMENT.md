# Deployment

How to deploy OpenShop (Medusa backend + Next.js storefront + PostgreSQL) on a
single server, and what has — and has not — actually been tested.

> **Test status.** Everything marked **[TESTED]** was executed end-to-end on an
> isolated clean installation on **2026-11-05** (section 9 records the full
> run, phase by phase, with exact exit codes). Everything marked
> **[NOT TESTED]** was **not** executed: the test machine has no Docker,
> nginx, Caddy, OpenSSL, certbot, pm2 or nssm, so reverse-proxy, TLS and
> process-manager material is reference documentation only. **[SRC]** marks
> behaviour read from source code rather than run. Do not treat an untested
> section as a proven procedure.

> **Payments honesty (gate 3 = FAIL).** This deployment includes a
> *simulated* development payment provider. A simulated payment is not a
> payment integration; no real money ever moves, and production boot with the
> provider requires an explicit acknowledgement flag (section 8.1). See
> [PAYMENTS.md](PAYMENTS.md).

---

## 1. Architecture and prerequisites

### 1.1 Components

| Component | Technology (tested version) | Default port | Role |
| --- | --- | --- | --- |
| Backend | Medusa 2.21.2 on Node.js (tested: v24.17.0; project requires Node 20+) | 9000 (`medusa start`, override with `--port`/`PORT`) | Store API, admin API, admin SPA at `/app`, `GET /health` |
| Storefront | Next.js 15.5.28 | 8000 in dev; any with `next start -p <port>` | Customer-facing shop |
| Database | PostgreSQL (tested: server 17 with client tools in `C:\Program Files\PostgreSQL\17\bin`) | 5432 | Catalogue, orders, customers, payments references |
| Redis | not required | — | **[TESTED]** the boot log prints `redisUrl not found. A fake redis instance will be used.` and every tested path works without Redis. Auth rate limiting is in-memory per instance (see [local-development.md](local-development.md) §Auth rate limiting; roadmap G6) |

Layout: one Postgres instance, one backend process, one storefront process,
both behind a reverse proxy that terminates TLS **[NOT TESTED]**.

### 1.2 Prerequisites

| Prerequisite | Notes |
| --- | --- |
| Node.js 20+ | **[TESTED]** with v24.17.0 |
| pnpm | **[TESTED]** the root `package.json` pins `packageManager: pnpm@10.11.1`; the installed pnpm (11.8.0 on the test machine) switches to the pinned version automatically — the install log reported `using pnpm v10.11.1`. Never introduce a second lockfile. |
| PostgreSQL 15+ server + client tools | **[TESTED]** server 17; `pg_dump`/`pg_restore` discovered via `PG_BIN` → `PATH` → well-known locations (the backup scripts found `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe` without configuration) |
| Source checkout + `pnpm-lock.yaml` | **[TESTED]** `pnpm install --frozen-lockfile` exit 0 in 1m12s from a bare copy (section 9, phase B) |
| Domains + DNS + TLS certificates | **[NOT TESTED]** — the test used `localhost` ports and the placeholder origin `https://g7-clean.example` |

---

## 2. Environment variables and secret management

Each app reads its own `.env`, created from the committed templates
(`apps/backend/.env.template`, `apps/storefront/.env.template`). The templates
are the documentation for every variable; this table summarises what matters
for a production deployment.

### 2.1 Backend (`apps/backend/.env`)

| Variable | Required | Meaning | Status |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/dbname`. Missing or non-postgres URL is a **hard error at boot** (`validate-env.ts`) | **[TESTED]** set to the isolated G7 database; migrations, backup, restore all used it |
| `STORE_CORS` | yes (production) | Comma-separated origins allowed to call the store API — must include the storefront origin | **[TESTED value shape]** `http://localhost:8000,http://localhost:9102` in the G7 run; a real domain mapping is **[NOT TESTED]** |
| `ADMIN_CORS` | yes (production) | Origins allowed for the admin API/SPA | same as above |
| `AUTH_CORS` | yes (production) | Origins allowed for auth endpoints | same as above |
| `JWT_SECRET` | yes (production) | Signs auth tokens. Hard error if unset, if it equals `supersecret`/`changeme`/`secret`, or if shorter than 16 characters | **[SRC + unit-tested]** (validate-env spec is part of the backend unit suite, 89/89 green 2026-11-04); the G7 run set a 64-hex-char random value |
| `COOKIE_SECRET` | yes (production) | Signs cookies; same rules as `JWT_SECRET` | same |
| `ENABLE_DEV_PAYMENT_PROVIDER` | see [PAYMENTS.md](PAYMENTS.md) | Must be exactly `true` to boot production with the simulated provider | **[TESTED]** absent → refusal, exit 1, **no port bound** (section 8.1) |
| `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW_MS` | no | Auth rate limit (defaults 10 / 60000) | **[SRC]** |
| `RATE_LIMIT_TRUSTED_PROXY_HOPS` | no | Number of trusted reverse-proxy hops for `X-Forwarded-For` (default 0 = ignore the header). **Set this correctly when you put the backend behind a proxy** | **[SRC]**, proxy itself **[NOT TESTED]** |
| `REDIS_URL` | no | Present in the template; the tested run logged that no Redis was found and used the in-memory fallback | **[TESTED]** (fallback path) |

### 2.2 Storefront (`apps/storefront/.env`)

All `NEXT_PUBLIC_*` values are **inlined at build time** — change them, then
rebuild; editing `.env` after `next build` changes nothing.

| Variable | Required | Meaning | Status |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | yes | Publishable API key created by the migration seed (`pk_…`). Without it the store API answers **HTTP 400** | **[TESTED]** 400 without / 200 with |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | yes | Backend origin the storefront calls (server-side) | **[TESTED]** `http://localhost:9101` |
| `NEXT_PUBLIC_BASE_URL` | yes (production build) | The single source for every absolute URL (metadataBase, Open Graph, `sitemap.xml`, `robots.txt`). Must be a non-loopback absolute origin; production builds fail loudly otherwise | **[TESTED]** `https://g7-clean.example` — every emitted URL used it, none leaked `localhost` |
| `NEXT_PUBLIC_DEFAULT_REGION` | no | Default region code (default `dk`) | **[TESTED]** |
| `NEXT_PUBLIC_STRIPE_KEY` | no | Reserved; this project does not wire Stripe. Leave empty | **[SRC]** |
| `MEDUSA_CLOUD_S3_HOSTNAME` / `MEDUSA_CLOUD_S3_PATHNAME` | no | Medusa Cloud only | **[SRC]** |
| `NODE_ENV` | no | Set by tooling (`medusa start` forces `production` itself) | **[SRC]** |

### 2.3 Secret management rules

1. **Never commit a filled-in `.env`.** Copy the template; the repository
   ships only templates. The G7 clean copy was made with `.env` excluded and
   this was verified (`Test-Path …\.env` → `False`).
2. **Generate secrets, don't invent them.** The tested generator (PowerShell,
   used for both G7 secrets): `( [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N") )`
   produces a 64-character hex string — comfortably above the 16-character
   minimum. Any `openssl rand -hex 32` equivalent is fine **[NOT TESTED here:
   no openssl on the machine]**.
3. **Secrets live in the process environment of the service**, not in the
   repository and not in world-readable files where avoidable. The G7 run
   loaded `apps/backend/.env` into the service's environment before launch
   (section 4.3) — **[TESTED]**.
4. **Backups contain customer data.** `db-backup` prints this reminder on
   every run: *this file contains all data of that database (including
   customer PII); keep it private and never commit it* — **[TESTED output]**.
5. Rotating `JWT_SECRET`/`COOKIE_SECRET` invalidates existing sessions —
   **[SRC]**, rotation itself **[NOT TESTED]**.

---

## 3. PostgreSQL provisioning, migrations, initial setup

### 3.1 Create the database

```sql
CREATE DATABASE openshop;
```

Run it through any Postgres client (the test harness executed this exact
statement through a small Node/pg helper because `psql` on the test machine
was flaky; the statement itself is stock PostgreSQL) — **[TESTED — exit 0]**.

### 3.2 Migrate (schema + guarded initial-data seed)

```powershell
cd apps/backend
pnpm run db:migrate
```

- This is `scripts/migrate-checked.js`: it runs the upstream
  `medusa db:migrate` and then **verifies the result in the database**
  (every `script_migrations` row must have `finished_at` set), because
  upstream 2.21.2 can print a failed migration script and still exit 0.
  Exit 0 therefore means *migrations and scripts verified complete*.
- It creates the schema, module links, search indexes, and runs the guarded
  `initial-data-seed` migration script: **1 region (7 countries: dk, fr, de,
  it, es, se, gb), tax regions, 4 starter products, shipping options,
  inventory levels, and the publishable API key**.
- **[TESTED]** first run: exit 0 on the fresh G7 database (phase D). Re-run
  on the already-migrated database: **exit 0 — idempotent** (phase K), which
  is the upgrade-path property documented in [UPGRADING.md](UPGRADING.md).

### 3.3 Publishable key

The seed creates a `pk_…` publishable key (67 characters in the G7 run).
Copy it into `apps/storefront/.env` as
`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`. The G7 harness read it from the
`api_key` table and wrote it to the file **without ever printing the value**
— **[TESTED — exit 0]**. Creating a key through the admin API instead is
**[NOT TESTED]**.

### 3.4 Admin user

```powershell
cd apps/backend
pnpm exec medusa user -e admin@example.com -p "<strong password>"
```

**[NOT TESTED in the G7 run]** — the clean install verified the admin SPA
shell (`GET /app` → 200) but never created or logged in an admin user. See
[local-development.md](local-development.md) for the local flow.

### 3.5 Demo catalogue seed (optional)

```powershell
# from the REPOSITORY ROOT, not apps/backend
pnpm run backend:seed
```

Creates 50 demo products and catches the search index up — **[TESTED —
exit 0, `Created 50/50 demo products`, `Search index caught up for 54
product(s)`, 40.6 s]** (phase K). Running it from `apps/backend` fails with
`ERR_PNPM_NO_SCRIPT Missing script: backend:seed` (exit 1) — **[TESTED]**;
the script only exists in the root `package.json`. The seed is rerun-safe.

---

## 4. Storefront/backend configuration and domains

### 4.1 CORS matrix

| Variable | Must contain |
| --- | --- |
| `STORE_CORS` | the storefront origin(s) — e.g. `https://shop.example.com` |
| `ADMIN_CORS` | the origin(s) the admin is served from — e.g. `https://admin.example.com` (or the backend origin if you serve `/app` from it) |
| `AUTH_CORS` | same origins as the admin/storefront that perform auth |

**[TESTED value shape]** with localhost origins in the G7 run; **[NOT
TESTED]** with real domains, and browser-side CORS itself was not exercised
(the G7 checks were server-side HTTP calls) — the storefront's server-side
rendering path to the backend is what was proven.

### 4.2 Build-time configuration

```powershell
pnpm run build     # both apps — [TESTED] exit 0 (admin frontend 73.25 s)
```

- Storefront: every `NEXT_PUBLIC_*` is inlined. Set them **before**
  `next build`. A production build with a missing/loopback
  `NEXT_PUBLIC_BASE_URL` fails by design.
- Backend: `medusa build` produces the self-contained production tree at
  `apps/backend/.medusa/server` (compiled `src/*.js`, `medusa-config.js`,
  `public/admin`) — **[TESTED — both index.html files located there]**.

### 4.3 Starting the backend (production)

**The working directory must be the build output directory
`apps/backend/.medusa/server`.** The Medusa CLI resolves the project
directory from the current working directory; the admin loader then serves
`<cwd>/public/admin`, which only exists inside `.medusa/server`.

```powershell
cd apps/backend/.medusa/server
# provide apps/backend/.env via the process environment first (loadEnv reads
# the current directory, and .medusa/server has no .env), then:
<full-path-to>\apps\backend\node_modules\.bin\medusa.cmd start --port 9101
```

**[TESTED]** `GET /health` → 200 `OK` within the readiness window, admin
`GET /app` → 200, store API → 200 with key / 400 without, ports 8000/9000
never touched.

Failure modes proven in the same run:

- Starting from `apps/backend` instead fails with
  `Could not find index.html in the admin build directory` — **[TESTED]**.
- `medusa start` sets `NODE_ENV=production` itself and defaults to port
  9000 unless `--port`/`PORT` says otherwise — **[SRC]**.

### 4.4 Starting the storefront (production)

```powershell
cd apps/storefront
pnpm exec next start -p 9102
```

**[TESTED]** `/` → 200, `/dk` → 200, `robots.txt` → 200 (correct Sitemap
line), `sitemap.xml` → 200 (70 URLs once the route cache was regenerated —
section 8.3).

### 4.5 Domain layout (reference)

A typical production split — **[NOT TESTED]** with real domains:

| Host | Serves |
| --- | --- |
| `https://shop.example.com` | storefront (`next start`) |
| `https://api.example.com` | backend store/admin API + admin SPA at `/app` |

Both must be reflected in the CORS variables (4.1) and, for the storefront,
in `NEXT_PUBLIC_BASE_URL` (build-time).

---

## 5. HTTPS, reverse proxy, and production security

> **[NOT TESTED] — no TLS material, proxy or process manager exists on the
> test machine.** The subsections below are reference configurations. They
> have never been executed here; validate them on your own infrastructure
> before relying on them.

### 5.1 TLS termination **[NOT TESTED]**

Terminate TLS at the reverse proxy (or a managed load balancer). Obtain
certificates with certbot/acme.sh or your provider's offering. Serve the
storefront and backend over HTTPS only; HTTP should redirect.

### 5.2 Reverse proxy sketch **[NOT TESTED]**

```nginx
# REFERENCE ONLY — never executed in this repository's test environment
server {
  listen 443 ssl;
  server_name shop.example.com;
  # ssl_certificate ...; ssl_certificate_key ...;
  location / { proxy_pass http://127.0.0.1:3000; }   # storefront
}
server {
  listen 443 ssl;
  server_name api.example.com;
  # ssl_certificate ...; ssl_certificate_key ...;
  location / { proxy_pass http://127.0.0.1:9000; }   # backend
}
```

When proxying, set `RATE_LIMIT_TRUSTED_PROXY_HOPS` to the number of trusted
hops so client-IP rate limiting reads `X-Forwarded-For` correctly **[SRC]**.

### 5.3 Process management **[NOT TESTED]**

Run each app under a supervisor that restarts on failure (systemd, pm2,
nssm, Docker — none available on the test machine). Requirements the docs
can assert from the tested run:

- the backend service's working directory is `apps/backend/.medusa/server`
  (4.3);
- its environment contains the `apps/backend/.env` values;
- readiness = `GET /health` returning 200 (8.1);
- the storefront service's working directory is `apps/storefront`.

### 5.4 Production security checklist

| Control | Status |
| --- | --- |
| Secrets never committed; templates only in git | **[TESTED]** (clean copy contained no `.env`) |
| Production refuses weak/missing `JWT_SECRET`/`COOKIE_SECRET`/CORS/`DATABASE_URL` | **[SRC + unit-tested]** (`validate-env.ts`) |
| Development payment provider cannot boot in production without `ENABLE_DEV_PAYMENT_PROVIDER=true`; refusal happens **before any port binds** | **[TESTED]** exit 1, ports 9101/9000 free |
| Store API requires a publishable key | **[TESTED]** 400 without |
| Auth rate limiting on `/auth/*`, tunable, proxy-aware | **[SRC]**; behaviour covered by the HTTP suite (rate-limit tests) |
| TLS / HSTS / WAF / fail2ban | **[NOT TESTED]** |
| Database not exposed publicly; restricted user + password in `DATABASE_URL` | **[TESTED pattern]** (local socket/TCP with credentials; hardening guidance **[NOT TESTED]**) |

---

## 6. Backup, restore, and recovery

Full tooling reference: **[BACKUPS.md](BACKUPS.md)**. This section records
what the G7 clean install proved.

### 6.1 Create a backup **[TESTED — exit 0]**

```powershell
cd apps/backend
pnpm run db:backup
# db-backup: wrote backups\<database>-<timestamp>.dump (450092 bytes, 1.1s)
# db-backup: reminder — this file contains all data of that database
#            (including customer PII); keep it private and never commit it.
```

Custom-format `pg_dump`, discovered automatically (`PG_BIN` → `PATH` →
well-known locations). It is a logical dump at dump time — **not**
point-in-time recovery (see BACKUPS.md).

### 6.2 Restore into a NEW database **[TESTED — exit 0]**

```powershell
pnpm run db:restore -- <path-to.dump> <target-db-name>
```

Guarantees (from the script's own contract, verified by execution):

- refuses to overwrite an existing target (exit 1) — an existing database,
  including production, can never be clobbered;
- on success: `verified 148 tables and row counts against source "<db>"`
  when the source is reachable (G7 run, phase J — exit 0).

### 6.3 Disaster drill — source database destroyed **[TESTED — exit 0]**

Executed in the G7 run (phase K):

1. Backend stopped, `openshop_g7_clean_install` **dropped** (exit 0).
2. Restored from the phase-J dump into the same name (exit 0).
3. Row counts cross-checked against an independent copy
   (`openshop_g7_restore_check`, itself verified against the real source
   before the disaster): **148/148 tables, 0 missing, 0 extra, 0 row-count
   mismatches — PASS (exit 0)**.
4. `pnpm run db:migrate` re-run → **exit 0 (idempotent)**.
5. `pnpm run backend:seed` → **exit 0** (50/50 demo products).
6. Backend restarted → `GET /health` 200, store API 200 with 54 products,
   admin 200 — **service resumed**.

**Known quirk (worth remembering):** if you restore into *the same name*
that `DATABASE_URL` points at, the script's "against source" verification
connects to that name *after* it has been recreated — i.e. it compares the
restored database with itself. The structure verification is still real, but
the row-count comparison is only meaningful when the source is a *different*
database (as in 6.2) or when you cross-check independently (step 3 above).

### 6.4 Recovery procedure (summary)

1. Restore the latest dump into a **fresh** database name (6.2).
2. Cross-check row counts against any surviving copy, if one exists.
3. Point `DATABASE_URL` at the restored database (config change — the
   repoint itself was **[NOT TESTED]** in G7; the restore mechanism was).
4. Re-run `pnpm run db:migrate` (idempotent — tested) and restart.

Back up uploaded files (local asset storage) and any other state separately —
BACKUPS.md's scope note applies.

---

## 7. Upgrade and rollback

Detailed procedure: **[UPGRADING.md](UPGRADING.md)**. Summary of what was
tested in G7:

| Step | Status |
| --- | --- |
| Backup before touching anything (6.1) | **[TESTED — exit 0]** |
| `pnpm install --frozen-lockfile` from a bare tree | **[TESTED — exit 0]** |
| `pnpm run build` (both apps) | **[TESTED — exit 0]** |
| `pnpm run db:migrate` re-run on an already-migrated database | **[TESTED — exit 0, idempotent]** |
| Restore-from-backup as the rollback mechanism | **[TESTED — exit 0]** (6.2/6.3) |
| A full N → N+1 upgrade (old version → new code + forward migrations) | **[NOT TESTED]** — the repository has a single version; there is no previous release to upgrade from (release engineering is G10) |
| Database down-migrations | do not exist by design; rollback = restore (UPGRADING.md) |

---

## 8. Health checks, logs, and troubleshooting

### 8.1 Health checks **[TESTED]**

```
GET http://<backend>:<port>/health   →  200  "OK"
```

Registered by `medusa start` itself. Honest caveat: upstream's own source
comment says *"Ideally this also checks the readiness of the service, rather
than just returning a static response"* — so a 200 means **the process is
serving HTTP**, not that the database is reachable. Use it as a liveness /
boot-completion probe (the G7 readiness loop polled it until 200), and pair
it with a real store-API call (e.g. `/store/regions` with the publishable
key) when you need a deeper check.

The storefront has no dedicated health route in this project; polling `/`
(returning 200) is the equivalent **[TESTED]**.

### 8.2 Logs

Both apps log to stdout/stderr — capture them in your process manager.
The G7 run redirected them to files (`.g7-logs/backend*.log`,
`storefront*.log`); that pattern is how every symptom below was diagnosed.

### 8.3 Troubleshooting

| Symptom | Cause | Fix (status) |
| --- | --- | --- |
| `Could not find index.html in the admin build directory` on `medusa start` | Working directory is not the build output; the admin loader serves `<cwd>/public/admin` | Run from `apps/backend/.medusa/server` (4.3) — **[TESTED]** |
| Production boot exits 1 with *“The development payment provider (pp_dev-payment_default) only simulates payments and never processes real money, so it refuses to run in production…”* and **no port is bound** | `NODE_ENV=production` without `ENABLE_DEV_PAYMENT_PROVIDER=true` | Either remove the provider from `medusa-config.ts` or set the flag deliberately (see [PAYMENTS.md](PAYMENTS.md)) — **[TESTED]** |
| `sitemap.xml` serves only 2 URLs (country home + `/store`) although the catalogue is fine | Next cached the **build-time** route output in `.next/server/route-cache/` — generated while the backend was down, so the sitemap fell back to static routes; `revalidate = 3600` keeps serving it | Bring the backend up, delete `.next/server/route-cache/`, restart the storefront → regenerates (G7 run: **2 → 70 URLs**, correct origin, zero warnings) — **[TESTED]** |
| Store API returns 400 / storefront shows no products | Missing or wrong `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Set it (3.3) and rebuild the storefront — **[TESTED]** (400 without key) |
| `ERR_PNPM_NO_SCRIPT Missing script: backend:seed` | Script lives in the root `package.json` only | Run `pnpm run backend:seed` from the repository root — **[TESTED]** (exit 1 → exit 0) |
| pnpm warns `The "pnpm" field in package.json is no longer read…pnpm.overrides` | pnpm 10+ setting relocation | Harmless warning, appeared in every run — **[observed]** |
| pnpm reports `Ignored build scripts: @swc/core, esbuild, …` | pnpm's build-script approval gate | Builds still succeeded (**[TESTED]** build exit 0); if a native binary ever fails, run `pnpm approve-builds` |
| Backend up (`/health` 200) but storefront empty/errors | Wrong `NEXT_PUBLIC_MEDUSA_BACKEND_URL`, or browser-origin CORS | Check 4.1/4.2 — server-side path **[TESTED]**, browser path **[NOT TESTED]** |
| Sitemap/robots/OG URLs contain `localhost` in production | `NEXT_PUBLIC_BASE_URL` was loopback at build time | Production builds reject loopback by design; set the real origin and rebuild — **[TESTED in reverse: the G7 build published only `https://g7-clean.example` URLs]** |

---

## 9. The clean installation test (2026-11-05)

**Claim under test:** *the documented deployment actually installs, builds,
runs, backs up, restores and recovers on a machine that starts with nothing
but the source tree.* A successful local build is not proof of that; this run
is.

**Setup.** An isolated copy of the repository (365 files, 4.5 MB, build
artifacts and `.git` excluded, **no `.env` copied** — verified absent) at
`Temp\opencode\g7-clean`; a fresh database `openshop_g7_clean_install`;
ports **9101** (backend) and **9102** (storefront) because 8000/9000 are
reserved; brand-new random `JWT_SECRET`/`COOKIE_SECRET`; placeholder origin
`https://g7-clean.example`; `ENABLE_DEV_PAYMENT_PROVIDER` deliberately left
unset for the refusal test.

| Phase | What ran | Result |
| --- | --- | --- |
| A | `robocopy` clean copy (`.env`, build dirs, `.git` excluded) | **exit 1** (robocopy success), 365 files = source count, no secrets copied |
| B | `pnpm install --frozen-lockfile` | **exit 0** — 1m12.1s, pnpm 10.11.1 |
| C | Fresh `apps/backend/.env` (7 keys + later the flag) and `apps/storefront/.env` (5 keys) from templates | **OK** — key names verified, values never printed |
| D | `CREATE DATABASE openshop_g7_clean_install`; `pnpm run db:migrate` | **exit 0** — migrations + guarded initial-data seed |
| E | Publishable key written into storefront `.env` (file only, never printed) | **exit 0** — `pk_…`, 67 chars |
| F | `pnpm run build` (both apps) | **exit 0** — Next 15.5.28; admin frontend 73.25s |
| G | `medusa start` **without** `ENABLE_DEV_PAYMENT_PROVIDER` | **exit 1**, refusal message seen, **no port bound** (9101 and 9000 both free) |
| H | `medusa.cmd start --port 9101` from `.medusa/server`, `.env` in process env | **`GET /health` 200 `OK`**; `/store/regions` 200 with key (1 region / 7 countries) and **400 without**; `/app` 200; 8000/9000 free |
| I | `pnpm exec next start -p 9102` | `/` 200, `/dk` 200, `robots.txt` 200, `sitemap.xml` 200; sitemap initially 2 URLs (stale build-time fallback), **route-cache cleared → 70 URLs** (8.3) |
| J | `pnpm run db:backup`; `pnpm run db:restore -- <dump> openshop_g7_restore_check` | **exit 0** (439.5 KB dump, 1.1s); **exit 0 — verified 148 tables and row counts against source** |
| K | Disaster drill: drop source DB → restore same name → independent row-count compare → `db:migrate` re-run → `backend:seed` → restart | drop **exit 0**; restore **exit 0**; compare **PASS exit 0** (148/148 tables, 0 mismatches vs the independent copy); migrate **exit 0 (idempotent)**; seed **exit 0** (50/50 products); restart → `/health` 200, 54 products, admin 200 |
| teardown | Stop services; drop both G7 databases; port sweep | both drops **exit 0** (0 databases matching `openshop_g7%` remain); **8000/9000/9101/9102 all free** |

**What this proves:** a bare copy of the repository installs from the lockfile,
migrates a virgin database, builds both apps for production, refuses to boot
in production without the payment acknowledgement, serves the backend
(health, store API with/without key, admin) and the storefront (pages,
robots, sitemap), backs up, restores (with and without a surviving source),
re-runs migrations idempotently, seeds demo data, and resumes service after a
simulated total database loss — all on ports that never touched 8000/9000.

**What this does not prove:** behaviour behind a reverse proxy or TLS
certificate (none available), on a different OS or network topology, under a
process manager, with real DNS/domains, with Redis, with a real payment
provider (gate 3 stays FAIL), or across an N → N+1 version upgrade (single
version; release engineering is G10).

---

## Related documents

- [local-development.md](local-development.md) — day-to-day development,
  test procedures, troubleshooting.
- [BACKUPS.md](BACKUPS.md) — backup tooling in depth, PITR scope, restore
  verification semantics.
- [UPGRADING.md](UPGRADING.md) — upgrade and rollback runbook.
- [PAYMENTS.md](PAYMENTS.md) — the simulated payment provider and its
  production refusal.
- [ADOPTION.md](ADOPTION.md) — first-run adoption notes.
