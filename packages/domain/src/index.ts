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
  'reports:read',
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
    'ai:use',
  ],
  member: ['assets:read', 'documents:read'],
  auditor: ['assets:read', 'documents:read', 'audits:manage', 'reports:read'],
};

export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: WorkspaceRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
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
