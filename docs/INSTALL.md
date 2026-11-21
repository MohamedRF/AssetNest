# Install AssetNest

AssetNest is a self-hostable, web-only asset manager. This guide covers the
supported installation paths. See the [operations guide](../DEPLOYMENT_OPERATIONS.md)
for production configuration and maintenance.

## Prerequisites

- **Node.js** ≥ 22.12 (for development / source installs).
- **pnpm** 10 (`npm install -g pnpm@10.34.9`).
- **Docker** with Compose v2 (for the reference stack).
- **PostgreSQL 17** (container or managed).
- Optional: **Redis 7** for the worker (BullMQ). The API and core reads work
  without it; queued jobs stay in the outbox and retry when it returns.
- Optional: an **OIDC identity provider** for enterprise SSO.

No AI service or public cloud account is required. `AI_ENABLED=false` is the
safe default and the core application is fully functional with AI off.

## Option A — Development (source + infra containers)

```sh
git clone <repo-url> AssetNest
cd AssetNest
cp .env.example .env
# Edit .env: replace every REPLACE_*/CHANGE_ME value.
# Generate secrets:
#   openssl rand -base64 48   # SESSION_SECRET
#   openssl rand -base64 32   # ENCRYPTION_KEY

pnpm install --frozen-lockfile
pnpm --filter @assetnest/db... build
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile infra up -d --wait

# In a POSIX shell, export the prepared, shell-compatible configuration.
set -a
. ./.env
set +a

pnpm db:migrate
pnpm db:seed          # initializes workspace roles
pnpm exec turbo run dev --env-mode=loose
```

Edit the Compose-only PostgreSQL settings as described in the
[Compose guide](../infrastructure/compose/README.md#1-prepare-env) and keep
`DATABASE_URL` in sync with the published database port and credentials.
Quote values with shell metacharacters or set the same variables directly in
your shell. Set both seed credential variables for a local evaluation with
demo workspaces, or remove both to initialize only the built-in roles.

Open <http://localhost:5173> and sign in with your seeded credentials. If you
skipped demo seeding and the users table is empty, use the bootstrap API
described under [first administrator](#first-administrator).

## Option B — Self-hosted full stack (Docker Compose)

Use the [Docker Compose setup guide](../infrastructure/compose/README.md) to
configure the stack, build the images, apply migrations, seed workspace roles,
and check readiness. It includes Bash and PowerShell examples.

### First administrator

Run the seed command after migrations to initialize workspace roles. With both
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` set, it also ensures the specified
account and demo workspaces exist. Use this option on a disposable evaluation stack.

To start without demo data, leave both variables unset and create the first
account using `POST /api/v1/auth/register` on an empty database. For a source
install, open Swagger UI at `http://localhost:3000/api/docs`. For Compose,
follow [bootstrap without demo data](../infrastructure/compose/README.md#start-without-demo-workspaces).

## Option C — Managed PostgreSQL / external services

1. Provision PostgreSQL 17 and Redis (Redis optional for the worker).
2. Point `DATABASE_URL` / `REDIS_URL` at them. Use TLS for remote databases.
3. Run migrations before starting the API:
   ```sh
   DATABASE_URL=postgres://… pnpm db:migrate
   ```
4. Run the API/worker with `STORAGE_DRIVER=local` and a persistent
   `STORAGE_ROOT`.
5. Put the API behind a TLS reverse proxy and set
   `PUBLIC_APP_URL=https://…` (the config layer refuses production mode with an
   `http://` public URL).
6. Back up the database, private file storage and the deployment keys. Drill a restore
   with `sh infrastructure/scripts/drill-restore.sh` (see `DEPLOYMENT_OPERATIONS.md`).

## Optional: enterprise SSO (OIDC)

Set `OIDC_ENABLED=true`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET` (confidential clients) and register the redirect URI
`${PUBLIC_APP_URL}/api/v1/auth/oidc/callback` with the provider. Optionally set
`OIDC_ALLOWED_DOMAINS` and `OIDC_AUTO_CREATE`. Local password login continues to
work. Details: `DEPLOYMENT_OPERATIONS.md` → Enterprise SSO.

## Configuration reference

`packages/config` is the single source of truth and fails fast on invalid input.
Key variables:

| Variable                          | Purpose                            | Default                         |
| --------------------------------- | ---------------------------------- | ------------------------------- |
| `DATABASE_URL`                    | PostgreSQL connection              | required                        |
| `SESSION_SECRET`                  | Session/CSRF signing (≥32 bytes)   | required                        |
| `ENCRYPTION_KEY`                  | AES-256-GCM key (base64, 32 bytes) | required                        |
| `PUBLIC_APP_URL`                  | Public HTTPS origin                | `http://localhost:5173`         |
| `STORAGE_DRIVER` / `STORAGE_ROOT` | Private file storage               | `local` / `./var/private-files` |
| `REDIS_URL`                       | Worker queue (optional)            | unset                           |
| `MAIL_TRANSPORT`                  | `log` or `smtp`                    | `log`                           |
| `AI_ENABLED`                      | Enable AI features                 | `false`                         |
| `MCP_ENABLED`                     | Enable the MCP endpoint            | `false`                         |
| `WEBHOOKS_ENABLED`                | Enable outbound webhooks           | `false`                         |
| `OIDC_ENABLED`                    | Enable SSO                         | `false`                         |
| `SESSION_IDLE_TIMEOUT_MINUTES`    | Idle session cap (0 = off)         | `120`                           |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS`  | Absolute session cap (0 = off)     | `12`                            |

Never commit `.env`, real secrets or customer data.

## Verify the installation

```sh
curl -fsS http://localhost/api/v1/health/live     # liveness
curl -fsS http://localhost/api/v1/health/ready    # readiness (DB reachable)
```

From the repo root, `pnpm ops:load-test` runs a small read-only load probe
against a running stack. For a reproducible end-to-end install check, see
the [installation smoke test](DEMO.md).

## Troubleshooting

| Symptom                            | Fix                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| API exits at boot                  | Check the error list; usually a missing/short `SESSION_SECRET`, bad `ENCRYPTION_KEY`, or `NODE_ENV=production` with `http://` `PUBLIC_APP_URL`. |
| `migrate` fails                    | Verify `DATABASE_URL`, that PostgreSQL is reachable, and that the migration job runs before the API. Never edit an applied migration.           |
| `/api/v1/health/ready` returns 503 | The database is unreachable. Check credentials, network and TLS.                                                                                |
| Web shows a blank page             | Rebuild and restart the web container with `up --build`.                                                                                        |
| AI calls fail                      | AI is optional; core works with `AI_ENABLED=false`. For local models set `AI_PRIVATE_ORIGINS`.                                                  |
| Login works but API calls 403      | Check the session cookie/CSRF header and the workspace membership/role.                                                                         |

See also `infrastructure/compose/README.md` → Troubleshooting.
