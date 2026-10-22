# Roadmap

Honest, best-effort intentions — not commitments. Anything here may change.

## Near term

- Fix `test:unit` on Windows (replace POSIX `VAR=value` script syntax with a
  cross-platform runner) and add the first backend unit tests — the suite
  currently matches zero files.
- Migrate `next lint` to the ESLint CLI before Next.js 16 removes it.
- Resolve the two `react-hooks/exhaustive-deps` warnings.
- Reduce transitive dependency advisories (`pnpm audit --prod`; all dev/build
  tooling chains today, 0 critical).
- Add `loading.tsx` to the main and checkout route groups (other routes
  already have them).

## Later

- Optional real payment provider integration (e.g. Stripe) behind clear
  configuration, keeping the test provider as the safe default.
- Accessibility pass on small/inline interactive targets and focus states.
- Content/merchandising pages (about, care guide, returns) as editable data.
- Search UX: dedicated search route backed by the seeded search index.
- Headless E2E smoke run in CI (lint, typecheck, unit tests, and build are
  already covered by `.github/workflows/ci.yml`).
- Deployment guide with an explicit production-hardening checklist.

## Out of scope

- Shopify feature/parity claims.
- Multi-tenant SaaS features.
