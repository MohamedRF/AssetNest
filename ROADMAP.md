# Development Roadmap and Release Gates

All phases are part of the web-only product. **Native mobile is not a scheduled phase.** AI is a planned first-class ecosystem, but core services never depend on external AI.

## Phase 0 — Discovery and skeleton

Monorepo; architecture decisions; OpenAPI conventions; local infrastructure; CI formatting/test; Docker bootstrap; observability baseline; starter README; threat model; seeded demo data. **Gate:** fresh clone boots, health endpoint, migration and tests pass.

## Phase 1 — Identity, workspaces and core inventory

Local/OIDC-ready auth, membership roles, workspace switching, categories, nested locations, assets CRUD, search/list/filter, asset history, QR and document uploads, responsive web UI. **Gate:** core E2E and tenancy checks pass; no public document links.

## Phase 2 — Operational lifecycle

Custody and state transitions, vendor/purchase evidence, warranties, maintenance plans/records, reminders, Redis/BullMQ worker and outbox, notification preferences, activity feed. **Gate:** retries produce no double deliveries; transactional asset history correct.

## Phase 3 — Audits, imports and reporting

Physical audits, discrepancy handling, CSV mapping and error report, exports, saved views, dashboards, performance indexes and accessibility sweep. **Gate:** validated 1k-row CSV, reconciliation consistent, no unbounded report memory.

## Phase 4 — APIs, integrations and extensibility

Public OpenAPI, SDK, scoped API tokens, HMAC webhooks, delivery diagnostics, integration examples, configurable automation rules, optional MCP read-only tools. **Gate:** tokens cannot exceed scopes, replay prevention verified, API examples run.

**Current status:** The typed REST SDK, token scopes, replay protection and MCP integrations have automated coverage. The Node examples ran end to end. Live GitHub Actions artifact upload and an n8n workflow run remain pending.

## Phase 5 — Universal AI ecosystem

Provider registry; native OpenAI/Anthropic/Gemini; OpenAI-compatible custom API; local Ollama; optional LiteLLM gateway; credentials, model testing, capability routing, budgets, per-task routes, invoice extraction, photo suggestions, natural language read-only search, AI action approval. **Gate:** cloud/native/custom/local integration contract tests and human approval; AI-off app passes.

**Current status:** All twelve P5 tasks are implemented with automated coverage (adapter unit tests, ai-tasks e2e, ai-invoice-approval e2e, ai-disabled offline regression, connections e2e; 219 API + 14 worker + 32 web + 18 AI + 9 DB + 14 contracts + config/domain green — 325 total). The offline AI-disabled guarantee is proven by test. **Gate evidence still pending (no credentials/services in this environment):** live calls to a real native API, a real OpenAI-compatible endpoint and a real local Ollama, and a live LiteLLM gateway run. The compatibility matrix (`docs/architecture/ai-compatibility-matrix.md`) records these as manual verification steps. The invoice approval workflow is complete (retrieval + explicit atomic approval + idempotent repeat), and the audit-hardening fixes listed in `TASKS.md` §Audit remediation are implemented and verified.

## Phase 6 — Enterprise and hardening

Approvals, audit export, scheduled reports, enterprise SSO, advanced roles, inventory policy templates, backups/restore verification, performance/load testing, security reviews, documentation and release automation. **Gate:** release runbook exercised, migration/rollback/restore tested, documented security acceptance.

**Current status:** All five P6 tasks are implemented and verified locally.

- **P6-01** — fine-grained permissions (`audit:read`/`audit:manage`/`exports:manage`), workspace-scoped audit retention with an operator-triggered prune, and workspace-scoped export policy enforced inside `ExportsService`.
- **P6-02** — configurable approval workflows (`approvals:read`/`approvals:manage`) with migration `0024` (`workflow_rules`, `approval_requests`, `approval_decisions`), quorum/self-approval rules, and atomic enforcement on asset disposal/retirement.
- **P6-03** — the loss-to-restore drill matched database counts and private files on disposable PostgreSQL 17. A separate upgrade preserved data from `0022` through `0025`.
- **P6-04** — optional OIDC with PKCE, discovery, verified identity binding, and session idle and absolute timeouts. A local mock provider covers the sign-in flow.
- **P6-05** — the PostgreSQL 17 load probe completed 120 requests with zero errors. Security headers, callback data redaction, the approval browser flow and axe accessibility have local verification.

**Verification:** 392 tests passed across 14 uncached tasks (API 262, web 34, domain 26, AI 18, worker 14, contracts 14, DB 13, config 11). The local commands and migration evidence are recorded in `TASKS.md`. Live third-party OIDC, a formal benchmark, cross-engine Playwright, and operator backup scheduling or WAL/PITR remain open release checks.

## Phase 7 — Production readiness and OSS launch

Install wizard/docs, example environments, admin controls, backup and upgrade procedures, licensing decision, contributor guide, changelog, release images, public demos (with synthetic data), telemetry opt-in only. **Gate:** clean install and upgrade from prior release tested on supported environments.

**Current status:** P7-01, P7-02 and P7-03 are implemented and verified locally.

- **P7-01** — version sync/check scripts, `CHANGELOG.md`, OCI labels on all images, and `.github/workflows/release.yml` (multi-arch GHCR publish, SPDX SBOMs, keyless cosign sign/verify, provenance attestations, GitHub release). All three images were built locally and their OCI labels inspected; the workflow itself has not run (no runner/registry/OIDC).
- **P7-02** — MIT `LICENSE` (user-approved; ADR-013), `CONTRIBUTING.md`, `SECURITY.md`, `docs/INSTALL.md`, `docs/UPGRADE.md`, README links.
- **P7-03** — `scripts/install-check.mjs` and `scripts/demo.mjs` executed against disposable PostgreSQL 17 (install-check PASS, demo PASS), with `docs/DEMO.md` and `docs/LAUNCH_CHECKLIST.md`.

**Verification:** The version check, SDK packaging, Compose configuration, Docker builds and OCI label checks passed locally. A clean install and a separate upgrade were exercised on PostgreSQL 17. Release acceptance still requires a live runner to publish and sign the images, record provenance and SBOMs, and complete the external sign-offs in `docs/LAUNCH_CHECKLIST.md`.

## Out-of-plan future initiative

Native mobile application only if separately approved after product validation; no mobile folders, SDK-specific dependencies or estimates in these releases. Design API for eventual clients without implementing them.

## Work method

Each phase breaks into vertical slices (migration → API → UI → tests → docs). No parallel editing of shared migrations/schema without coordination. A phase is marked complete only after code review, tests and acceptance evidence.
