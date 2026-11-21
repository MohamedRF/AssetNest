# AssetNest

**Status:** v0.1.0 · **Target:** Web-only, self-hostable, multi-workspace asset management · **Date:** 2026-11-21

## Product

AssetNest tracks home and office assets, their locations, custodians, documents, maintenance, warranties, lifecycle, audits and integrations. A shared domain engine powers workspace-specific navigation and workflows. Core operation must never require an AI subscription or public cloud service.

## Locked choices

- **Web only** through all planned releases: React, TypeScript, Vite, Tailwind CSS, shadcn/ui. Responsive desktop/tablet/mobile browser and camera QR scan where browser support permits. **No React Native, Flutter, native app, app store, mobile package or mobile implementation task.** Mobile is a separately approved future initiative.
- **Backend:** NestJS on an actively supported Node.js LTS, TypeScript, REST/OpenAPI, modular monolith, Drizzle ORM with PostgreSQL.
- **Processing:** Redis + BullMQ for asynchronous work, with transactional outbox for high-value events.
- **Files:** pluggable local private filesystem or S3-compatible object storage.
- **AI:** optional, user-configurable per-workspace, provider-agnostic, no provider hardcoded. See `AI_ECOSYSTEM.md`.
- **Deployment:** Docker Compose first; ARM64 and AMD64 images as supported. Native deployment documentation later.
- **Repository:** pnpm workspace + Turborepo; individual apps and shared libraries; lock versions when implementation begins.

## Read these in order

1. `PRODUCT_REQUIREMENTS.md` — scope, persona, use cases, acceptance criteria.
2. `ARCHITECTURE.md` — boundaries, events, decisions, repository layout.
3. `DATABASE_DESIGN.md` — entities, constraints, tenancy.
4. `API_SPECIFICATION.md` — endpoint and API behavior.
5. `AI_ECOSYSTEM.md` — adapters, credentials, subscriptions and AI workflows.
6. `SECURITY_PRIVACY.md` — mandatory safeguards.
7. `UX_UI_SPEC.md` — screens, interaction flows and accessibility.
8. `ROADMAP.md` + `TASKS.md` — phase order and executable backlog.
9. `AGENTS.md` + `SUBAGENTS.md` — coding-agent and subagent contracts.
10. `TESTING_QA.md` + `DEPLOYMENT_OPERATIONS.md` — release quality and operations.
11. `DECISIONS.md` — accepted ADRs and topics requiring review.

## Definition of success

A user can deploy locally, set up an office or household workspace, create assets and locations, attach private invoices, assign/transfer assets, scan unique QR codes, track maintenance/warranties, conduct audits, export data, and configure or disable AI. All actions must enforce workspace isolation. Software works without internet for server-hosted core operations (online access from client to server still required).

## Quickstart (development)

Requires Node.js ≥ 22.12 and pnpm 10 (`npm install -g pnpm@10.34.9`).

```bash
cp .env.example .env          # then replace every REPLACE_*/CHANGE_ME value
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile infra up -d   # PostgreSQL 17 + Redis 7
pnpm install
pnpm db:migrate               # applies packages/db migrations (needs DATABASE_URL)
pnpm db:seed                  # optional; uses SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD
pnpm dev                      # api (3000) + web (5173) with hot reload
```

Self-hosted full stack: `docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app up -d --build` (serves via Caddy on port 80). See `infrastructure/compose/README.md` for TLS, backups and troubleshooting. Core operation never requires AI — `AI_ENABLED=false` is the safe default.

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md) — development workflow, conventions and PR expectations.
- [SECURITY.md](SECURITY.md) — private vulnerability reporting and supported versions.
- [CHANGELOG.md](CHANGELOG.md) — release history (Keep a Changelog + SemVer).
- [docs/INSTALL.md](docs/INSTALL.md) — install paths (dev, Compose, managed).
- [docs/UPGRADE.md](docs/UPGRADE.md) — backup-first upgrade and rollback.
- [docs/RELEASE.md](docs/RELEASE.md) — versioning, images, SBOMs and keyless signing.
- [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) — go-live checklist.

**License:** [MIT](LICENSE).

## Repository layout

`apps/api` NestJS API · `apps/web` React/Vite SPA · `packages/config` fail-fast env · `packages/domain` lifecycle/RBAC policies · `packages/db` Drizzle schema + migrations + seed · `packages/contracts` shared wire schemas · `infrastructure/compose` containers · `.github/workflows` CI (lint, typecheck, test, build, audit, PG-17 migration job, image builds). Verification commands: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check`. Implementation status by phase: see `TASKS.md` evidence lines.

## Implementation command

> Read `AGENTS.md`, `SUBAGENTS.md`, `ROADMAP.md`, `TASKS.md` and the linked specs. Start at Phase 0, assign independent scopes to subagents, implement incremental vertical slices with migrations/tests/docs, and stop each phase at its quality gate. Do not introduce mobile development. Do not simulate completed tests or claim integrations work without verification.

## Non-goals

No native mobile app, payments, accounting ledger, ERP replacement, network scanning without explicit opt-in, unrestricted autonomous AI writes, browser-based scraping of consumer AI sessions, or promise of compatibility with every proprietary subscription.
