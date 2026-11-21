# Run AssetNest with Docker Compose

Use the `app` profile to run the complete stack on one machine. It runs
PostgreSQL, Redis, migrations, the API, the background worker, and a Caddy web
server. Use the `infra` profile when you want PostgreSQL and Redis in Docker
and the application running from source.

Install Git and start Docker before proceeding. Docker Desktop includes
Compose on Windows and macOS. On Linux, use Docker Desktop or install the
Compose plugin for Docker Engine. [Docker Compose installation](https://docs.docker.com/compose/install/)

```sh
docker compose version
git clone https://github.com/MohamedRF/AssetNest.git
cd AssetNest
```

If you already cloned the repository, run the remaining commands from its root.
The first build needs network access to fetch base images and dependencies.

## 1. Prepare `.env`

Copy the [configuration template](../../.env.example) to the repository root
using the command for your shell.

| Shell                           | Command                       |
| ------------------------------- | ----------------------------- |
| Bash, Git Bash, macOS, or Linux | `cp .env.example .env`        |
| Windows PowerShell              | `Copy-Item .env.example .env` |

For a local evaluation, edit the copied file and set the values below. Replace
all angle-bracket placeholders. Use the same database password in both places.

```dotenv
NODE_ENV=development
PUBLIC_APP_URL=http://127.0.0.1:8080
WEB_PORT=127.0.0.1:8080

POSTGRES_USER=assetnest
POSTGRES_DB=assetnest
POSTGRES_PASSWORD=<generated URL-safe database password>
DATABASE_URL=postgresql://assetnest:<same database password>@localhost:5432/assetnest

SESSION_SECRET=<generated session secret>
ENCRYPTION_KEY=<generated 32-byte base64 key>

SEED_ADMIN_EMAIL=<email you will sign in with>
SEED_ADMIN_PASSWORD=<generated login password>
AI_ENABLED=false
```

Use separate random values for the database password, session secret, encryption
key, and login password. In Bash or Git Bash with OpenSSL available:

```sh
openssl rand -hex 24     # POSTGRES_PASSWORD
openssl rand -base64 48  # SESSION_SECRET
openssl rand -base64 32  # ENCRYPTION_KEY
openssl rand -hex 24     # SEED_ADMIN_PASSWORD
```

In PowerShell, use the built-in cryptographic random generator:

```powershell
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$dbPassword = New-Object byte[] 24
$sessionSecret = New-Object byte[] 48
$encryptionKey = New-Object byte[] 32
$loginPassword = New-Object byte[] 24
try {
    $random.GetBytes($dbPassword)
    $random.GetBytes($sessionSecret)
    $random.GetBytes($encryptionKey)
    $random.GetBytes($loginPassword)
    "POSTGRES_PASSWORD=$([BitConverter]::ToString($dbPassword).Replace('-', '').ToLowerInvariant())"
    "SESSION_SECRET=$([Convert]::ToBase64String($sessionSecret))"
    "ENCRYPTION_KEY=$([Convert]::ToBase64String($encryptionKey))"
    "SEED_ADMIN_PASSWORD=$([BitConverter]::ToString($loginPassword).Replace('-', '').ToLowerInvariant())"
} finally {
    $random.Dispose()
}
```

Keep the configuration private. The API, worker, and migration job assemble
their internal database URL using `POSTGRES_*`. The `DATABASE_URL` in the
template is for commands you run directly on the host. The local example
binds the web interface to loopback. For a network-facing installation,
configure [HTTPS](#5-tls--https) and use the public HTTPS origin.

## 2. Development flow (`infra` profile)

Start only PostgreSQL and Redis if you run the application on your host:

```sh
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile infra up -d --wait
```

Then follow the [source installation steps](../../docs/INSTALL.md#option-a--development-source--infra-containers)
to build packages, migrate, seed roles, and start the development servers.

## 3. Self-hosted (single host) flow (`app` profile)

### Build, migrate, and seed

Run these commands from the repository root in Bash or PowerShell.

```sh
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app config --quiet
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app up -d --build
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app run --rm migrate pnpm --filter @assetnest/db seed
```

Compose waits for PostgreSQL to be healthy before running migrations. The API
and worker start after the migration job succeeds. The seed command initializes
workspace roles. If both seed credentials are set, it also creates or finds
the specified user and seeds the Home and Office demo workspaces.

### Verify and sign in

```sh
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app ps -a
curl -fsS http://127.0.0.1:8080/api/v1/health/ready
```

On Windows PowerShell, use `curl.exe` instead of `curl` if `curl` is an alias.
Expect `migrate` to exit with code 0 and readiness to return
`{"status":"ready","checks":{"database":"up"}}`. Open
[http://127.0.0.1:8080](http://127.0.0.1:8080), sign in with the email and
password you set, and select a demo workspace.

### Start without demo workspaces

For a new installation without demo data, remove both seed credential
settings before starting. Run the same seed command to initialize roles.
On a database with an empty users table, open the instance's Swagger UI at
`/api/docs` and run `POST /api/v1/auth/register` once with your chosen
`displayName`, `email`, and `password`. Then open the web app and create a
workspace in **Settings → Workspace**. Existing installations use invitations
from a workspace owner.

### View logs or stop the stack

```sh
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app logs --tail 100 migrate api web
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app down
```

Running `down` in this form keeps the named volumes. The `--volumes` option
removes the named volumes, including the database and private files. Before
upgrading, follow the [upgrade and rollback guide](../../docs/UPGRADE.md).
[Docker Compose down reference](https://docs.docker.com/reference/cli/docker/compose/down/)

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
3. Set `WEB_PORT=80` and publish `443:443` in `compose.yaml` for the `web` service.
4. Set `NODE_ENV=production` and set `PUBLIC_APP_URL` to your HTTPS origin. Rebuild using the full-stack command in [step 3](#3-self-hosted-single-host-flow-app-profile).

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
| `api` is `unhealthy`                                                             | Check `logs api` for boot errors, including invalid configuration and secrets.                                                                     |
| Every AI call to `http://litellm:4000` fails with `AI_PROVIDER_INVALID_ENDPOINT` | `AI_PRIVATE_ORIGINS` does not list the gateway origin, or `AI_ENABLED=false` — see §4.                                                             |
| `web` serves 404 or a blank page                                                 | Check `logs web` and rebuild the web image with `up -d --build`.                                                                                   |
| Port 5432/6379 already in use                                                    | Override `POSTGRES_PORT` / `REDIS_PORT` in `.env`.                                                                                                 |
| Web port is already in use                                                       | Choose another `WEB_PORT` and update `PUBLIC_APP_URL` to match.                                                                                    |

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
