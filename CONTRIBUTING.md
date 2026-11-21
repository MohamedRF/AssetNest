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

Requires Node.js ≥ 22.12, pnpm 10 and Docker (for PostgreSQL/Redis).

```sh
git clone <your-fork-url> AssetNest
cd AssetNest
cp .env.example .env          # replace every REPLACE_*/CHANGE_ME value
pnpm install
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile infra up -d
pnpm db:migrate
pnpm db:seed                  # optional bootstrap admin
pnpm dev                      # api :3000 + web :5173
```

## Before opening a pull request

```sh
pnpm lint
pnpm typecheck
pnpm test
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
- Link the task ID (e.g. `P6-01`) and any relevant issue.
- Do not include generated artifacts, `.env`, or real data.

## Review

A maintainer will review for correctness, tenant isolation, input validation,
audit coverage and test evidence. Security-sensitive changes also need a
targeted security test (cross-tenant, scope, SSRF, or replay as appropriate).

## Reporting bugs and vulnerabilities

- Bugs: open an issue with reproduction steps and expected/actual behavior.
- Vulnerabilities: **do not** open a public issue. See `SECURITY.md`.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
