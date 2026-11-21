# Design note — P1-02 workspaces, members, invites (2026-11-18)

P1-01 landed: first-party session (opaque token, sha256 at rest), sliding `last_seen_at`, Argon2id password hashing, failed-attempt lockout (5 tries → 15 min), stateless HMAC CSRF synchronizer token, global `SessionGuard` → `CsrfGuard` → `WorkspaceGuard`, deny-by-default permissions via `@RequirePermissions`, bootstrap-only registration (`POST /auth/register`, closes once any user exists).

Decisions for P1-02 (ratify at review):

1. **Invitations without email (safe default).** `POST /workspaces/:workspaceId/invites` creates a single-use, 7-day, hashed-at-rest invite token and returns the `acceptUrl` **once** to a caller with `workspace:manage`. No mail dependency; the admin transports the link over any trusted channel. `MAIL_TRANSPORT=log|smtp` can later send the same link best-effort without changing the security posture (the link is a bearer secret either way; it is never logged in plaintext by application logs — only by the explicit mail transport when the operator configures email).
2. **Invite acceptance.** `POST /auth/invites/accept` `{token, displayName, password}`. Unknown email → creates the account (Argon2id). Existing email → requires that account's password to match (or an existing session) — inviting must never silently seize or merge accounts.
3. **Last-owner protection.** Removing/demoting the final active `owner` membership is rejected with `LAST_OWNER` (409). Ownership transfer (owner → another member) is a distinct explicit action, owner-only — never implied by `workspace:manage` (admins manage users/roles but cannot grant or revoke ownership).
4. **Audit.** Every workspace/member/invite mutation appends to `audit_log` with workspace_id, actor, action, resource, correlation id (via AsyncLocalStorage request id).
5. **No user enumeration.** Invite creation responses reveal nothing about whether the email already has an account (same 201 shape either way); account creation happens only at accept time.
6. **Slugs** are unique across the deployment; taken slugs get a numeric suffix suggestion (409 `SLUG_TAKEN` with suggestion) rather than silent renaming.
7. **Workspace context** stays server-side: `:workspaceId` route param → `WorkspaceGuard` membership check → `@RequirePermissions` check. Client-selected workspace is UI state only.

Schema impact (migration 0004 `workspace_invites`):
`workspace_invites(id uuid pk, workspace_id fk cascade, email citext-ish text lower-cased, role_key text fk roles, token_hash text unique, status text pending|accepted|revoked, expires_at timestamptz, invited_by uuid fk users set null, created_at, accepted_at, revoked_at)` + partial unique on `(workspace_id, lower(email)) where status = 'pending'` — one pending invite per email per workspace.
