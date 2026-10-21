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
  An open-source Shopify-style storefront starter: Medusa v2 backend + Next.js storefront.
</p>

> **Scope and honesty.** Maison Commerce is an open-source monorepo starter for
> local development, learning, and experimentation. It is not a
> production-hardened platform, it makes no compatibility or feature claims
> relative to Shopify, and it is not affiliated with Shopify. Checkout uses
> Medusa's built-in **manual test payment provider** (`pp_system_default`)
> only — there is no real payment processing in this repository.

## Features

- Product catalog with collections, tags, categories, and option/variant selection
- Demo catalogue (54 products) with deterministic handles and seeded stock levels
- Cart, multi-step checkout (address → delivery → payment → review), order confirmation
- Customer accounts with order history
- Regions, shipping options, and publishable API keys
- Admin dashboard at `/app`
- Windows-native local workflow — no Docker, no WSL required

## Attribution and license

- Built on [Medusa](https://github.com/medusajs/medusa) and adapted from the
  [Medusa DTC Starter](https://github.com/medusajs/dtc-starter).
- Released under the MIT License, © 2022 Medusa — see [LICENSE](LICENSE).
- Please preserve this attribution when redistributing.

## Getting started

The full local workflow (database setup, seeds, admin user, dev scripts, and
the E2E journey test) is documented in
[docs/local-development.md](docs/local-development.md).

Quick start:

```bash
pnpm install

# Backend env
cp apps/backend/.env.template apps/backend/.env
psql -U postgres -c "CREATE DATABASE maison_public_local;"
# set DATABASE_URL in apps/backend/.env to that database

cd apps/backend
pnpm exec medusa db:migrate          # migrations + initial data seed
pnpm exec medusa exec ./src/scripts/seed-demo-products.ts
pnpm exec medusa exec ./src/scripts/seed-demo-inventory-levels.ts
pnpm exec medusa user -e admin@example.com -p YOUR_PASSWORD

# Storefront env
cd ..
cp apps/storefront/.env.template apps/storefront/.env.local
# set NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY (create one in the admin:
# Settings -> Publishable API keys)
```

Start both apps from the repository root:

```bash
pnpm dev
```

- Storefront: http://localhost:8000 (locale-prefixed, e.g. `/dk`)
- Admin: http://localhost:9000/app

## Quality and testing

```bash
pnpm run lint                                  # turbo lint (both workspaces)
pnpm --filter @dtc/storefront test             # vitest (18 tests)
pnpm run build                                 # production builds
python tests/e2e/e2e-journey.py                # full checkout journey (Playwright)
```

The E2E journey places **one pending order** per run in whatever database the
storefront is connected to. Payments are never captured or fulfilled.

## Known issues

These are pre-existing, documented, and intentionally not hidden:

- `pnpm --filter @dtc/backend run test:unit` exits 1 on Windows because the
  script uses POSIX `VAR=value` syntax that `cmd.exe` does not understand.
- `next lint` is deprecated (removal in Next.js 16); the storefront reports two
  `react-hooks/exhaustive-deps` warnings.
- `GET /store/locales` 404s (the storefront calls it; harmless).
- The search index is seeded when the backend boots; there is no standalone
  search route in the storefront.
- `pnpm.overrides` in the root `package.json` is ignored by pnpm 10 — the
  active dependency overrides live in `pnpm-workspace.yaml` (`sharp`,
  `proxy-addr`, chosen to address published GHSA advisories).
- No Redis required for local development (an in-memory fallback is used).
- `pnpm audit --prod` reports transitive advisories (0 critical). Overrides in
  `pnpm-workspace.yaml` already address the most severe production-chain
  findings; the rest sit in dev/build tooling (vite, postcss, grpc-js, ...).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Planned work is tracked in
[ROADMAP.md](ROADMAP.md).
