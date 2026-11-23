# Getting help with AssetNest

AssetNest is maintained through this GitHub repository. Start with the guide that matches your task.

| Need                                                 | Start here                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Evaluate the product                                 | [Product tour](README.md#product-tour) and [demo walkthrough](docs/DEMO.md)                                  |
| Install the Docker stack                             | [Docker Compose guide](infrastructure/compose/README.md)                                                     |
| Run from source                                      | [Installation guide](docs/INSTALL.md)                                                                        |
| Configure authentication, AI, backups, or operations | [Deployment and operations](DEPLOYMENT_OPERATIONS.md)                                                        |
| Upgrade or roll back                                 | [Upgrade guide](docs/UPGRADE.md)                                                                             |
| Integrate another system                             | [API specification](API_SPECIFICATION.md), [SDK](packages/sdk/README.md), and [examples](examples/README.md) |
| Contribute a change                                  | [Contributor guide](CONTRIBUTING.md)                                                                         |

## Troubleshoot an installation

1. Record the version or commit you are running and your installation method.
2. Check the prerequisites and configuration steps in the installation guide.
3. For Compose, check service status and the logs of the affected service:

   ```sh
   docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app ps
   docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app logs --tail=100 api worker
   ```

4. Search [existing issues](https://github.com/MohamedRF/AssetNest/issues) for the error or symptom.

Logs may contain details about your deployment. Review and redact them before sharing.

## Report a bug or suggest a feature

Use the [issue chooser](https://github.com/MohamedRF/AssetNest/issues/new/choose).
Bug reports should include reproducible steps, expected and actual behavior, the version or commit,
and relevant environment details. Feature requests should explain the user problem and any workaround.

For a general usage question, search existing issues first. If the documentation leaves a specific question
unanswered, open a [question](https://github.com/MohamedRF/AssetNest/issues/new?template=question.yml)
and include the relevant documentation link and what you tried.

## Security and privacy

Report suspected vulnerabilities through [private vulnerability reporting](https://github.com/MohamedRF/AssetNest/security/advisories/new).
See the [security policy](SECURITY.md) for scope and reporting guidance.

Never attach a complete `.env`, database dump, credentials, session cookies, API tokens, or real customer records
to an issue. Use fictional sample assets and redact screenshots.

## Support expectations

Issues and pull requests are handled as maintainer time permits. There is no guaranteed response time or hosted
support service. See [LICENSE](LICENSE) for the software warranty terms.
