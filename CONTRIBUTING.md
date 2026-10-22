# Contributing to Maison Commerce

Thanks for your interest in contributing.

## Ground rules

- This repository is a starter for local development. Keep claims honest: no
  "production-ready" or Shopify-compatibility claims in docs, code, or PRs.
- Preserve the MIT attribution to Medusa and the Medusa DTC Starter
  (`LICENSE`, README attribution section).
- Never commit secrets: no `.env` / `.env.local` files, credentials, API
  keys, database dumps, or logs. Document new variables in the corresponding
  `.env.template` instead.
- Do not rewrite or delete existing migrations; add new ones.

## Workflow

1. Fork and create a feature branch.
2. Copy the env templates once (`apps/backend` and `apps/storefront` each
   need a `.env` — lint, build, and dev all read them):

   ```powershell
   Copy-Item apps\backend\.env.template apps\backend\.env
   Copy-Item apps\storefront\.env.template apps\storefront\.env.local
   ```

   Then install with `pnpm install` (pnpm 10+; `packageManager` pins 10.11.1
   — Node >= 22.22.0) and fill in `DATABASE_URL` + a publishable key as
   described in `docs/local-development.md`.
3. Make your change, then verify:

   ```bash
   pnpm run lint
   pnpm --filter @dtc/storefront test
   pnpm --filter @dtc/storefront exec tsc --noEmit
   pnpm --filter @dtc/backend exec tsc --noEmit
   pnpm run build
   ```

4. For backend changes, run a migration check
   (`pnpm exec medusa db:migrate` against a local dev database) and describe
   the result in your PR.
5. For storefront behavior changes, consider running the E2E journey
   (`python tests/e2e/e2e-journey.py`) — note it creates one pending order.

## Code style

- ESLint configs are authoritative; never disable a `@medusajs/*` rule to make
  lint pass — fix the underlying issue.
- No semicolons. Double quotes. Two-space indent. Files in kebab-case.
- No emojis in code, comments, or commit messages.

## Commit messages

Short, imperative, lowercase-first summary lines (e.g. `add stock level guard
to cart workflow`). Explain the why in the body when it is not obvious.
