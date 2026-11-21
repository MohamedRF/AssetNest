# AGENTS.md — Mandatory Rules for Coding Agents

## Mission

Implement AssetNest as specified across `README.md`, `PRODUCT_REQUIREMENTS.md`, `ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_SPECIFICATION.md`, `AI_ECOSYSTEM.md`, `SECURITY_PRIVACY.md`, `UX_UI_SPEC.md`, `ROADMAP.md`, `TASKS.md`, `TESTING_QA.md` and `DEPLOYMENT_OPERATIONS.md`.

## Non-negotiables

1. **Web-only.** Do not scaffold or implement mobile apps, Flutter, React Native, Expo, or native platforms. Responsive browser design and browser camera scanning are allowed.
2. Provider-neutral AI: support native, OpenAI-compatible, local models and optional gateways; do not hardcode one vendor; no consumer subscription bypass or undocumented OAuth flows.
3. AI is always optional: core APIs, setup and migrations work without AI keys/services.
4. Tenant authorization is server-side on every endpoint, worker, report, document and AI tool.
5. Do not check secrets, API keys, private user content or real personal data into Git.
6. Avoid microservices and speculative abstractions; implement modular monolith and clear interfaces.
7. Never mark unrun tests as passed or invent performance/compatibility evidence.
8. Ask for approval only for irreversible decisions that cannot be inferred (e.g. license, external spending, production secrets); otherwise choose documented safe defaults and proceed.

## How to work

- Read all specifications before modifying architecture; inspect existing repository state rather than overwriting.
- Begin with current first unchecked `TASKS.md` task and identify its dependency chain.
- Write a short plan and design note; assign **bounded independent subtasks** to subagents according to `SUBAGENTS.md` when harness supports them.
- Create migration and test skeleton before domain handlers; implement end-to-end slice.
- Use generated OpenAPI client/types for frontend; do not duplicate ad hoc wire contracts.
- Use environment config validation and structured logging with correlation IDs.
- All customer-controlled URLs must pass SSRF policy. All writes require input validation and audit history.
- Verify with repository commands; fix failures; update docs and checklist with actual evidence.

## Code conventions

Strict TypeScript; avoid `any`; Zod or class-validator boundary validation consistently; explicit errors and result types; parameterized SQL through Drizzle; small testable services; no business logic in controllers or React UI; functional data transformation without mutable global state. Favor stable libraries with supported maintenance and pinned releases after verification.

## Concurrency and subagents

Delegate design review, domain schema, APIs, UI, AI provider adapters, security audits and tests separately. Define owning paths; no two agents modify the same migration or package lock simultaneously. Main agent integrates and runs the full test suite. See `SUBAGENTS.md`.

## Required completion report

For each task: implemented behavior, changed files, migration impact, commands actually executed and results, test coverage, security/privacy considerations, known limitations, and next task. For every phase: map evidence to gate in `ROADMAP.md`.

## Suggested initial prompt

"Read all Markdown specifications. You are the AssetNest lead implementer and subagent coordinator. Respect web-only scope, the NestJS/React/PostgreSQL stack and provider-neutral optional AI architecture. Start Phase 0, decompose into scoped parallel tasks, implement working code and verify each gate. Update TASKS.md with evidence; do not claim tests passed unless executed."
