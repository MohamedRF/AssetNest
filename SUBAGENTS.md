# Subagent Orchestration and Ownership

## Guiding principle

Subagents work on **independent bounded deliverables**, not competing changes to the same files. Main agent retains architecture and integration authority. If the agent harness has no native subagents, perform roles sequentially with the same review boundaries.

## Roles

| Subagent                | Responsibility                                       | Owns initially                                       | Must not change                                    |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Architect               | Domain boundaries, ADR review, integration contracts | docs/architecture/, DECISIONS.md proposals           | migrations and production code without approval    |
| Database Engineer       | Drizzle schema, constraints, migrations, seed        | packages/db/                                         | unrelated API or UI code                           |
| Backend Engineer        | NestJS controllers, services, policies, events       | apps/api/ and domain services                        | shared DB migration without DB agent coordination  |
| Frontend Engineer       | React UI, components, accessibility, state           | apps/web/, packages/ui/                              | secrets or server authorization logic              |
| AI Integration Engineer | Adapters, routing, capability detection, AI tests    | packages/ai/, later AI module                        | business asset writes outside approved API         |
| Security Reviewer       | Threat model and targeted security tests             | tests/security/, SECURITY_PRIVACY.md recommendations | production bypasses or blind approval              |
| QA Engineer             | Unit/integration/E2E/performance test cases          | tests/, relevant test files                          | changing app logic to make tests artificially pass |
| DevOps Engineer         | Compose, CI/CD, backups, monitoring                  | infrastructure/, .github/                            | production credentials                             |
| Documentation Engineer  | Install guides, developer examples, user docs        | docs/, README updates                                | contracts without technical review                 |

## Task dispatch template

```text
Task ID:
Context files:
Owned paths:
Dependencies:
Deliverables:
Acceptance criteria:
Required tests:
Forbidden scope:
Expected handoff format (files + test results + risks):
```

## Parallelizable work plan

- Phase 0: Architect and DevOps and UI design system can research in parallel; database schema requires architect review before merged migrations.
- Phase 1: Backend and frontend can implement against agreed OpenAPI contract; DB agent owns migrations; QA writes tenancy tests in parallel.
- Phase 2: Maintenance and custody domain slices parallel only after shared asset events finalized; worker outbox separate ownership.
- Phase 3: Reports and audit UI parallel with imports once indexed views/DTOs agreed.
- Phase 4: MCP, SDK and webhooks parallel after token/scope contract agreed.
- Phase 5: native model adapters can be split among separate agents **only after** AI contract and fixture tests are frozen; a coordinator merges and checks provider capabilities; UI and provider secrets must be reviewed by Security Reviewer.

## Integration protocol

1. Lead creates one canonical design contract per vertical slice.
2. Each agent uses its own branch/worktree (if supported) and posts change list and tests.
3. Lead validates conflicts, builds and runs contract/integration tests after merging.
4. Security Reviewer checks tenant isolation and secret handling on every phase.
5. QA independently reproduces acceptance criteria.
6. Lead updates `TASKS.md` only after verification.

## Fail-safe instructions

No agent should invoke external paid APIs without explicit configured credentials and budget. Do not create accounts or purchase services. Do not leak raw invoices into test fixtures. Use synthetic fixtures and opt-in AI integration tests; always ship deterministic mock adapters for CI. If a tool is unavailable, explicitly state the limitation, don't fake a run.
