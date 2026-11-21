# Security, Privacy & Authorization Plan

## Threat model

Actors: unauthenticated attacker, malicious workspace member, compromised browser, malicious file/invoice, hostile custom AI endpoint, malicious integration plugin, replayed webhook and overprivileged service account. Assets and invoices may contain serial numbers, purchase addresses, names and financial details.

## Controls

1. **Tenant isolation:** every data operation scoped to authenticated workspace membership; cross-workspace FKs; integration and queue jobs include scoped context; ownership checked after `id` lookup; automated isolation tests.
2. **Sessions:** secure, HttpOnly, SameSite cookies, session rotation; CSRF protection; strict CORS; strong password hash (Argon2id) if local login; OIDC where supported; login rate limits.
3. **RBAC:** deny-by-default scopes, server authoritative checks, separation of workspace admins and regular users, no client-only permissions.
4. **Files:** MIME magic sniffing, size quotas, allowlist, malware scanning strategy, no path traversal, random opaque keys, no public links; optional pre-signed download with low TTL; HTTPS.
5. **Audit logs:** actor, workspace, action, resource, change IDs, timestamp; immutable append behavior; no credentials or entire invoices in events.
6. **Secrets:** dedicated secret encryption key stored outside database; key rotation plan, masked API keys, no secrets in stack traces, CI logs or CSV exports.
7. **AI / SSRF:** configurable endpoint URL policy, allowlisted private networking for local LLMs, redirect/IP checks, input/output schema validation, permission-bound tools, human approval for writes, explicit cloud data consent.
8. **Webhooks:** HMAC signature, replay window, idempotency event ID, bounded retries and private URL protections for destinations.
9. **Database:** least-privilege app user, TLS for remote DB, encrypted backups where available, migrations separated from runtime privileges when possible.
10. **Supply chain:** dependency lockfile, GitHub Dependabot or equivalent, container scanner, SBOM, signed/reproducible release process as maturity increases.
11. **Privacy:** retention and exports per workspace; delete requests, private access logs, optional redaction, transparent vendor data processors.
12. **Operations:** health/readiness, disk space and storage alerts, backups plus verified restore drill, documented security reporting policy.

## Security gates

P0: no critical auth bypass, cross-tenant read or secret exposure; OWASP API checks and test matrix pass. P1: webhook and document protections verified. AI phase: red-team prompt injection, SSRF and model output validation; subscribe to current MCP authorization guidance.

## Permission matrix (baseline)

- Owner: workspace administration and all asset permissions; cannot view raw credential values after stored.
- Admin: asset lifecycle, users/roles (except ownership transfer), reports, optionally integrations.
- Manager: create/edit/assign assets, maintenance and audits; not secrets.
- Member: read permitted assets and own custody events; cannot list all financial attachments by default.
- Auditor: audit and read-only scope; no asset destruction.
- Automation: explicitly scoped token with expiry and independent audit identity.

## Security checklist for every PR

Auth guard used? workspace resolved server-side? scoped joins? input validated? output excludes sensitive fields? audit event present? idempotency considered? files private? AI/data sharing consent preserved? test added for unauthorized cross-tenant and replay?
