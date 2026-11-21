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

**Current status:** Phase 4 is complete. P4-01 now generates and packages a typed SDK for every REST operation (drift-free; GitHub Actions artifact upload still needs a real runner). P4-02 through P4-05 supply automated scope, replay and MCP evidence. The Node examples ran end to end; the n8n workflows still need a live run. Fresh workspace builds and Compose configuration validation passed locally. Docker image builds still need a running daemon. Phase 5 is now active and all twelve P5 tasks have recorded implementation evidence; live native/custom/local provider calls and a live LiteLLM gateway remain manual steps (no credentials in this environment). An audit-hardening pass (token admin, webhook SSRF pinning, route-bound AI consent, LiteLLM isolation, AI draft log sanitization, CSV injection/stream safety, workspace/audit invariants, per-account cache isolation, transient email retries, and the invoice approval workflow) is implemented and verified; see `TASKS.md` §Audit remediation.

## Phase 5 — Universal AI ecosystem

Provider registry; native OpenAI/Anthropic/Gemini; OpenAI-compatible custom API; local Ollama; optional LiteLLM gateway; credentials, model testing, capability routing, budgets, per-task routes, invoice extraction, photo suggestions, natural language read-only search, AI action approval. **Gate:** cloud/native/custom/local integration contract tests and human approval; AI-off app passes.

**Current status:** All twelve P5 tasks are implemented with automated coverage (adapter unit tests, ai-tasks e2e, ai-invoice-approval e2e, ai-disabled offline regression, connections e2e; 219 API + 14 worker + 32 web + 18 AI + 9 DB + 14 contracts + config/domain green — 325 total). The offline AI-disabled guarantee is proven by test. **Gate evidence still pending (no credentials/services in this environment):** live calls to a real native API, a real OpenAI-compatible endpoint and a real local Ollama, and a live LiteLLM gateway run. The compatibility matrix (`docs/architecture/ai-compatibility-matrix.md`) records these as manual verification steps. The invoice approval workflow is complete (retrieval + explicit atomic approval + idempotent repeat), and the audit-hardening fixes listed in `TASKS.md` §Audit remediation are implemented and verified.

## Phase 6 — Enterprise and hardening

Approvals, audit export, scheduled reports, enterprise SSO, advanced roles, inventory policy templates, backups/restore verification, performance/load testing, security reviews, documentation and release automation. **Gate:** release runbook exercised, migration/rollback/restore tested, documented security acceptance.

## Phase 7 — Production readiness and OSS launch

Install wizard/docs, example environments, admin controls, backup and upgrade procedures, licensing decision, contributor guide, changelog, release images, public demos (with synthetic data), telemetry opt-in only. **Gate:** clean install and upgrade from prior release tested on supported environments.

## Out-of-plan future initiative

Native mobile application only if separately approved after product validation; no mobile folders, SDK-specific dependencies or estimates in these releases. Design API for eventual clients without implementing them.

## Work method

Each phase breaks into vertical slices (migration → API → UI → tests → docs). No parallel editing of shared migrations/schema without coordination. A phase is marked complete only after code review, tests and acceptance evidence.
