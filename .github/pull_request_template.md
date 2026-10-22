## What does this PR change?

<!-- Why, in one or two sentences. Link "Closes #N" if applicable. -->

## Verification

<!-- Commands you ran and their results. Be honest about what you did NOT run. -->

- [ ] `pnpm run lint`
- [ ] `pnpm --filter @dtc/backend exec tsc --noEmit`
- [ ] `pnpm --filter @dtc/storefront exec tsc --noEmit`
- [ ] `pnpm --filter @dtc/storefront test`
- [ ] `pnpm run build`
- [ ] Backend changes: migration check against a local dev database (describe above)

## Checklist

- [ ] No secrets, `.env` files, database dumps, or sanitized-log gaps included.
- [ ] Claims stay honest: no "production-ready", "Shopify-compatible", or guaranteed-security language.
- [ ] MIT attribution to Medusa / the Medusa DTC Starter preserved.
- [ ] Existing migrations untouched (new ones added if schema changed).
- [ ] Docs/templates updated if behavior or setup steps changed.
- [ ] No emojis in code, comments, or the commit message.
