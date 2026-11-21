# Test Strategy and Quality Gates

## Layers

- Unit: domain state transitions, permission policies, custom fields, AI routing and filter AST validation.
- Integration: PostgreSQL transactions, constraints, migrations, outbox and queue idempotency, private document ACL.
- API E2E: NestJS endpoints with sessions, workspace roles, OpenAPI schema and fault cases.
- Web E2E: Playwright onboarding, asset form, search, QR lookup/manual fallback, assign, maintenance, audit and AI configuration.
- Contract: generated TS API client, webhook signature and provider adapter behavior.
- Security: cross-tenant request and ID enumeration; SSRF incl. redirects/DNS rebinding; CSRF; token scope; prompt injection; file security.
- Non-functional: 1k-row import, pagination latency under seeded datasets, restart/retry/recovery and backup restore.

## Deterministic fixtures

Two workspaces (one household, one office), users with owner/admin/member/auditor roles, similar asset IDs, serials with leading zeros, missing warranty, overlapping location names, concurrent transfers, malformed CSV, safe dummy invoices and mock AI endpoints. No real credentials.

## Minimum scenarios

1. Workspace A user cannot view, mutate, export, search or receive webhook for workspace B asset.
2. Unique tags per workspace; same tag permitted in different workspaces.
3. Two concurrent assignments: at most one succeeds, other gets conflict.
4. Expiring warranty notice deduplicates under worker retry.
5. Upload disallows non-approved file and path traversal; download respects membership.
6. Unauthenticated QR opens login, then rechecks authorization.
7. Audit closes immutably and history records discrepancy resolution.
8. CSV import shows bad rows and does not silently skip them.
9. AI provider unavailable: core app unaffected; bounded errors surfaced.
10. AI extract returns draft; no DB write until authorized human approval.
11. Natural language search never emits arbitrary SQL or accesses forbidden fields.
12. Custom endpoint SSRF blocks loopback/metadata IPs unless a specifically authorized local-model exception.
13. API keys never appear in browser responses/worker logs.
14. Subscription-only user sees truthful setup guidance, not a falsely working connection.

## Release gate checklist

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` run and pass (or record explicit blockers).
- Integration tests against disposable PostgreSQL/Redis pass.
- Playwright critical path passes on Chromium and at least one other supported engine.
- Migrations tested fresh install and upgrade.
- Dependency and container vulnerability scan reviewed; critical findings resolved or explicitly risk-accepted.
- Backup restore procedure demonstrated for release candidate.
- Manual accessibility, security and deployment smoke checks recorded.

## AI contract tests

Mock OpenAI-compatible server and deterministic response fixtures; native API live tests opt-in only with budget/secret config. Matrix covers bad credentials, rate limit, timeout, unsupported vision/structured output, empty/malformed JSON, streaming, no usage info, policy consent and fallback boundaries. Maintain provider capabilities as versioned observed facts rather than claims of universal support.
