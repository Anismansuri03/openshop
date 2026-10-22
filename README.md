<p align="center">
  <a href="https://www.medusajs.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://user-images.githubusercontent.com/59018053/229103275-b5e482bb-4601-46e6-8142-244f531cebdb.svg">
      <source media="(prefers-color-scheme: light)" srcset="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
      <img alt="Medusa logo" src="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    </picture>
  </a>
</p>

<h1 align="center">Maison Commerce</h1>

<p align="center">
  An open-source, self-hostable commerce foundation for independent brands,<br>
  built with <a href="https://medusajs.com">Medusa</a> and <a href="https://nextjs.org">Next.js</a>.
</p>

> **Scope and honesty.** Maison Commerce is an open-source monorepo starter for
> local development, learning, and experimentation. It is not a
> production-hardened platform, it makes no compatibility or feature claims
> relative to Shopify, and it is not affiliated with Shopify. Checkout uses
> Medusa's built-in **manual test payment provider** (`pp_system_default`)
> only — there is no real payment processing in this repository.

## Why Maison Commerce?

- **A real commerce engine, not a mock.** Medusa v2 backend (carts, orders,
  inventory, regions, tax, fulfillment) with the full admin dashboard.
- **A distinctive Next.js storefront** — locale-aware routing, multi-step
  checkout, product facets/filters, account area, and a 54-product demo
  catalogue with deterministic content.
- **Windows-native local development** — no Docker, no WSL, no cloud
  accounts. PowerShell scripts plus `pnpm` and a local PostgreSQL.
- **Honest demo data** — 54 products / 440 variants with real inventory
  levels, seeded deterministically so every clone sees the same store.
- **A scripted end-to-end test** — a Playwright journey that registers a
  pending order through the real storefront UI and saves screenshots.

## Who is this for?

Developers evaluating a self-hosted commerce stack, learning Medusa v2, or
bootstrapping an independent brand's storefront on top of an extensible,
MIT-licensed codebase.

## What works today

| Area | State |
| --- | --- |
| Catalog (products, collections, categories, tags, options/variants) | Working — 54 published products, 440 variants |
| Cart & multi-step checkout (address → delivery → payment → review) | Working — test payment provider only |
| Inventory (stock levels per variant, "out of stock" handling) | Working — 440 seeded levels |
| Regions, shipping options, publishable API keys | Working — 1 region (7 countries), 2 shipping options |
| Customer accounts (register, login, order history, address book) | Implemented in the storefront; guest checkout is the E2E-verified path |
| Admin dashboard (`/app`) | Working — catalog, orders, settings |
| Local search facets on the store page | Working — index seeded on backend boot |
| Real payment providers (Stripe etc.) | **Not wired** — provider stubs only |
| Production deployment guides / hardening | **Not provided** — see ROADMAP.md |

## Architecture

```text
  Browser
     │
     ▼
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Next.js storefront  :8000  │  Store │  Medusa backend  :9000       │
│  (locale routing, cart UI,   │──API──▶│  cart/order/payment (test),  │
│  checkout, account area)     │  pk_*  │  inventory, search index,    │
└─────────────────────────────┘        │  admin dashboard  /app       │
                                       └──────────────┬───────────────┘
                                                      │
                                                      ▼
                                             PostgreSQL (local)
```

Both apps are ordinary Node processes; nothing is containerized.

## Requirements

- **Node.js >= 22.22.0** (`node -v`)
- **pnpm 10.11.1** — `npm install -g pnpm@10.11.1`, or enable corepack
- **PostgreSQL 14+** running locally (verified on 17)
- Windows PowerShell 5.1+ (primary path) — bash works too, see
  [docs/local-development.md](docs/local-development.md)
- Python 3.12+ (optional, only for the E2E journey test)

## Quick start (PowerShell)

Run every command from the directory shown. Full detail, Unix notes, and
troubleshooting: [docs/local-development.md](docs/local-development.md).

**One-time setup:**

```powershell
# 0. repo root — install dependencies
pnpm install

# 1. repo root — create the database (use your own role/password)
psql -U postgres -c "CREATE DATABASE maison_public_local;"

# 2. repo root — environment files (never commit these)
Copy-Item apps\backend\.env.template apps\backend\.env
Copy-Item apps\storefront\.env.template apps\storefront\.env.local
#    Then edit apps\backend\.env and set:
#      DATABASE_URL=postgres://USER:YOUR_PASSWORD@localhost:5432/maison_public_local
#      JWT_SECRET=<long random string>
#      COOKIE_SECRET=<another long random string>

# 3. apps\backend — migrate + seed
cd apps\backend
pnpm exec medusa db:migrate
#    ^ schema migrations + built-in initial data (region, channel, shipping,
#      publishable key, 4 starter products). Do NOT run initial-data-seed.ts
#      again by hand — it is not idempotent.
pnpm exec medusa exec ./src/scripts/seed-demo-products.ts
pnpm exec medusa exec ./src/scripts/seed-demo-inventory-levels.ts
pnpm exec medusa user -e admin@example.com -p 'YOUR-STRONG-PASSWORD'
cd ..\..

# 4. repo root — start the backend
pnpm run backend:dev
#    wait for: "Server is ready on port: 9000"

# 5. browser — create the storefront key
#    Open http://localhost:9000/app, sign in (credentials from step 3),
#    go to Settings -> Publishable API keys, create a key, copy pk_...

# 6. paste the key into apps\storefront\.env.local:
#      NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...

# 7. second terminal, repo root — start the storefront
pnpm run storefront:dev
```

**Daily development (after setup):**

```powershell
.\scripts\local-dev.ps1 start    # backend + storefront, waits until ready
.\scripts\local-dev.ps1 status   # read-only health check
.\scripts\local-dev.ps1 stop     # free :9000 and :8000
```

**When setup succeeded you should see:**

- Storefront at http://localhost:8000/dk — store page lists 54 products,
  all in stock
- Admin at http://localhost:9000/app — same catalog, orders, settings
- A complete checkout in the storefront using the **Test payment** method
  (no real money, no external payment calls)

## Screenshots

Captured from the running demo (home, product page, cart, checkout,
confirmation — see `docs/screenshots/`):

| Home | Product |
| --- | --- |
| ![Home](docs/screenshots/01-home.png) | ![Product page](docs/screenshots/04-pdp.png) |

| Cart | Confirmed order |
| --- | --- |
| ![Cart](docs/screenshots/06-cart.png) | ![Order confirmed](docs/screenshots/12-confirmed.png) |

## Testing and quality

```powershell
pnpm run lint                              # eslint (both workspaces)
pnpm --filter @dtc/storefront test         # vitest — 18 unit tests
pnpm --filter @dtc/storefront exec tsc --noEmit
pnpm --filter @dtc/backend exec tsc --noEmit
pnpm run build                             # production builds
python tests\e2e\e2e-journey.py            # full UI checkout (Playwright)
```

The E2E journey places **one pending order** per run in whatever database
the storefront is connected to. Payments are never captured or fulfilled.

## What this is not

- Not production-ready: no deployment/hardening guide, default dev secrets in
  templates, no observability stack.
- Not a Shopify replacement claim: no real payment provider wired, no
  multi-tenant SaaS, no app store, no official Shopify affiliation.
- Not free of responsibility: self-hosting means you operate PostgreSQL,
  backups, TLS, and PCI scope yourself if you ever add real payments.

## Known issues

These are pre-existing, documented, and intentionally not hidden:

- `pnpm --filter @dtc/backend run test:unit` exits 1 on Windows (POSIX
  `VAR=value` script syntax); the backend also currently ships **no unit
  test files**, so the script matches nothing on any OS. Tracked in
  [ROADMAP.md](ROADMAP.md).
- `next lint` is deprecated (removal in Next.js 16); the storefront reports
  two `react-hooks/exhaustive-deps` warnings.
- `GET /store/locales` 404s (the storefront calls it; harmless).
- The search index is seeded when the backend boots; there is no standalone
  search route in the storefront.
- `pnpm.overrides` in the root `package.json` is ignored by pnpm 10 — the
  active dependency overrides live in `pnpm-workspace.yaml` (`sharp`,
  `proxy-addr`, chosen to address published GHSA advisories).
- `pnpm audit --prod` reports transitive advisories (0 critical). Overrides
  in `pnpm-workspace.yaml` already address the most severe production-chain
  findings; the rest sit in dev/build tooling (vite, postcss, grpc-js, ...).
- No Redis required for local development (an in-memory fallback is used).
- `next build` skips TypeScript and ESLint errors
  (`ignoreBuildErrors`/`ignoreDuringBuilds`, upstream default); CI runs
  `tsc --noEmit` and lint as separate, blocking steps instead.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Planned work is tracked in
[ROADMAP.md](ROADMAP.md). Security reports: [SECURITY.md](SECURITY.md).

## Attribution and license

- Built on [Medusa](https://github.com/medusajs/medusa) and adapted from the
  [Medusa DTC Starter](https://github.com/medusajs/dtc-starter).
- Released under the MIT License, © 2022 Medusa — see [LICENSE](LICENSE).
- Please preserve this attribution when redistributing.
