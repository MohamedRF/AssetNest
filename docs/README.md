# AssetNest documentation

AssetNest manages equipment inventory, custody, maintenance, and audits on infrastructure you control.
Core inventory does not require AI or a public cloud account.

## Start here

| Goal                      | Guide                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Understand the product    | [Overview and product tour](../README.md)                              |
| Try sample workflows      | [Demo walkthrough](DEMO.md)                                            |
| Install AssetNest         | [Installation options](INSTALL.md)                                     |
| Use the full Docker stack | [Compose setup and configuration](../infrastructure/compose/README.md) |
| Understand the codebase   | [Architecture and repository map](ARCHITECTURE.md)                     |

## Operate an instance

- [Deployment and operations](../DEPLOYMENT_OPERATIONS.md): environment configuration, authentication, backups, and operational procedures.
- [Upgrade and rollback](UPGRADE.md): prepare backups, apply migrations, and recover from a failed upgrade.
- [Security policy](../SECURITY.md): supported versions and private vulnerability reporting.
- [Support](../SUPPORT.md): troubleshooting and reporting problems.

## Build integrations

- [API specification](../API_SPECIFICATION.md): HTTP contracts and integration behavior.
- [TypeScript SDK](../packages/sdk/README.md): typed access to the API.
- [Integration examples](../examples/README.md): scripts, webhooks, and n8n workflows.

A running instance exposes Swagger UI at `/api/docs` and OpenAPI JSON at `/api/docs-json`.

## Contribute and release

- [Contributing](../CONTRIBUTING.md): development setup, conventions, and required checks.
- [Code of conduct](../CODE_OF_CONDUCT.md): participation and moderation expectations.
- [Release process](RELEASE.md): versioning, verification, and publication.
- [Changelog](../CHANGELOG.md): release notes and known limitations.

Documentation is versioned with the source. When following an older release, use the documentation from its tag.
