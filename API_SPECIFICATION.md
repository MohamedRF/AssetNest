# REST API Contract — v1

## Contract principles

Base path `/api/v1`. OpenAPI is generated from NestJS and committed in CI as artifact. Auth by CSRF-protected session for web, scoped tokens for automation. APIs are always workspace-scoped. For errors return `{type,title,status,detail,instance,code,requestId}` without sensitive internals. All list endpoints: `pageSize` capped at 100, `cursor` or explicit page, sort whitelist, filters validated. Mutating requests validate body and use idempotency where necessary.

## Endpoint catalog

### Session / workspace

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password-reset` (if local auth enabled)
- `GET /workspaces`, `POST /workspaces`, `GET/PATCH /workspaces/:workspaceId`
- `GET/POST /workspaces/:workspaceId/members`, `PATCH/DELETE /workspaces/:workspaceId/members/:memberId`
- `GET /workspaces/:workspaceId/roles`, `GET /workspaces/:workspaceId/audit-log`

### Asset catalog

- `GET/POST /workspaces/:workspaceId/assets`
- `GET/PATCH /workspaces/:workspaceId/assets/:assetId`
- `POST /workspaces/:workspaceId/assets/:assetId/archive`
- `GET /workspaces/:workspaceId/assets/:assetId/history`
- `GET /workspaces/:workspaceId/assets/:assetId/qr` (signed/authorized QR action)
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
- `POST /workspaces/:workspaceId/exports`, `GET /.../exports/:id`

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
- `GET /workspaces/:workspaceId/ai/jobs/:jobId`
- `POST /workspaces/:workspaceId/ai/jobs/:jobId/approve` (explicit user confirmation)

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
