/**
 * AssetNest domain — pure, framework-free policies shared by API, worker and tests.
 * No I/O here: state transitions and authorization decisions are total functions.
 */

export const ASSET_STATUSES = [
  'available',
  'assigned',
  'checked_out',
  'in_repair',
  'lost',
  'retired',
  'disposed',
  'archived',
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Allowed lifecycle transitions. Terminal-ish states (disposed) may still
 * move to archived for record-keeping. Every mutation goes through the API,
 * is authorized, and appends an immutable asset_events row in the same
 * transaction — never a bare UPDATE.
 */
const TRANSITIONS: Readonly<Record<AssetStatus, readonly AssetStatus[]>> = {
  available: ['assigned', 'checked_out', 'in_repair', 'lost', 'retired', 'archived'],
  assigned: ['available', 'checked_out', 'in_repair', 'lost', 'retired'],
  checked_out: ['assigned', 'available', 'in_repair', 'lost'],
  in_repair: ['available', 'retired', 'disposed'],
  lost: ['available', 'retired', 'disposed'],
  retired: ['disposed', 'archived'],
  disposed: ['archived'],
  archived: [],
};

export function isAssetStatus(value: string): value is AssetStatus {
  return (ASSET_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: AssetStatus): readonly AssetStatus[] {
  return TRANSITIONS[from];
}

export const WORKSPACE_MODES = ['home', 'office'] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export const WORKSPACE_ROLES = ['owner', 'admin', 'manager', 'member', 'auditor'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Permission keys used across the API (see API_SPECIFICATION.md). */
export const PERMISSIONS = [
  'assets:read',
  'assets:write',
  'assets:assign',
  'documents:read',
  'documents:write',
  'audits:manage',
  'audit:read',
  'audit:manage',
  'reports:read',
  'exports:manage',
  'approvals:read',
  'approvals:manage',
  'integrations:manage',
  'ai:use',
  'ai:configure',
  'workspace:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

// NOTE: ownership transfer is NOT implied by workspace:manage. It is a
// distinct service-layer rule (owner-only) enforced in the workspaces module.
export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly Permission[]>> = {
  owner: ALL,
  admin: ALL,
  manager: [
    'assets:read',
    'assets:write',
    'assets:assign',
    'documents:read',
    'documents:write',
    'audits:manage',
    'reports:read',
    'approvals:read',
    'approvals:manage',
    'ai:use',
  ],
  member: ['assets:read', 'documents:read'],
  // Auditors can manage physical audits and read the audit trail.
  auditor: ['assets:read', 'documents:read', 'audits:manage', 'reports:read', 'audit:read', 'approvals:read'],
};

export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: WorkspaceRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

// ─── Audit retention (workspace policy) ─────────────────────────────────────

/** Inclusive bounds for a finite audit-retention window, in days. */
export const AUDIT_RETENTION_MIN_DAYS = 1;
export const AUDIT_RETENTION_MAX_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cutoff timestamp for audit retention. `null` retention means "keep forever"
 * and yields `null` (no pruning). A row exactly at the cutoff is retained
 * (the delete uses a strict `<`). Pure and timezone-safe.
 */
export function auditRetentionCutoff(retentionDays: number | null, now: Date = new Date()): Date | null {
  if (retentionDays === null) return null;
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

export function isValidAuditRetentionDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= AUDIT_RETENTION_MIN_DAYS &&
    value <= AUDIT_RETENTION_MAX_DAYS
  );
}

// ─── Export policy (workspace policy) ───────────────────────────────────────

export interface ExportPolicy {
  /** When false, no export may be created, listed or downloaded. */
  enabled: boolean;
  /** Max age of a generated export, in days. `null` = no expiry. */
  maxAgeDays: number | null;
}

export const DEFAULT_EXPORT_POLICY: ExportPolicy = { enabled: true, maxAgeDays: null };

/** Inclusive bounds for export file lifetime, in days. */
export const EXPORT_MAX_AGE_MIN_DAYS = 1;
export const EXPORT_MAX_AGE_MAX_DAYS = 3650;

/** True when the export is older than the policy's max age. */
export function isExportExpired(createdAt: Date, policy: ExportPolicy, now: Date = new Date()): boolean {
  const cutoff = exportExpiryCutoff(policy, now);
  return cutoff !== null && createdAt.getTime() < cutoff.getTime();
}

export function exportExpiryCutoff(policy: ExportPolicy, now: Date = new Date()): Date | null {
  return policy.maxAgeDays === null ? null : new Date(now.getTime() - policy.maxAgeDays * DAY_MS);
}

/** Asset tag: uppercase letters, digits, hyphen. Unique per workspace. */
const ASSET_TAG_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,63}$/;

export function normalizeAssetTag(tag: string): string {
  return tag.trim().toUpperCase();
}

export function isValidAssetTag(tag: string): boolean {
  return ASSET_TAG_PATTERN.test(normalizeAssetTag(tag));
}

/** Optimistic-concurrency guard for state-changing asset writes. */
export type ExpectedVersion = number;

export class VersionConflictError extends Error {
  readonly expected: ExpectedVersion;
  readonly actual: number;
  constructor(expected: ExpectedVersion, actual: number) {
    super(`Asset version conflict: expected ${expected}, actual ${actual}`);
    this.name = 'VersionConflictError';
    this.expected = expected;
    this.actual = actual;
  }
}

// ─── Approval workflows (P6-02 enterprise workflows) ────────────────────────

/** Actions that a workspace workflow policy may place behind an approval. */
export const WORKFLOW_ACTIONS = ['asset.dispose', 'asset.retire'] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export function isWorkflowAction(value: string): value is WorkflowAction {
  return (WORKFLOW_ACTIONS as readonly string[]).includes(value);
}

export type ApprovalDecision = 'approved' | 'rejected';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'executed';

export interface WorkflowRule {
  action: WorkflowAction;
  /** Number of distinct eligible approvals required to approve the request. */
  requiredApprovals: number;
  /** Roles whose members may approve. */
  approverRoles: WorkspaceRole[];
  /** Whether the requester may also approve their own request. Default false. */
  selfApproval: boolean;
}

export const APPROVAL_REQUIRED_MIN = 1;
export const APPROVAL_REQUIRED_MAX = 10;

/** A rule is valid only with a known action, 1..10 approvals and ≥1 valid role. */
export function isValidWorkflowRule(rule: WorkflowRule): boolean {
  return (
    isWorkflowAction(rule.action) &&
    Number.isInteger(rule.requiredApprovals) &&
    rule.requiredApprovals >= APPROVAL_REQUIRED_MIN &&
    rule.requiredApprovals <= APPROVAL_REQUIRED_MAX &&
    Array.isArray(rule.approverRoles) &&
    rule.approverRoles.length > 0 &&
    new Set(rule.approverRoles).size === rule.approverRoles.length &&
    rule.approverRoles.every((role) => (WORKSPACE_ROLES as readonly string[]).includes(role))
  );
}

/** True once the number of distinct approvals meets the required quorum. */
export function isApprovalQuorumMet(approvals: number, required: number): boolean {
  return approvals >= required;
}

/** A requester may approve only when the rule explicitly allows self-approval. */
export function canSelfApprove(selfApproval: boolean, requesterId: string, actorId: string): boolean {
  return selfApproval || requesterId !== actorId;
}
