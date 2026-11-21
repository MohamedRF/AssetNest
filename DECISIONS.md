# Architectural Decision Records (ADR Index)

## Accepted

- ADR-001: **Web-only current roadmap.** Responsive React/Vite PWA-style UI is allowed; no native mobile app scope. Revisit only under a new written initiative.
- ADR-002: **NestJS/Node LTS modular monolith.** Lower coordination and operational complexity than microservices.
- ADR-003: **PostgreSQL + Drizzle.** Strong relational constraints, explicit transactions, migration control.
- ADR-004: **React/Vite + Tailwind/shadcn.** Authenticated SPA, no SSR dependency for asset management.
- ADR-005: **REST/OpenAPI.** Single authoritative contract and typed client. No GraphQL requirement.
- ADR-006: **Redis/BullMQ with outbox.** Reliable asynchronous reminders, imports and webhooks.
- ADR-007: **Private pluggable file storage.** Filesystem default, S3-compatible in advanced deployments.
- ADR-008: **Provider-neutral optional AI.** Native + generic OpenAI-compatible + local + gateways, task capability gating, human approval; subscriptions only via official authorization.
- ADR-009: **Workspace tenancy.** Workspace IDs, scoped FKs, business-policy guards and tested isolation.
- ADR-010: **MCP integration separate optional component.** Scoped API, never direct DB or unrestricted tools.
- ADR-011: **ESM everywhere, including the NestJS app.** All workspace packages are pure ESM (`type: module`, NodeNext). No dual-package hazard, no `require(esm)` dependency. Date: 2026-11-18. Owner: lead architect.
- ADR-012: **PGlite for local/test migration runs; real PostgreSQL 17 for CI gates.** WASM Postgres executes the identical migration SQL and transaction semantics; the CI `migrations` job applies the chain against `postgres:17-alpine` twice (idempotency check). No SQLite/mocks for DB semantics anywhere. Date: 2026-11-18. Owner: lead architect.

## Decisions requiring explicit review before public release

- Repository/project name: AssetNest is placeholder until naming/trademark check.
- License (AGPLv3, Apache-2.0, MIT etc.) and any commercial model; consult qualified counsel when necessary.
- Default email service and hosted authentication option; local self-hosting must remain functional.
- Backup and data retention defaults for documents, AI jobs and audit events.
- Whether household users can have more than one shared workspace on a deployment.

## ADR format for new decisions

`Context`, `Options`, `Decision`, `Consequences`, `Security/privacy impact`, `Revisit criteria`, `Date`, `Owner`.
