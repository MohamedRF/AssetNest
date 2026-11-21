# Deployment, Operations and Configuration

## Supported initial modes

1. **Development:** Docker Compose for PostgreSQL and Redis; local API, worker and Vite hot reload; optional mock AI server.
2. **Single-host self-hosted:** Docker Compose API, worker, PostgreSQL, Redis, private file storage volume, frontend served by Caddy, scheduled backup job; TLS via Caddy when hostname available.
3. **Advanced:** managed PostgreSQL/Redis, S3-compatible storage, multiple API/worker replicas, reverse proxy, external OIDC. Document only after testing.

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

## Monitoring

JSON structured logs with requestId/workspaceId (no secrets), metrics for HTTP latency, queue lag, outbox backlog, delivery failures, storage capacity, DB pool, failed auth, AI latency/budget. Integrate optional OpenTelemetry, Prometheus/Grafana or user's existing monitoring stack. Logging sent to third parties is opt-in.

## Release and updates

CI tests, lint, typecheck, lockfile dependency scan, container multi-arch where supported, versioned release tags, CHANGELOG, image digest pinning and rollback instructions. One versioned migration per schema change; use backup before upgrade. Provide reproducible `.env.example`, `compose.yaml`, initial administrator bootstrap and `healthcheck` script.

## Operational failure scenarios

DB loss: fail ready, retry safely without duplicate writes. Redis loss: API still serves read/asset core where possible, queued jobs fail visibly and recover. AI outage: AI-specific UI warns while inventory works. Storage failure: no orphaned/partially committed document references. SMTP failure: retry and preserve delivery audit.

## AI endpoints in self-hosted networks

Local models may use private DNS/localhost-to-host mappings. Make it explicit which destinations are allowed from API network. Restrict link-local metadata ranges and DNS rebinding; protect optional local-network exception behind workspace admin and deployment operator configuration.
