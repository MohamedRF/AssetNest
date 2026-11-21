# AssetNest — Compose stack (development + single-host self-hosting)

This directory contains the reference deployment for AssetNest:

| File                   | Purpose                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `compose.yaml`         | The stack. Two profiles: `infra` (dev) and `app` (full stack).                      |
| `Dockerfile.api`       | Shared build for the `api` and one-shot `migrate` services.                         |
| `Dockerfile.web`       | Vite build → Caddy static server + reverse proxy.                                   |
| `Caddyfile`            | SPA routing + `/api/*`, `/health/*` proxy + TLS notes.                              |
| `compose.litellm.yaml` | Optional LiteLLM gateway overlay (profile `litellm`); see §4 — never required.      |
| `litellm-config.yaml`  | Example single-upstream LiteLLM routing config for the overlay (mounted read-only). |
| `README.md`            | This file.                                                                          |

`bootstrap-admin.sh` (repo root → `infrastructure/scripts/`) sanity-checks your
`.env` before the first start; see "First-time bootstrap" below.

> **Terminology.** "Development" = run the app from source on your host
> (`pnpm dev`) against containerized PostgreSQL/Redis. "Self-hosted" = everything
> runs in Docker; you only visit `http://<host>/`.

## 1. Prepare `.env`

From the **repo root**:

```sh
cp .env.example .env
```

Edit `.env` and replace every `REPLACE_*` / `CHANGE_ME` value. Never commit
`.env` — it is git-ignored and deliberately excluded from Docker build contexts
by the root `.dockerignore`.

In addition to the variables in `.env.example`, the compose stack interpolates
and requires these **compose-only** variables (they are intentionally not in
`.env.example`):

```dotenv
POSTGRES_USER=assetnest
POSTGRES_PASSWORD=change-me-url-safe-password   # [A-Za-z0-9._-]+ for the reference stack
POSTGRES_DB=assetnest
# Optional:
# POSTGRES_PORT=5432
# REDIS_PORT=6379
# WEB_PORT=80
```

`SESSION_SECRET` and `ENCRYPTION_KEY` must satisfy `@assetnest/config` or the
API (and the migrate job) will refuse to boot — fail fast, by design:

```sh
openssl rand -base64 48    # SESSION_SECRET  (any >= 32 bytes of material)
openssl rand -base64 32    # ENCRYPTION_KEY  (must base64-decode to exactly 32 bytes)
```

For **real production** also set `NODE_ENV=production` and an
`https://` `PUBLIC_APP_URL` in `.env` — the config layer rejects production
mode with a non-TLS URL. The reference compose file deliberately does **not**
override `NODE_ENV`; it comes from your `.env`.

Compose also enforces them at parse time (`${POSTGRES_PASSWORD:?…}`): if they
are missing, `docker compose` refuses to start and prints which one is absent.

> The `api` and `migrate` services assemble `DATABASE_URL` from `POSTGRES_*`,
> overriding the `localhost` value from `.env` (inside the compose network the
> database host is `postgres`). Keep `POSTGRES_PASSWORD` URL-safe, or percent-
> encode it by editing the `environment:` block — never hard-code a password in
> `compose.yaml`. Requests go through Caddy; the API is not published directly.

Run all compose commands from the repo root with `--env-file .env` so that both
variable interpolation and the services' `env_file` resolve the same file:

```sh
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile infra up -d
```

(`env_file` in `compose.yaml` points at `../../.env` relative to this directory,
i.e. the repo-root `.env`, so this works regardless of the shell's cwd.)

## 2. Development flow (`infra` profile)

PostgreSQL + Redis only; the apps run on your host:

```sh
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile infra up -d
pnpm install        # first time only (needs network)
pnpm dev            # Turbo: API (NestJS) + web (Vite) with hot reload
```

`.env.example` already points `DATABASE_URL` at `localhost:5432` and
`REDIS_URL` at `localhost:6379`, which matches the published ports (bound to
`127.0.0.1` only). Stop the infra with:

```sh
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile infra down
```

## 3. Self-hosted (single host) flow (`app` profile)

The full stack: postgres, redis, one-shot `migrate`, `api`, `web` (Caddy):

```sh
sh infrastructure/scripts/bootstrap-admin.sh   # pre-flight check of .env
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app up -d --build
```

What happens:

1. `postgres` and `redis` start and become healthy.
2. `migrate` runs `pnpm --filter @assetnest/db migrate` against the compose
   database and exits. The `api` service will not start until it succeeds
   (`depends_on: service_completed_successfully`).
3. `api` starts on port 3000 (internal only), with private files on the
   `private_files` volume at `/data/private-files`.
4. `web` (Caddy) serves the SPA on `${WEB_PORT:-80}` and proxies `/api/*` and
   `/health/*` to the API.

Verify:

```sh
curl -fsS http://localhost/health/live     # via Caddy → api
```

(Note: `/health/live` is provided by the API's health controller; until that
lands, the API's healthcheck reports `unhealthy` — see compose.yaml comments.)

Seed the first administrator (idempotent, empty databases only):

```sh
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app \
  run --rm migrate pnpm --filter @assetnest/db seed
```

`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `.env` are used; the seed only
creates the admin on an empty database.

`infrastructure/scripts/bootstrap-admin.sh` performs these pre-flight checks for
you (file exists, secrets are not the example placeholders, key formats match
`@assetnest/config`) without touching the database. Run it before the first
start: `sh infrastructure/scripts/bootstrap-admin.sh` (or `chmod +x` once and
run it directly).

Stop / update:

```sh
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app down     # keep data
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app pull     # update base images
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app up -d --build  # migrate re-runs first
```

**First build needs network access** (base-image pulls, pnpm install). Build
times: one `pnpm install --frozen-lockfile` + two `tsc`/`vite` builds inside the
images; nothing is fetched at container runtime except what your host allows.

## 4. Optional LiteLLM gateway (AI routing)

LiteLLM is an **optional, independent** gateway that fans AssetNest's
OpenAI-compatible connection out to many upstream providers with budgets,
retries and fallbacks. **AssetNest never requires LiteLLM or Python** — the
native OpenAI/Anthropic/Gemini adapters, the generic OpenAI-compatible adapter
and the local Ollama connector all work without it. Use the `litellm` profile
only if you want LiteLLM's provider routing.

Add the gateway variables to the repo-root `.env` (never commit real keys):

```dotenv
LITELLM_MASTER_KEY=sk-...        # protects the gateway's own API
LITELLM_OPENAI_API_KEY=sk-...    # upstream provider key(s); one LITELLM_<PROVIDER>_API_KEY per upstream
```

The `litellm` service receives **only** `LITELLM_MASTER_KEY` and
`OPENAI_API_KEY` (from `LITELLM_OPENAI_API_KEY`) through `environment:` — there
is deliberately no `env_file`, so `DATABASE_URL`, `SESSION_SECRET`,
`ENCRYPTION_KEY`, SMTP credentials and AssetNest's own AI keys never reach the
gateway container. The image is pinned to a release tag
(`ghcr.io/berriai/litellm:v1.110.2`, released 2026-11-20), not the mutable
`main-stable`; bump it deliberately after reading the release notes.

Then start it together with the `app` stack (from the repo root):

```sh
docker compose --env-file .env \
  -f infrastructure/compose/compose.yaml \
  -f infrastructure/compose/compose.litellm.yaml \
  --profile app --profile litellm up -d
```

Finally, let the API and worker reach it. Add both settings to the repo-root
`.env` (the `api` and `worker` services read it through their `env_file`):

```dotenv
AI_ENABLED=true                         # AI is off by default
AI_PRIVATE_ORIGINS=http://litellm:4000  # comma-separated HTTP(S) origins
```

`AI_PRIVATE_ORIGINS` is AssetNest's SSRF allowlist: the AI transport refuses
plain `http://` endpoints and private (RFC1918 / loopback) addresses unless the
exact origin is listed there. `http://litellm:4000` is plain HTTP on the
private compose network, so without the entry every request fails with
`AI_PROVIDER_INVALID_ENDPOINT`. Keep the list to **trusted internal origins
only** — adding a public host would relax the guard for that origin. TLS
verification is unchanged for public `https://` endpoints: the transport
resolves the hostname, rejects private/link-local/metadata addresses, then pins
the request to that checked address while still verifying the certificate and
SNI against the original hostname.

In AssetNest **Settings → AI → Connections**, add an _OpenAI-compatible API_
connection with Base URL `http://litellm:4000/v1` (the container network name)
and the LiteLLM master key as the API key, then verify a model and route the
tasks you want through it. `infrastructure/compose/litellm-config.yaml` shows a
single-upstream example — add more `model_list` entries for other providers,
fallbacks and budgets (see <https://docs.litellm.ai/docs/proxy/configs>).

The gateway is not published on the host: only the `api` and `worker`
containers can reach it. Stop just the gateway with:

```sh
docker compose --env-file .env \
  -f infrastructure/compose/compose.yaml \
  -f infrastructure/compose/compose.litellm.yaml \
  --profile app --profile litellm stop litellm
```

## 5. TLS / HTTPS

By default the `Caddyfile` serves plain HTTP on `:80`. To terminate TLS on
this host (single-host production):

1. Point a domain's A/AAAA record at the host; open ports 80 and 443.
2. Edit `infrastructure/compose/Caddyfile`: replace `:80` with the hostname,
   e.g. `app.example.com {`.
3. Publish `443:443` in `compose.yaml` (the `web` service).
4. `docker compose ... --profile app up -d --build`

Caddy obtains and renews the certificate automatically and stores it in the
`caddy_data` volume — back up `caddy_data` if you cannot afford re-issuance
delays (Let's Encrypt rate limits apply). Until then, put a TLS terminator of
your choice in front, or access only over a trusted private network — never
expose the plain-HTTP stack directly to the public internet.

## 6. Backup (read this before you trust the stack)

- **Database:** the `pgdata` volume alone is not a backup. Use the reference
  scripts (P6-03): `DATABASE_URL=… STORAGE_ROOT=/data/private-files sh
infrastructure/scripts/backup.sh` writes a custom-format dump, a private-file
  archive and a manifest with row counts, then prunes by `RETENTION_DAYS`.
  A quick manual equivalent is:
  `docker compose ... --profile app exec postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > assetnest-$(date +%F).dump`
- **Private files:** run the backup with the `private_files` volume accessible at
  `STORAGE_ROOT`. The restore script finds the matching storage archive beside
  the dump and extracts it to the configured `STORAGE_ROOT`. See
  `DEPLOYMENT_OPERATIONS.md` for the backup and restore procedure.
- **Keys:** `.env` holds `SESSION_SECRET` / `ENCRYPTION_KEY`. Back them up
  separately and securely; losing `ENCRYPTION_KEY` makes stored integration
  secrets unreadable.
- **Drill restores.** Run `DATABASE_URL=… sh infrastructure/scripts/drill-restore.sh`
  (or `pnpm ops:backup-drill`): it creates throwaway databases, backs up a
  marker asset plus a private file, drops the source, restores, and compares
  counts and the file. Per `DEPLOYMENT_OPERATIONS.md`, never claim a backup
  works until this drill passes.

## 7. Troubleshooting

| Symptom                                                                          | Cause / fix                                                                                                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD: Set POSTGRES_PASSWORD in .env …` at parse time               | Compose-only vars missing — see §1.                                                                                                                |
| `migrate` exits non-zero, api never starts                                       | Check `docker compose ... logs migrate`; usually a bad `DATABASE_URL`/password or a failed migration — fix forward, never edit applied migrations. |
| `api` is `unhealthy`                                                             | `/health/live` not yet implemented, or API crash — check `logs api`.                                                                               |
| Every AI call to `http://litellm:4000` fails with `AI_PROVIDER_INVALID_ENDPOINT` | `AI_PRIVATE_ORIGINS` does not list the gateway origin, or `AI_ENABLED=false` — see §4.                                                             |
| `web` serves 404/blank                                                           | `apps/web/dist` empty — rebuild the web image (`up --build`).                                                                                      |
| Port 5432/6379 already in use                                                    | Override `POSTGRES_PORT` / `REDIS_PORT` in `.env`.                                                                                                 |
| Port 80 in use                                                                   | Override `WEB_PORT` in `.env` (e.g. `8080`).                                                                                                       |

## 8. Known limitations (reference stack, not a hardened production manifest)

- Base images (`node:24-alpine`, `postgres:17-alpine`, `redis:7-alpine`,
  `caddy:2-alpine`) are moving minor tags — record and verify digests per
  release (see `DEPLOYMENT_OPERATIONS.md` → Release and updates).
- Redis runs without authentication; it is only exposed on `127.0.0.1` and the
  internal network. Add `requirepass` + `REDIS_URL` auth for shared hosts.
- No `backup` sidecar yet — backups are your responsibility via §6.
- The LiteLLM overlay pins `ghcr.io/berriai/litellm:v1.110.2` (released
  2026-11-20, digest `sha256:ef798594…`); `main-stable` is intentionally not
  used. Read the release notes before bumping the tag.
- ARM64/AMD64 multi-arch images are a release concern, not covered by this
  local build.
