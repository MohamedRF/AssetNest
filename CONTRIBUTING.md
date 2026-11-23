# Contributing to AssetNest

Thanks for helping improve AssetNest. This guide covers the local workflow and
the expectations for a reviewable change.

## Principles

- **Web-only.** No mobile/native app work.
- **Core works without AI or cloud services.** AI is optional and
  provider-neutral.
- **Tenant isolation is server-side on every path.** Never trust a client
  `workspaceId`.
- **No secrets or real personal data in Git, tests, logs or fixtures.**
- Prefer a small, tested vertical slice over a broad untested change.

## Local setup

Requires Node.js ≥ 22.12, pnpm **10.34.9** (pinned in `package.json`) and Docker (for PostgreSQL/Redis).
CI uses Node.js 24; the reference Docker images use Node.js 26.

Clone your fork and follow the [source installation guide](docs/INSTALL.md#option-a--development-source--infra-containers)
to configure the environment, apply migrations, seed workspace roles, and
start the API and web app.

## Branch workflow

1. Fork the repository and create a focused branch from the latest `master`.
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Make the change and run the checks relevant to it.
4. Open a pull request against `master` using the PR template.
5. Keep the branch up to date and resolve review conversations before merging.

`master` is protected. Pull requests must pass the baseline CI, PostgreSQL migration, and Docker validation
checks. These rules also apply to administrators. Do not push directly to `master` or bypass checks.

For a first contribution, start with the [architecture guide](docs/ARCHITECTURE.md), improve a documentation
example, or look for issues labeled [good first issue](https://github.com/MohamedRF/AssetNest/labels/good%20first%20issue).
For substantial changes, open a feature request to discuss the scope before implementing it.

## Before opening a pull request

```sh
pnpm lint
pnpm typecheck
pnpm test --concurrency=1
pnpm build
pnpm format:check
pnpm sdk:check                # regenerate with `pnpm sdk:generate` if contracts changed
```

If you changed the database schema:

```sh
pnpm db:generate              # one additive migration per schema change
pnpm --filter @assetnest/db test
```

Never edit an applied migration; fix forward with a new one.

## Code conventions

- Strict TypeScript; avoid `any`.
- Validate at the boundary with Zod; use parameterized Drizzle queries.
- Keep business rules in services/domain, not controllers or React components.
- Use the generated OpenAPI SDK types on the web; do not hand-roll wire types.
- Add tests for new behavior and for the negative/authorization case.

## Commits and pull requests

- Keep commits focused; use `type: short summary` (e.g. `fix: …`, `feat: …`).
- Describe what changed, why, and how you verified it.
- Include the exact commands you ran and their results.
- Link relevant issues or task IDs when available.
- Do not include generated artifacts, `.env`, or real data.

## Review

A maintainer will review for correctness, tenant isolation, input validation,
audit coverage and test evidence. Security-sensitive changes also need a
targeted security test (cross-tenant, scope, SSRF, or replay as appropriate).

## Reporting bugs and vulnerabilities

- Bugs: open an issue with reproduction steps and expected/actual behavior.
- Vulnerabilities: **do not** open a public issue. See `SECURITY.md`.

## Community

Follow the [code of conduct](CODE_OF_CONDUCT.md). For installation help or usage questions, see [SUPPORT.md](SUPPORT.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
