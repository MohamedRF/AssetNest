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

## Quality gates (P6-05)

The following are automated or scripted and should be run before a release
candidate; record the actual output rather than assuming.

### Performance / load

- `pnpm --filter @assetnest/api exec vitest run src/perf/perf.e2e.test.ts` —
  1k-row list/search/history probe on embedded PostgreSQL (informational).
- `pnpm ops:load-test` (or `LOAD_TEST_BASE_URL=… LOAD_TEST_EMAIL=… LOAD_TEST_PASSWORD=… node scripts/load-test.mjs`)
  against a disposable/staging stack. It exercises health, auth/me, the asset
  list and search, and reports per-probe p50/p95/p99 and the error rate. It
  measures through response-body consumption and exits non-zero above a 2%
  error rate. Use a real PostgreSQL 17 instance to record release evidence.
  Both credential variables are required for authenticated probes. A supplied
  login must resolve a workspace or specify `LOAD_TEST_WORKSPACE_ID`.

### Security

- `apps/api/src/security/tenancy.e2e.test.ts` — cross-tenant reads/writes,
  ID enumeration, invite replay, file type/traversal, optimistic writes.
- `apps/api/src/security/security-headers.e2e.test.ts` — `nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, no `X-Powered-By`, request ids,
  RFC7807 `application/problem+json`, CORS restricted to the configured
  origin, and HttpOnly/SameSite session cookies.
- `apps/api/src/auth/oidc.e2e.test.ts` — state/nonce/PKCE, JWKS verification,
  domain allowlist and account linking.
- `apps/api/src/auth/session-hardening.e2e.test.ts` — idle and absolute
  session timeouts revoke and reject.
- `apps/api/src/auth/api-tokens.e2e.test.ts`, `mcp.e2e.test.ts`,
  `exports.e2e.test.ts`, `policies.e2e.test.ts`, `approvals.e2e.test.ts` —
  scope enforcement and policy/approval bypass attempts.

### Accessibility

- `pnpm --filter @assetnest/web exec vitest run src/pages/a11y.test.tsx` —
  axe-core smoke on the login and approvals screens. The target is WCAG 2.2 AA
  for main flows; run the Playwright critical path on Chromium plus one other
  engine before release.

### Chaos / failure

- `apps/api/src/health/health.test.ts` — liveness stays 200 with an
  unreachable database, readiness returns a leak-free 503.
- `apps/worker/src/relay.test.ts`, `email.test.ts`, `webhooks.test.ts` —
  outbox retries, idempotent delivery, dead-letter and webhook retry/backoff.
- `apps/api/src/ai/ai-disabled.e2e.test.ts` — the core app works with AI off.
- `apps/api/src/ai/ai-draft-persistence.e2e.test.ts` — a forced draft-write
  failure never leaks the draft or raw driver error.
- `apps/api/src/exports/exports.e2e.test.ts` — stream/formula-injection
  hardening and failure cleanup.

### Release gate evidence to record

For each release candidate, capture: exact commands and exit codes, test
totals, the load-probe JSON, the backup/restore drill output, the migration
upgrade check, and the accessibility/security smoke results. Do not mark a gate
passed from an unrun command.
