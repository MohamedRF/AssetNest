# Security Policy

AssetNest is a self-hosted, multi-workspace application. We take tenant
isolation, credential handling and private files seriously.

## Supported versions

| Version | Supported         |
| ------- | ----------------- |
| 0.1.x   | ✅ Security fixes |
| < 0.1   | ❌ Not supported  |

Before reporting, include the version or commit you are running. The release workflow is configured
to sign container images and publish SBOMs; see [the release process](docs/RELEASE.md) and verify
the artifacts attached to the release you use.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Use [GitHub's private vulnerability reporting](https://github.com/MohamedRF/AssetNest/security/advisories/new):

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Include:
   - affected version / commit,
   - a description and impact,
   - reproduction steps or a minimal proof of concept,
   - any relevant logs or request/response pairs (redact real data).

If private reporting is unavailable, contact the maintainers through the
public contact listed on [the maintainer's GitHub profile](https://github.com/MohamedRF). Please do not include real personal data,
credentials or customer content in the report.

We aim to:

- acknowledge a report within **3 working days**,
- provide a triage update within **10 working days**,
- ship a fix or documented mitigation as soon as practical, and credit reporters
  who want it.

Please give us a reasonable window to investigate before public disclosure.

## Scope

In scope:

- Authentication, session and CSRF handling.
- Workspace/tenant isolation (REST, API tokens, MCP, workers, exports, files).
- Authorization/permission bypasses, including approval workflows.
- OIDC/SSO validation (state, nonce, JWKS, issuer/audience).
- SSRF protections for AI endpoints and webhooks.
- File upload/download validation and path traversal.
- Secret storage and accidental secret exposure in logs/exports.
- Backup/restore and migration handling that could expose or corrupt data.

Out of scope:

- Findings that require a compromised host, database or secret.
- Social engineering, phishing or physical attacks.
- Missing hardening that is documented as a known limitation (e.g. no WAL/PITR).
- Automated scanner output without a demonstrated impact.
- Denial-of-service from a legitimate, authenticated account acting within its
  permissions.

## Hardening references

- [Deployment and operations](DEPLOYMENT_OPERATIONS.md) covers backups, deployment settings, and OIDC.
- [Contributor checks](CONTRIBUTING.md#before-opening-a-pull-request) lists test and verification commands.

## Safe harbor

We will not pursue or support legal action against anyone who makes a good-faith
effort to follow this policy, including accidental or good-faith violations.
Please do not access, modify or exfiltrate other users' data, degrade service,
or run automated high-volume scans against production.
