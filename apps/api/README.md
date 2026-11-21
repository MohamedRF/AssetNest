# @assetnest/api

AssetNest HTTP API — NestJS (ESM, `type: module`), Express platform, TypeScript strict.
Web-only, provider-neutral, no AI required for core operation.

## Layout

```
src/
  main.ts                     # bootstrap: loadConfig() (fail-fast) → NestFactory → listen
  bootstrap.ts                # shared app wiring: /api prefix, URI v1, strict CORS,
                              # security headers, correlation middleware, RFC7807 filter
  app.module.ts               # APP_CONFIG / DATABASE providers (factories), shutdown hook
  health/health.controller.ts # GET /health/live (public), GET /health/ready (DB check, 2s timeout)
  version/version.controller.ts # GET /version
  common/                     # correlation middleware (AsyncLocalStorage), JSON logger,
                              # problem-details filter, zod validation pipe, tokens
```

Served routes (global prefix `/api` + URI versioning default `v1`):
`/api/v1/health/live`, `/api/v1/health/ready`, `/api/v1/version`.
Swagger UI: `/api/docs` (OpenAPI JSON: `/api/docs-json`).

## Required environment

`@assetnest/config` validates the environment fail-fast — boot aborts with an
explicit issue list when invalid. Secrets are never logged.

| Variable         | Required | Notes                                                                                           |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | yes      | e.g. `postgresql://user:pass@host:5432/assetnest`                                               |
| `SESSION_SECRET` | yes      | ≥ 32 bytes of random material                                                                   |
| `ENCRYPTION_KEY` | yes      | base64-encoded 32 bytes (`openssl rand -base64 32`)                                             |
| `NODE_ENV`       | no       | `development` (default, debug logs) \| `test` \| `production` (requires `PUBLIC_APP_URL` https) |
| `PUBLIC_APP_URL` | no       | the ONLY origin allowed by CORS (default `http://localhost:5173`)                               |
| `API_PORT`       | no       | default `3000`                                                                                  |
| `REDIS_URL`      | no       | accepted by config; not used by the API yet                                                     |

See the repository root `.env.example` for the full surface. Do not commit secrets.

## Commands

- `pnpm --filter @assetnest/api build` — compile to `dist/` via `tsc -p tsconfig.build.json`
- `pnpm --filter @assetnest/api dev` — build once, then `node --watch dist/main.js`
- `pnpm --filter @assetnest/api start` — run `dist/main.js`
- `pnpm --filter @assetnest/api test` — vitest run
- `pnpm --filter @assetnest/api typecheck` / `lint`

## Behavior notes

- **Liveness** (`/health/live`) never touches the database.
- **Readiness** (`/health/ready`) runs `SELECT 1` with a 2s timeout; on failure
  returns `503 {status:'unavailable', checks:{database:'down'}}` with **no**
  connection strings, hosts or driver messages.
- **Errors** are RFC 7807-style: `{type:'about:blank', title, status, detail,
instance, code, requestId}`. 5xx responses carry a generic detail; the real
  error is logged server-side as single-line JSON with `requestId`.
- **Correlation**: every request gets an `x-request-id` (uuid, or a safe inbound
  value echoed back) stored in AsyncLocalStorage and returned as a response header.
- **Logging**: single-line JSON to stdout/stderr (`JsonLoggerService`); request
  headers (authorization/cookie) are never logged. The MVP logger is a small
  dependency-free implementation.
- **Auth** is not implemented yet — Swagger documents cookie (`assetnest_session`,
  httpOnly) and bearer schemes for the upcoming auth module.
