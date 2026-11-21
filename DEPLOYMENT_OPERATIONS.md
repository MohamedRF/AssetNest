# Deployment, Operations and Configuration

## Supported initial modes

1. **Development:** Docker Compose for PostgreSQL and Redis; local API, worker and Vite hot reload; optional mock AI server.
2. **Single-host self-hosted:** Docker Compose API, worker, PostgreSQL, Redis, private file storage volume, frontend served by Caddy, scheduled backup job; TLS via Caddy when hostname available.
3. **Advanced:** managed PostgreSQL/Redis, S3-compatible storage, multiple API/worker replicas, reverse proxy, external OIDC. Document only after testing.

## Enterprise SSO (optional OIDC)

AssetNest uses OIDC discovery and the authorization-code flow with PKCE.
Set `OIDC_ENABLED=true` plus `OIDC_ISSUER`, `OIDC_CLIENT_ID` and
`OIDC_CLIENT_SECRET` (for confidential clients). `OIDC_REDIRECT_URI` defaults
to `${PUBLIC_APP_URL}/api/v1/auth/oidc/callback` and must be registered with the
provider. `OIDC_ALLOWED_DOMAINS` restricts which email domains may sign in;
`OIDC_AUTO_CREATE` (default `false`) controls whether a first SSO login may
provision a local account. New links require an explicitly verified email. A
bound account signs in through its provider subject, and a different subject
cannot claim the same email. Use the exact issuer URL from provider discovery.
Production discovery and callback URLs require HTTPS. Discovery, JWKS and the
token exchange reject redirects. Provider compatibility was tested using a
local mock.

## Environment example (names; no real secrets)

```dotenv
NODE_ENV=development
PUBLIC_APP_URL=http://localhost:5173
API_PORT=3000
DATABASE_URL=postgresql://assetnest:CHANGE_ME@localhost:5432/assetnest
REDIS_URL=redis://localhost:6379
SESSION_SECRET=REPLACE_WITH_RANDOM_32_PLUS_BYTES
ENCRYPTION_KEY=REPLACE_WITH_32_BYTE_ENCODED_KEY
STORAGE_DRIVER=local
STORAGE_ROOT=./var/private-files
MAIL_TRANSPORT=log
AI_ENABLED=false
MCP_ENABLED=false
WEBHOOKS_ENABLED=false
```

Production env must validate secrets and HTTPS; never ship these placeholder values as actual config.

## Containers and health

`web`, `api`, `worker`, `postgres`, `redis`, `backup` (optional per deployment). Liveness `/health/live`, readiness `/health/ready` checks DB/Redis as required; worker health via heartbeat. Startup order does not replace retry logic. Run migrations in controlled one-shot job before rolling API restart.

## Backup and restore

- Database consistent daily backup, incremental or WAL recovery as scale warrants.
- Private object storage and encryption configuration must be backed up with matching retention.
- Document full restoration of database **and** file blobs, credentials reconfiguration, RPO/RTO and test frequency.
- Never claim backup succeeded until restore drill works.

### Reference scripts (P6-03)

`infrastructure/scripts/backup.sh`, `restore.sh` and `drill-restore.sh` implement
the procedure below. They require `pg_dump`/`pg_restore`/`psql` and, for the
drill, `node` plus a built `@assetnest/db`.

```sh
# Nightly backup (database + private files), 30-day retention:
DATABASE_URL=postgres://… BACKUP_DIR=/var/backups RETENTION_DAYS=30 \
  STORAGE_ROOT=/data/private-files sh infrastructure/scripts/backup.sh

# Restore to a fresh database after stopping the API and worker:
DATABASE_URL=postgres://… STORAGE_ROOT=/data/private-files \
  sh infrastructure/scripts/restore.sh /var/backups/assetnest-…dump

# Full loss → restore drill (throwaway databases + file round-trip):
DATABASE_URL=postgres://… sh infrastructure/scripts/drill-restore.sh
```

The scripts are also exposed as `pnpm db:backup`, `pnpm db:restore` and
`pnpm ops:backup-drill`. A cron entry for a self-hosted box:

```cron
15 2 * * * cd /opt/assetnest && DATABASE_URL=… BACKUP_DIR=/var/backups \
  STORAGE_ROOT=/data/private-files sh infrastructure/scripts/backup.sh >>/var/log/assetnest-backup.log 2>&1
```

Targets and assumptions (revisit for each deployment):

- **RPO:** ≤24h with the nightly job; tighten the schedule or enable WAL
  archiving for smaller RPO. **RTO:** restore time of the dump plus file
  extraction; measure it in the drill and record it here.
- **Retention:** `RETENTION_DAYS` (default 30) applies to dumps, storage
  archives and manifests. `0` keeps everything.
- **Consistency:** Stop writers during a paired database and local-file backup
  if documents can change. Keep `BACKUP_DIR` outside `STORAGE_ROOT` and make
  the matching archive available beside the dump or pass it as a second
  argument. Restore to an empty private-file directory to avoid stale files.
  Restore into a fresh database for rollbacks so objects added by newer
  migrations are absent. The database restore is transactional. File
  extraction is a separate step.
- **Encryption:** dumps contain plaintext tenant data. Store them on
  encrypted disks or encrypt at rest; never copy them to public storage.
- **Keys:** `.env` (`SESSION_SECRET`, `ENCRYPTION_KEY`) must be backed up
  separately. Losing `ENCRYPTION_KEY` makes stored integration credentials
  unreadable even after a database restore.
- **Drill frequency:** run `drill-restore.sh` before every release candidate
  and at least monthly; record the measured counts and RTO. The drill uses
  unique databases with the `DRILL_DB` prefix and drops its own databases
  after the run. Set `KEEP_DRILL=1` to keep the restored database for inspection.

### Upgrade / migration drills

- Apply migrations from the previous release to a **copy** of a production-like
  dataset, then run the test suite against it (the `db` test suite already
  upgrades across the migration chain and asserts existing rows survive).
- Never edit an applied migration. Fix forward with a new additive migration
  and restore from backup if an upgrade must be abandoned.
- `drizzle-kit` generates one migration per schema change; CI applies the full
  chain twice against `postgres:17-alpine` to prove idempotency.

## Monitoring

JSON structured logs with requestId/workspaceId (no secrets), metrics for HTTP latency, queue lag, outbox backlog, delivery failures, storage capacity, DB pool, failed auth, AI latency/budget. Integrate optional OpenTelemetry, Prometheus/Grafana or user's existing monitoring stack. Logging sent to third parties is opt-in.

## Release and updates

CI tests, lint, typecheck, lockfile dependency scan, container multi-arch where supported, versioned release tags, CHANGELOG, image digest pinning and rollback instructions. One versioned migration per schema change; use backup before upgrade. Provide reproducible `.env.example`, `compose.yaml`, initial administrator bootstrap and `healthcheck` script.

## Operational failure scenarios

DB loss: fail ready, retry safely without duplicate writes. Redis loss: API still serves read/asset core where possible, queued jobs fail visibly and recover. AI outage: AI-specific UI warns while inventory works. Storage failure: no orphaned/partially committed document references. SMTP failure: retry and preserve delivery audit.

## AI endpoints in self-hosted networks

Local models may use private DNS/localhost-to-host mappings. Make it explicit which destinations are allowed from API network. Restrict link-local metadata ranges and DNS rebinding; protect optional local-network exception behind workspace admin and deployment operator configuration.
