# AssetNest

AssetNest is a self-hosted asset manager for households and teams. Use it to find equipment, track who has it, keep purchase and warranty records, plan maintenance, and reconcile physical inventory. Each workspace has its own inventory, members, and policies.

**Current version:** 0.1.0 · **Interface:** Web browser · **License:** [MIT](LICENSE)

Core inventory, custody, audits, reports, and administration run on your own infrastructure. AI and external integrations are optional.

## What you can do

| Area                     | Capabilities                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory                | Organize assets into categories and nested locations. Record asset tags, serial numbers, condition, status, purchase details, and private attachments. Find assets by filtering, searching, or opening QR labels.                      |
| Custody and lifecycle    | Assign, transfer, and return assets. Review asset history, track warranties, and record planned and completed maintenance.                                                                                                             |
| Audits and reporting     | Reconcile physical inventory, record discrepancies, and review activity. Preview CSV imports with row-level validation and export asset, warranty, and maintenance reports.                                                            |
| Workspace administration | Manage members and roles, configure audit retention and export access, and require human approval for retirement or disposal. Use local sign-in or configure an OIDC provider.                                                         |
| Integrations             | Use the versioned REST API, generated TypeScript SDK, scoped API tokens, signed outbound webhooks, or the optional Model Context Protocol (MCP) endpoint.                                                                              |
| Optional AI              | Draft asset records from invoices, suggest categories from photos, filter assets with natural language, generate maintenance suggestions, and ask read-only questions about an asset. Review proposed records before applying changes. |

## Quick start with Docker Compose

You need Docker with Compose v2. The reference stack includes PostgreSQL 17, Redis 7, a migration job, the API, the background worker, and Caddy for the web app.

1. Clone the repository and open it in your terminal.

   ```sh
   git clone https://github.com/MohamedRF/AssetNest.git
   cd AssetNest
   ```

2. Prepare the deployment configuration using the [environment template](.env.example) and the [Compose setup guide](infrastructure/compose/README.md#1-prepare-env). Set the database credentials and generate a session secret and encryption key. Use `PUBLIC_APP_URL=http://localhost` for local evaluation on the default web port. Remove both seed credentials to create the first account in the browser. Keep AI disabled for the initial setup.
3. Set `ASSETNEST_CONFIG` in your shell to the absolute path of the configuration you prepared. Start the stack from the repository root and initialize the built-in workspace roles.

   ```sh
   docker compose --env-file "$ASSETNEST_CONFIG" -f infrastructure/compose/compose.yaml --profile app up -d --build
   docker compose --env-file "$ASSETNEST_CONFIG" -f infrastructure/compose/compose.yaml --profile app run --rm migrate pnpm --filter @assetnest/db seed
   ```

4. Open [http://localhost](http://localhost) for a local evaluation. Create the first account on a fresh database or use the seeded account if you opted into [administrator seeding](docs/INSTALL.md#first-administrator). Create a workspace in **Home** or **Office** mode. Add a location and category, then register your first asset.
5. Check that the API can reach PostgreSQL.

   ```sh
   curl -fsS http://localhost/api/v1/health/ready
   ```

For a network-facing deployment, configure HTTPS and set `PUBLIC_APP_URL` to the public origin. Use a persistent private-file volume and back it up with PostgreSQL. The current build uses local filesystem storage. See the [installation guide](docs/INSTALL.md) and [operations guide](DEPLOYMENT_OPERATIONS.md).

## Develop from source

Use Node.js 22.12 or later and pnpm 10.34.9. Follow the [source setup steps](docs/INSTALL.md#option-a--development-source--infra-containers) to start PostgreSQL and Redis, export the host configuration, and apply migrations. The web app runs on port 5173 and the API runs on port 3000 by default.

From the repository root, run the same core checks used by CI.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm sdk:check
```

| Path                                                                                                             | Responsibility                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [apps/web](apps/web)                                                                                             | React, TypeScript, Vite, and Tailwind CSS browser app                                       |
| [apps/api](apps/api)                                                                                             | NestJS REST API, sessions, workspace authorization, and domain workflows                    |
| [apps/worker](apps/worker)                                                                                       | Redis and BullMQ jobs, transactional outbox processing, notification delivery, and webhooks |
| [packages/db](packages/db)                                                                                       | PostgreSQL client, Drizzle schema, migrations, and seed commands                            |
| [packages/domain](packages/domain), [packages/contracts](packages/contracts), [packages/config](packages/config) | Shared business rules, validation contracts, and environment configuration                  |
| [packages/ai](packages/ai), [packages/sdk](packages/sdk)                                                         | AI provider adapters and generated REST client types                                        |
| [infrastructure](infrastructure), [examples](examples)                                                           | Compose deployment, operations scripts, and integration examples                            |

## API and integrations

- **REST and OpenAPI.** Requests use `/api/v1`. A running instance serves Swagger UI at `/api/docs` and the OpenAPI document at `/api/docs-json`. Browser requests use a session cookie and a CSRF header for writes. External automation uses a scoped bearer token from the workspace’s **Integrations** page. [REST API contract](API_SPECIFICATION.md)
- **TypeScript SDK.** Run `pnpm sdk:generate` after a contract change and `pnpm sdk:check` to check for drift. [SDK guide](packages/sdk/README.md)
- **Webhooks and MCP.** Enable these features individually. Verify webhook signatures and deduplicate deliveries. When enabled, MCP is served at `/api/v1/mcp` and uses workspace-scoped API tokens. [CSV import, webhook receiver, n8n, and gateway examples](examples/README.md)

## Optional AI provider configuration

Set `AI_ENABLED=true` to configure AI. A workspace administrator can add provider connections, verify model capabilities, and choose models, timeouts, budgets, and fallback routes by task. Adapters support OpenAI, Anthropic, Gemini, OpenAI-compatible APIs, and local Ollama. Connection credentials are encrypted, and inputs sent to a configured provider depend on the selected task and its consent requirements. [AI endpoint settings](DEPLOYMENT_OPERATIONS.md#ai-endpoints-in-self-hosted-networks) · [Optional LiteLLM setup](examples/README.md#optional-litellm-gateway)

## Security and operations

- **Access and retention.** The server enforces workspace permissions on requests and automation. Audit retention defaults to indefinite and pruning is an explicit administrator action. Export availability and expiry can be configured per workspace. [Security policy](SECURITY.md)
- **Backups and upgrades.** Keep matching database and private-file backups, preserve the encryption key separately, and run a restore drill before relying on backups. Apply migrations before starting upgraded services. [Operations runbook](DEPLOYMENT_OPERATIONS.md) · [Upgrade and rollback guide](docs/UPGRADE.md)
- **Verification and releases.** The test suite covers workspace isolation, API contracts, lifecycle workflows, and failure handling. A disposable-stack demo covers bootstrap, inventory, and CSV export. [Test commands](CONTRIBUTING.md#before-opening-a-pull-request) · [Demo](docs/DEMO.md) · [Release process](docs/RELEASE.md)

## Project information

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md) and [private security reporting](SECURITY.md)
