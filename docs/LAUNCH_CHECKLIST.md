# Launch checklist (P7-03)

Use this checklist for a release candidate or a production launch. Every box
must be backed by **executed** evidence (command + result, log, or signed
artifact) — do not tick a box from an unrun command.

## 1. Release identity

- [ ] Version chosen and consistent (`pnpm release:check`).
- [ ] `CHANGELOG.md` has a section for the version.
- [ ] Git tag `vX.Y.Z` created from a clean `master`/`main`.
- [ ] Release workflow run completed (or explicitly deferred with a reason).
- [ ] Image digests, SBOMs and `cosign verify` output recorded.

## 2. Code and quality gates

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test` (record totals; uncached full suite preferred)
- [ ] `pnpm build`
- [ ] `pnpm format:check`
- [ ] `pnpm sdk:check` (drift-free)
- [ ] `pnpm audit --prod --audit-level=critical`
- [ ] Migrations applied twice against real PostgreSQL 17 (CI `migrations` job)
- [ ] Container images build (CI `docker` job or local `docker build`)

## 3. Security and privacy

- [ ] Cross-tenant isolation suite green (REST, tokens, MCP, exports, files).
- [ ] Session hardening verified (idle + absolute timeouts, revocation).
- [ ] OIDC state/nonce/PKCE/JWKS verified (mock provider at minimum).
- [ ] Approval workflow bypass attempts return 403/409.
- [ ] Export policy (disable/expiry) blocks create/list/download.
- [ ] Audit retention prune is workspace-scoped and audited.
- [ ] Security headers, CORS and cookie flags verified.
- [ ] No secrets in the repo, images, logs, exports or SBOMs.
- [ ] `SECURITY.md` reporting path and supported versions published.

## 4. Data, backup and upgrade

- [ ] Fresh install: migrations from empty + seed succeed.
- [ ] Upgrade from the previous release: migrations apply; existing rows intact.
- [ ] Backup completed: database dump + private files + `.env` keys.
- [ ] Restore drill passed: `sh infrastructure/scripts/drill-restore.sh`.
- [ ] RPO/RTO documented for this deployment.
- [ ] Rollback image tag and restore procedure recorded.
- [ ] Retention defaults reviewed (`audit_retention_days`, backups).

## 5. Deployment and operations

- [ ] `.env` validated by `@assetnest/config` (fail-fast) on the target host.
- [ ] `NODE_ENV=production` with an `https://` `PUBLIC_APP_URL`.
- [ ] TLS terminated (Caddy or reverse proxy) and certificates valid.
- [ ] `/api/v1/health/live` and `/api/v1/health/ready` return 200 on the target.
- [ ] `/api/v1/version` reports the expected version.
- [ ] Worker health and outbox drain verified (if `REDIS_URL` set).
- [ ] Monitoring/logging: request ids, error rates, queue lag, storage, DB pool.
- [ ] Backup job scheduled and its logs monitored.
- [ ] Resource limits / storage capacity checked.

## 6. Integrations (if enabled)

- [ ] AI disabled path: core works with `AI_ENABLED=false` (offline regression).
- [ ] AI enabled path: provider test, capability matrix, budget/consent, fallback.
- [ ] MCP disabled by default; if enabled, token scopes and rate limits verified.
- [ ] Webhooks: HMAC signature, SSRF policy, retry/dead-letter verified.
- [ ] OIDC: redirect URI registered; sign-in and account linking verified.
- [ ] SMTP: test email delivered and preferences honored.

## 7. Documentation and support

- [ ] `README.md`, `docs/INSTALL.md`, `docs/UPGRADE.md` match the release.
- [ ] `CHANGELOG.md` and release notes published.
- [ ] `CONTRIBUTING.md` and `SECURITY.md` current.
- [ ] Known limitations documented (no mobile, no WAL/PITR, no SCIM, etc.).
- [ ] Support/security contact and response targets published.

## 8. Evidence and sign-off

| Gate                          | Evidence (command / log / artifact) | Owner | Date |
| ----------------------------- | ----------------------------------- | ----- | ---- |
| Version consistency           | `pnpm release:check` output         |       |      |
| Full test suite               | command + totals                    |       |      |
| Real PostgreSQL 17 migrations | CI run / local log                  |       |      |
| Backup + restore drill        | drill output                        |       |      |
| Install check                 | `scripts/install-check.mjs` JSON    |       |      |
| Product demo                  | `scripts/demo.mjs` transcript       |       |      |
| Security checks               | suite names + results               |       |      |
| Release artifacts             | image digests, SBOMs, cosign output |       |      |
| Launch approval               | name / role / date                  |       |      |

**Launch decision:** [ ] Go [ ] Conditional [ ] No-go

Notes / conditions:
