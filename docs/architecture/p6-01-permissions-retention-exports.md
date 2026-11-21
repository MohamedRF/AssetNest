# P6-01 — Fine-grained permissions, audit retention and export policy

Scope: P6-01 workspace policies and audit access.

## 1. Authorization flow (as found)

| Surface    | Where authorization happens                                                                                                                                                                                                                                                                                                                                                                | Notes                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| REST       | `WorkspaceGuard` (global) resolves `:workspaceId`, loads active membership, then enforces `@RequirePermissions(...)`. Non-members get `404 WORKSPACE_NOT_FOUND` (no existence oracle).                                                                                                                                                                                                     | Roles map to permissions through `ROLE_PERMISSIONS` in `@assetnest/domain`; enforcement is code-based, the DB `role_permissions` table is a mirror. |
| API tokens | `SessionAuthGuard` validates the `anst_` token (sha256 at rest, expiry, revocation, workspace binding) and attaches `scopes`. `WorkspaceGuard` has a dedicated branch: token workspace must equal route workspace (else 404) and **every** required permission must be in the token scopes (else `403 INSUFFICIENT_SCOPE`). Tokens never touch global routes (`403 TOKEN_SCOPE_EXCEEDED`). | Token scopes are a subset of `PERMISSIONS`; minting is bounded by the actor's `permissionsForRole`.                                                 |
| MCP        | `@nestjs/mcp` enforces the `scopes` declared on each `@Tool` against the token scopes before the handler runs (`403 insufficient_scope` + `WWW-Authenticate`). Tool bodies resolve an `AutomationIdentity` bound to the token's workspace.                                                                                                                                                 | No MCP tool bypasses the service layer.                                                                                                             |
| Worker     | No HTTP authorization; workers consume outbox rows that already carry a workspace id. Worker code does not touch exports or audit retention today.                                                                                                                                                                                                                                         | Retention pruning is operator-triggered, not scheduled (scheduling is P6-02+).                                                                      |
| Web UI     | Role-based gating only (`workspace.role`); the server is authoritative. Reports page gates on owner/admin/manager/auditor.                                                                                                                                                                                                                                                                 | UI changes are cosmetic; server checks decide.                                                                                                      |

Direct file access: the only route that streams an export is
`GET /workspaces/:workspaceId/exports/:exportId/download`; there is no static
mount of `STORAGE_ROOT` and no other call site of `ExportsService.getForDownload`.
Documents have their own storage/download path, untouched here.

## 2. Permission changes (smallest set)

Added to `PERMISSIONS` (and therefore to valid API-token scopes and MCP
`scopesSupported`):

| Permission       | Meaning                                        | owner | admin | manager | member | auditor     |
| ---------------- | ---------------------------------------------- | ----- | ----- | ------- | ------ | ----------- |
| `audit:read`     | Read the workspace audit trail                 | ✓     | ✓     | –       | –      | **✓ (new)** |
| `audit:manage`   | Read + change audit-retention policy and prune | ✓     | ✓     | –       | –      | –           |
| `exports:manage` | Read + change the export policy                | ✓     | ✓     | –       | –      | –           |

Mapping and behaviour:

- Existing roles keep every permission they had. Owner/admin hold `ALL`, so they
  automatically gain the three new permissions.
- REST audit history and MCP audit tools, resources and prompts require
  `audit:read`. Owners, admins and auditors hold it by role.
- Existing API tokens need explicit `audit:read` to use those endpoints and
  MCP primitives. New scopes can be requested only by an actor whose role
  already holds them (`ApiTokensService.assertScopesWithinAuthority`).
- No workspace data is rewritten by the permission change.

## 3. Audit retention (workspace-scoped)

Policy is stored additively on `workspaces`:

- `audit_retention_days integer NULL` — `NULL` means **retain indefinitely**
  (the default). This is the conservative, reversible choice: audit history is
  never destroyed by surprise, matching the "immutable append" requirement.
  Finite values are validated to `1..3650` days.
- `export_policy_json jsonb NOT NULL DEFAULT '{"enabled":true,"maxAgeDays":null}'`.

Assumptions (documented because the specs leave them open, see `DECISIONS.md`
"Backup and data retention defaults"):

1. Default retention = indefinite. An owner/admin must opt in to a finite
   window. Reversible by setting the column back to `NULL`.
2. Pruning is **operator-triggered** through an authorized endpoint. A workspace
   lock serializes pruning with retention updates.
3. Pruning is strictly workspace-scoped:
   `DELETE FROM audit_log WHERE workspace_id = $1 AND occurred_at < cutoff`.
   `cutoff = now - retentionDays`. A row exactly at the cutoff is **retained**
   (strict `<`). With `NULL` retention the operation is a no-op.
4. Pruning writes its own `audit.retention_pruned` entry _after_ the delete, in
   the same transaction, so the prune is always auditable and is never removed
   by the same run.

Migration `0023` is additive (two `ADD COLUMN`s + a positive-value `CHECK`).
Existing audit rows are never modified or dropped by the migration. The
`role_permissions` table is a non-authoritative mirror refreshed by
`seedRoles` (`pnpm db:seed`), not by the migration — enforcement always reads
`@assetnest/domain`.

## 4. Export policy (workspace-scoped)

`export_policy_json = { enabled: boolean, maxAgeDays: number | null }`
(default `{ enabled: true, maxAgeDays: null }` — preserves current behaviour).

Enforcement lives **inside `ExportsService`** so every caller (REST controller,
MCP tools, future callers) is covered:

- `generate()` — `enabled=false` → `403 EXPORT_DISABLED`. Still requires
  `reports:read` at the route/tool layer.
- `listAll()` — `enabled=false` → returns an empty list plus the effective
  policy. Expired rows are filtered before selecting the 20 most recent exports.
- `getForDownload()` — `enabled=false` → `403 EXPORT_DISABLED`; when
  `maxAgeDays` is set and the export is older than the cutoff → `410
EXPORT_EXPIRED`. A missing file still yields `410 EXPORT_EXPIRED`.

Because the policy is re-read on every list/download, a policy change applies
immediately to **previously generated files**. A user's permission change is
enforced independently by `WorkspaceGuard` on every request, so revoking
`reports:read` (role change, token revocation) blocks download at once. Policy
changes never delete the underlying files — they only block access, so
re-enabling or extending `maxAgeDays` restores access (a reversible default).

Known gap carried forward: a mid-stream read error on the download socket is
handled by destroying the socket (existing A-06 behaviour); that path is
re-used and was re-verified only for the policy/expiry branches, not by fault
injection.

## 5. Migration impact

`0023_absent_peter_quill.sql` (generated by `drizzle-kit generate`):

- `ALTER TABLE workspaces ADD COLUMN audit_retention_days integer` with a
  positive-value CHECK.
- `ALTER TABLE workspaces ADD COLUMN export_policy_json jsonb NOT NULL DEFAULT
'{"enabled":true,"maxAgeDays":null}'`.
  No existing row is rewritten; the migration is safe to re-run. The
  `role_permissions` mirror is populated by `seedRoles`, not by this migration.

## 6. Verification plan

- Unit: domain permission matrix + retention cutoff + export-expiry helpers.
- E2E (embedded PGlite + real Postgres 17 where available): cross-workspace
  isolation, insufficient token scope, revoked access, policy change after
  export creation, retention boundaries, migration preserves existing rows.
- Real PostgreSQL 17 (disposable `postgres:17-alpine`): migration applied twice
  (idempotent), CHECK constraint rejects 0/3651, seed mirror correct, and two
  concurrent prunes returned `DELETE 100` + `DELETE 0` with recent rows intact.
- `pnpm lint`, `typecheck`, `sdk:check`, `test --concurrency=1`, `build`,
  `format:check`.
