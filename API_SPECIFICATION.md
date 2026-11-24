# REST API Contract — v1

## Contract principles

Base path `/api/v1`. OpenAPI is generated from NestJS and committed in CI as artifact. Auth by CSRF-protected session for web, scoped tokens for automation. APIs are always workspace-scoped. For errors return `{type,title,status,detail,instance,code,requestId}` without sensitive internals. All list endpoints: `pageSize` capped at 100, `cursor` or explicit page, sort whitelist, filters validated. Mutating requests validate body and use idempotency where necessary.

## Endpoint catalog

### Session / workspace

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password-reset` (if local auth enabled)
- `GET /auth/oidc/config` (public) — `{ oidcEnabled }`
- `GET /auth/oidc/start` (public) — 302 to the configured identity provider (PKCE + state/nonce cookies)
- `GET /auth/oidc/callback` (public) — validates state, exchanges the code, verifies the id_token (JWKS, iss/aud/exp/nonce) and opens a local session
- `GET /workspaces`, `POST /workspaces`, `GET/PATCH /workspaces/:workspaceId`
- `GET/POST /workspaces/:workspaceId/members`, `PATCH/DELETE /workspaces/:workspaceId/members/:memberId`
- `GET /workspaces/:workspaceId/roles`, `GET /workspaces/:workspaceId/audit-log` (requires `audit:read`: owner, admin, auditor)

### Workspace policies (P6-01)

- `GET /workspaces/:workspaceId/policies` (`workspace:manage`) — `{ auditRetentionDays: number|null, exportPolicy: { enabled, maxAgeDays } }`
- `PUT /workspaces/:workspaceId/policies/audit-retention` (`audit:manage`) — `{ retentionDays: number|null }`; `null` = keep forever
- `PUT /workspaces/:workspaceId/policies/export-policy` (`exports:manage`) — `{ enabled, maxAgeDays }`
- `POST /workspaces/:workspaceId/policies/audit-retention/prune` (`audit:manage`) — deletes this workspace's audit rows older than its retention cutoff; no-op when retention is null

Fine-grained permissions added in P6-01: `audit:read`, `audit:manage`, `exports:manage` (owner/admin hold all; auditor gains `audit:read`). API-token scopes accept the same keys and are bounded by the minting actor's role.

### Approvals and workflow policies (P6-02)

- `GET /workspaces/:workspaceId/approvals/rules` (`approvals:read`) — `{ rules: [{ action, requiredApprovals, approverRoles, selfApproval }] }`
- `PUT /workspaces/:workspaceId/approvals/rules` (`approvals:manage`, owner/admin session) — replace the rule set
- `GET /workspaces/:workspaceId/approvals/requests` (`approvals:read`) — `{ requests: [...] }` with optional `status` and `resourceId` filters
- `POST /workspaces/:workspaceId/approvals/requests` (`approvals:read`) — returns 201 with a pending request for `asset.dispose` or `asset.retire` on an asset in this workspace. An active request for the same action and asset returns 409.
- `POST /workspaces/:workspaceId/approvals/requests/:id/decide` (`approvals:manage`, eligible approver role, human only)
- `POST /workspaces/:workspaceId/approvals/requests/:id/cancel` (requester or owner/admin)

Enforcement is server-side in the asset lifecycle service: disposing/retiring an asset with a matching rule requires an approved, unexecuted request (`409 APPROVAL_REQUIRED`); the request is marked `executed` in the same transaction. Default (no rules) preserves existing behavior. Added permissions: `approvals:read`, `approvals:manage`.

### Asset catalog

- `GET/POST /workspaces/:workspaceId/assets`
- `GET/PATCH /workspaces/:workspaceId/assets/:assetId`
- `POST /workspaces/:workspaceId/assets/:assetId/archive`
- `GET /workspaces/:workspaceId/assets/:assetId/history`
- `GET /workspaces/:workspaceId/assets/:assetId/qr` returns an authorized SVG. Use `?format=link` to encode a link to the configured web origin. The default returns the legacy opaque asset code.
- `POST /workspaces/:workspaceId/assets/qr-label-export` accepts up to 100 distinct `assetIds` and returns matching asset details for label downloads. Requires asset and report read permissions and enabled workspace exports.
- `GET/POST/PATCH /workspaces/:workspaceId/categories`
- `GET/POST/PATCH /workspaces/:workspaceId/locations`
- `GET/POST/PATCH /workspaces/:workspaceId/vendors`

### Custody / lifecycle

- `POST /workspaces/:workspaceId/assets/:assetId/assign`
- `POST /workspaces/:workspaceId/assets/:assetId/return`
- `POST /workspaces/:workspaceId/assets/:assetId/transfer`
- `POST /workspaces/:workspaceId/assets/:assetId/status-transition`

### Documents

- `POST /workspaces/:workspaceId/assets/:assetId/documents` (validated upload or short-lived server-issued upload flow)
- `GET /workspaces/:workspaceId/documents/:documentId/download` (authorized)
- `DELETE /workspaces/:workspaceId/documents/:documentId` (retention rules)

### Warranty / maintenance

- `GET/POST /workspaces/:workspaceId/warranties`; `PATCH /.../warranties/:id`
- `GET/POST /workspaces/:workspaceId/maintenance/plans`; `PATCH /.../maintenance/plans/:id`
- `POST /workspaces/:workspaceId/maintenance/records`

### Audits / reports / imports

- `GET/POST /workspaces/:workspaceId/audits`; `POST /.../audits/:id/verify`; `POST /.../audits/:id/close`
- `GET /workspaces/:workspaceId/reports/assets`, `/reports/warranties`, `/reports/maintenance`
- `POST /workspaces/:workspaceId/imports`, `GET /.../imports/:id`, `GET /.../imports/:id/errors`
- `POST /workspaces/:workspaceId/exports`, `GET /workspaces/:workspaceId/exports` (recent eligible exports and effective policy), `GET /workspaces/:workspaceId/exports/:exportId/download`

### Integrations

- `GET/POST /workspaces/:workspaceId/webhooks`; `POST /.../webhooks/:id/test`; `GET /.../webhooks/:id/deliveries`
- `GET/POST /workspaces/:workspaceId/api-tokens`; `DELETE /.../api-tokens/:id`

### AI (feature-flagged)

- `GET/POST /workspaces/:workspaceId/ai/connections`
- `POST /workspaces/:workspaceId/ai/connections/:id/test` (bounded request)
- `GET/POST /workspaces/:workspaceId/ai/models`
- `GET/PUT /workspaces/:workspaceId/ai/routes`
- `POST /workspaces/:workspaceId/ai/tasks/extract-invoice`
- `POST /workspaces/:workspaceId/ai/tasks/asset-suggestions`
- `POST /workspaces/:workspaceId/ai/tasks/query` (read-only allowlisted query planner)
- `POST /workspaces/:workspaceId/ai/tasks/chat` — read-only asset chat; JSON body `{question, assetIds, consent, routeKey?}`, returns `{jobId, draft:{answer}}`
- `POST /workspaces/:workspaceId/ai/tasks/chat/stream` serves the read-only AG-UI pilot described below.
- `GET /workspaces/:workspaceId/ai/jobs/:jobId`
- `POST /workspaces/:workspaceId/ai/jobs/:jobId/approve` (explicit user confirmation)

### Asset chat stream

`POST /workspaces/:workspaceId/ai/tasks/chat/stream` accepts JSON `{question, assetIds, consent, routeKey}`. Use the authenticated session and an `X-CSRF-Token` header. Fetch the provider and its `routeKey` from `GET /workspaces/:workspaceId/ai/tasks/asset_chat/preview` and obtain user confirmation before sending the question. The stream requires `routeKey`. If it returns `AI_ROUTE_CHANGED`, refresh the preview and ask the user to confirm the updated provider before submitting again.

The request requires workspace membership and the `ai:use` and `assets:read` permissions. The server checks asset visibility, provider consent, route and model eligibility, and the workspace AI budget. Tenant and user identity come from the session.

A successful HTTP response uses `200 text/event-stream` and `Cache-Control: no-store, no-transform`. Each SSE data frame carries one JSON event. A run emits `RUN_STARTED`, step events for authorized asset retrieval and response generation, the validated answer in a single `TEXT_MESSAGE_CONTENT` event bracketed by `TEXT_MESSAGE_START` and `TEXT_MESSAGE_END`, then `RUN_FINISHED`. Pre-stream errors use the usual HTTP problem response. A failure after the stream opens ends the run with `RUN_ERROR` carrying a safe message and code while the connection is writable. Treat the first terminal event as final and a connection that closes earlier as incomplete. A disconnect can leave an already-started provider request running until it completes or times out.

The endpoint accepts AssetNest's chat request and emits [AG-UI response events](https://docs.ag-ui.com/concepts/events). The stock [AG-UI HttpAgent](https://docs.ag-ui.com/sdk/js/client/http-agent) sends `RunAgentInput` and needs a request adapter for this endpoint.

## Sample asset create

```json
{
  "assetTag": "OFF-000142",
  "displayName": "Dell Latitude laptop",
  "categoryId": "<uuid>",
  "locationId": "<uuid>",
  "serialNumber": "001ABC42",
  "status": "available",
  "purchase": { "amount": "62999.00", "currency": "INR", "date": "2026-11-18" }
}
```

Response: `201 Created`, resource `id`, `version`, timestamps and audit correlation ID. Asset update accepts `expectedVersion`; stale version returns `409 ASSET_VERSION_CONFLICT`.

## Events (initial)

`asset.created`, `asset.updated`, `asset.assigned`, `asset.returned`, `asset.transferred`, `asset.status_changed`, `warranty.expiring`, `maintenance.due`, `audit.closed`. Events include schema version, workspace ID, event UUID, occurred timestamp and minimal resource IDs. Webhooks are HMAC signed, timestamped, retried with exponential backoff and can be replayed idempotently.

## Authorization scopes

`assets:read`, `assets:write`, `assets:assign`, `documents:read`, `documents:write`, `audits:manage`, `reports:read`, `integrations:manage`, `ai:use`, `ai:configure`, `workspace:manage`. Role grants map to these capabilities, with resource-level checks for members/custodians.
