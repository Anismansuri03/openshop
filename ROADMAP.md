# Roadmap

Honest, best-effort intentions — not commitments. Anything here may change.

## Near term

- Fix `test:unit` on Windows (replace POSIX `VAR=value` script syntax with a
  cross-platform runner).
- Migrate `next lint` to the ESLint CLI before Next.js 16 removes it.
- Resolve the two `react-hooks/exhaustive-deps` warnings.
- Document a single-command bootstrap (install → migrate → seed → admin) that
  works with pnpm 10's strict env mode.

## Later

- Optional real payment provider integration (e.g. Stripe) behind clear
  configuration, keeping the test provider as the safe default.
- Accessibility pass on small/inline interactive targets and focus states.
- Content/merchandising pages (about, care guide, returns) as editable data.
- Search UX: dedicated search route backed by the seeded search index.
- CI workflow: lint, typecheck, unit tests, and a headless E2E smoke run.
- Deployment guide with an explicit production-hardening checklist.

## Out of scope

- Shopify feature/parity claims.
- Multi-tenant SaaS features.
