# Changelog

All notable changes to AssetNest are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-21

First public self-hostable release. Web-only; core operation never requires AI
or a public cloud service.

### Added

- **Identity & workspaces:** local Argon2id login, opaque HttpOnly sessions with
  CSRF, workspace CRUD, invites, roles (owner/admin/manager/member/auditor),
  audit trail.
- **Inventory:** assets with optimistic version control, immutable history,
  categories, nested locations, vendors, tags, custom fields, search and
  pagination, opaque QR codes, private documents with content validation.
- **Lifecycle:** assignment/return/transfer, warranties, maintenance plans and
  service records, physical audits with immutable close, transactional outbox,
  retries and idempotent notifications.
- **Reporting:** CSV import with per-row verdicts, CSV exports (assets,
  warranties, maintenance) with private downloads and formula-injection
  protection.
- **Integrations:** scoped API tokens (`anst_`), signed HMAC webhooks with SSRF
  protection and a dead-letter ledger, optional MCP server (Streamable HTTP,
  scoped tools/resources/prompts), typed OpenAPI SDK.
- **AI (optional):** provider-neutral adapters (native OpenAI, Anthropic,
  Gemini, generic OpenAI-compatible, local Ollama, optional LiteLLM), per-task
  routing, budgets, consent, invoice/photo drafts with explicit approval, and an
  AI-disabled offline mode.
- **Enterprise hardening:** fine-grained permissions, workspace-scoped audit
  retention and export policy, configurable approval workflows, OIDC SSO
  (authorization code + PKCE), idle/absolute session timeouts.
- **Operations:** Docker Compose reference stack, PostgreSQL 17 migrations,
  backup/restore/drill scripts, load probe, quality-gate documentation, CI and
  release workflows.

### Security

- Server-side tenant isolation on every REST, token, MCP, worker and export
  path; no public document/export links.
- Secrets encrypted at rest (`ENCRYPTION_KEY`), hashed API tokens, no secrets in
  logs, exports or browser responses.
- OIDC id_tokens verified against provider JWKS with issuer/audience/expiry/
  nonce checks; verified-email account linking; optional domain allowlist.
- Security headers, strict CORS, RFC 7807 `application/problem+json` errors.

### Known limitations

- No native mobile app (web-only by design).
- Live third-party OIDC, LiteLLM/native AI provider runs and Docker image
  publishing are documented but not executed in this release's development
  environment.
- No WAL/PITR, SCIM, or scheduled backup sidecar; see `DEPLOYMENT_OPERATIONS.md`.
