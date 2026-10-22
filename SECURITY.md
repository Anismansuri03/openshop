# Security policy

## Supported versions

This repository is a local-development starter. Only the latest `main`
branch receives fixes. There are no release channels or backports.

| Version        | Supported            |
| -------------- | -------------------- |
| latest `main`  | yes                  |
| any fork/clone | your own maintenance |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Prefer GitHub's private reporting: **Security tab -> Report a
  vulnerability** on this repository.
- If that is unavailable, open a minimal issue asking for a private contact
  channel and include no exploit details.

Include: affected file/route, reproduction steps, impact, and (if you have
one) a suggested fix. You should receive an acknowledgement within a few
weeks; fixes for confirmed issues land on `main` with credit if you want it.

## Scope notes (please read before reporting)

- This is a **development starter, not a production deployment**. It ships
  with example secrets in `.env.template` (including `JWT_SECRET=supersecret`)
  that the setup docs tell you to replace. "Default template values are
  guessable on an unconfigured local install" is expected behavior, not a
  vulnerability — but a way to leak *filled-in* `.env` values, committed
  credentials, or secrets in git history would be.
- Checkout uses Medusa's built-in **manual test payment provider** only;
  there is no payment processing surface to attack in this repository.
- Dependency advisories: run `pnpm audit --prod`. Known transitive findings
  are tracked in ROADMAP.md; production-chain issues already have overrides
  in `pnpm-workspace.yaml`.
- Out of scope: denial of service against your own local machine, issues in
  upstream Medusa/Next.js already reported upstream, and anything requiring
  an unpatched production deployment this project explicitly does not
  provide guidance for.

## Reporting a bug that is not security-sensitive

Use the bug report template. Never paste `.env` contents, database
passwords, JWT/cookie secrets, or publishable keys into issues — the
templates ask for sanitized logs on purpose.
