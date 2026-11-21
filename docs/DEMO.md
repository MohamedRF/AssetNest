# Demo and reproducible installation evidence (P7-03)

AssetNest ships two dependency-free scripts that exercise a real running stack:

- `scripts/install-check.mjs` — proves a fresh install works end-to-end.
- `scripts/demo.mjs` — a scripted product demo (workspace → category → location
  → asset → export → download).

Both print a PASS/FAIL transcript and exit non-zero on failure. Each run creates
its own workspace and synthetic asset on the target stack. Use a disposable or
staging stack.

## Prerequisites

- A running API (Docker Compose, source, or managed).
- Node.js 22+ on the machine running the scripts.
- An explicit email and password for each script. On an empty database the
  first call can bootstrap-register. On an existing database use an account
  that can sign in and create a workspace.

## Reproducible install check

Start a clean stack (example: disposable PostgreSQL 17 + source API):

```sh
docker run -d --rm --name assetnest-demo-db \
  -e POSTGRES_PASSWORD=assetnest-test -e POSTGRES_DB=assetnest \
  -p 127.0.0.1:55437:5432 postgres:17-alpine

DATABASE_URL=postgresql://postgres:assetnest-test@127.0.0.1:55437/assetnest pnpm db:migrate
DATABASE_URL=postgresql://postgres:assetnest-test@127.0.0.1:55437/assetnest pnpm db:seed

# start the API with SESSION_SECRET / ENCRYPTION_KEY / STORAGE_ROOT set …
```

Then:

```sh
INSTALL_BASE_URL=http://127.0.0.1:3000 \
INSTALL_EMAIL=install@example.com \
INSTALL_PASSWORD="$TEST_PASSWORD" \
node scripts/install-check.mjs
```

Captured output from a disposable PostgreSQL 17 stack:

```json
{
  "status": "PASS",
  "base": "http://127.0.0.1:62409",
  "checks": [
    "health/live 200",
    "health/ready 200 (database up)",
    "version 0.1.0 on v24.15.0",
    "auth (bootstrap-register)",
    "workspace created",
    "asset created",
    "asset read-back"
  ],
  "version": "0.1.0"
}
```

## Product demo

With the same stack running (use the credentials created above, or let the demo
bootstrap-register on a fresh database):

```sh
DEMO_BASE_URL=http://127.0.0.1:3000 \
DEMO_EMAIL=install@example.com \
DEMO_PASSWORD="$TEST_PASSWORD" \
node scripts/demo.mjs
```

Captured output:

```text
health	http://127.0.0.1:62409/api/v1/health/live
auth	login
workspace	Demo Workspace (a9075c74-0a02-4fb0-b9fe-b1c6ec1a0f54)
asset	DEMO-B2922121 id=cfd70fe4-e4e8-48ad-a935-e9235498a500
asset-read	Demo Laptop · available
export	id=ac170880-6b38-474d-9faa-cc97cef4857f status=completed
download	265 bytes · contains DEMO-B2922121
demo	PASS
```

(IDs and the tag suffix vary per run.)

## What the demo covers

| Step                | API call                                              | Asserts                    |
| ------------------- | ----------------------------------------------------- | -------------------------- |
| Health              | `GET /api/v1/health/live`                             | 200 `ok`                   |
| Sign in             | `POST /auth/login` or bootstrap `POST /auth/register` | session cookie + CSRF      |
| Identity            | `GET /auth/me`                                        | user + workspaces          |
| Workspace           | `POST /workspaces`                                    | fresh workspace            |
| Category / location | `POST /workspaces/:ws/categories`, `/locations`       | 201                        |
| Asset               | `POST /workspaces/:ws/assets`                         | 201, tag                   |
| Read-back           | `GET /workspaces/:ws/assets/:id`                      | same tag                   |
| Export              | `POST /workspaces/:ws/exports`                        | 201, `completed`           |
| Download            | `GET .../exports/:id/download`                        | CSV contains the asset tag |

## Cleanup

```sh
docker stop assetnest-demo-db
```

The demo and install-check workspaces live in the target database. Drop the
disposable database or delete those specific workspaces when finished.

## Use as release evidence

Run both scripts against the release candidate and capture:

- the exact command and exit code,
- the install-check JSON,
- the demo transcript,
- the target version/commit and database engine.

Attach them to the release notes alongside the [release evidence](RELEASE.md#6-release-evidence).
