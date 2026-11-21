import { describe, expect, it } from 'vitest';
import {
  ASSET_STATUSES,
  VersionConflictError,
  allowedTransitions,
  auditRetentionCutoff,
  canSelfApprove,
  canTransition,
  isApprovalQuorumMet,
  isExportExpired,
  isValidAssetTag,
  isValidAuditRetentionDays,
  isValidWorkflowRule,
  normalizeAssetTag,
  permissionsForRole,
  roleHasPermission,
} from './index.js';

describe('asset lifecycle transitions', () => {
  it('has a defined transition policy for every status', () => {
    for (const status of ASSET_STATUSES) {
      expect(Array.isArray(allowedTransitions(status))).toBe(true);
    }
  });

  it('available -> assigned is allowed, available -> disposed is not', () => {
    expect(canTransition('available', 'assigned')).toBe(true);
    expect(canTransition('available', 'disposed')).toBe(false);
  });

  it('archived is terminal for writes (read-only)', () => {
    expect(allowedTransitions('archived')).toEqual([]);
  });

  it('in_repair can end in disposed or return to available', () => {
    expect(canTransition('in_repair', 'disposed')).toBe(true);
    expect(canTransition('in_repair', 'available')).toBe(true);
    expect(canTransition('in_repair', 'assigned')).toBe(false);
  });

  it('every status transition target is a known status', () => {
    for (const from of ASSET_STATUSES) {
      for (const to of allowedTransitions(from)) {
        expect(ASSET_STATUSES).toContain(to);
      }
    }
  });
});

describe('RBAC permission mapping', () => {
  it('owner holds every defined permission', () => {
    expect(permissionsForRole('owner')).toContain('workspace:manage');
    expect(permissionsForRole('owner')).toContain('ai:configure');
  });

  it('member is read-only and cannot assign or configure AI', () => {
    expect(roleHasPermission('member', 'assets:read')).toBe(true);
    expect(roleHasPermission('member', 'assets:write')).toBe(false);
    expect(roleHasPermission('member', 'assets:assign')).toBe(false);
    expect(roleHasPermission('member', 'ai:configure')).toBe(false);
  });

  it('auditor can manage audits but not write assets', () => {
    expect(roleHasPermission('auditor', 'audits:manage')).toBe(true);
    expect(roleHasPermission('auditor', 'assets:write')).toBe(false);
  });

  it('manager cannot touch workspace secrets (integrations/ai config)', () => {
    expect(roleHasPermission('manager', 'integrations:manage')).toBe(false);
    expect(roleHasPermission('manager', 'ai:configure')).toBe(false);
    expect(roleHasPermission('manager', 'assets:assign')).toBe(true);
  });

  it('auditor can read the audit trail but cannot change policy', () => {
    expect(roleHasPermission('auditor', 'audit:read')).toBe(true);
    expect(roleHasPermission('auditor', 'audit:manage')).toBe(false);
    expect(roleHasPermission('auditor', 'exports:manage')).toBe(false);
  });

  it('policy administration is owner/admin only', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(roleHasPermission(role, 'audit:read')).toBe(true);
      expect(roleHasPermission(role, 'audit:manage')).toBe(true);
      expect(roleHasPermission(role, 'exports:manage')).toBe(true);
      expect(roleHasPermission(role, 'approvals:manage')).toBe(true);
    }
    for (const role of ['manager', 'member', 'auditor'] as const) {
      expect(roleHasPermission(role, 'audit:manage')).toBe(false);
      expect(roleHasPermission(role, 'exports:manage')).toBe(false);
    }
  });

  it('managers may manage approvals, auditors may read them, members may not', () => {
    expect(roleHasPermission('manager', 'approvals:manage')).toBe(true);
    expect(roleHasPermission('manager', 'approvals:read')).toBe(true);
    expect(roleHasPermission('auditor', 'approvals:read')).toBe(true);
    expect(roleHasPermission('auditor', 'approvals:manage')).toBe(false);
    expect(roleHasPermission('member', 'approvals:read')).toBe(false);
  });
});

describe('approval workflow rules', () => {
  const valid = {
    action: 'asset.dispose' as const,
    requiredApprovals: 2,
    approverRoles: ['admin', 'manager'] as const,
    selfApproval: false,
  };

  it('accepts a well-formed rule', () => {
    expect(isValidWorkflowRule({ ...valid, approverRoles: [...valid.approverRoles] })).toBe(true);
  });

  it('rejects unknown actions, bad counts, empty roles and duplicates', () => {
    expect(isValidWorkflowRule({ ...valid, action: 'nope' as never })).toBe(false);
    expect(isValidWorkflowRule({ ...valid, requiredApprovals: 0 })).toBe(false);
    expect(isValidWorkflowRule({ ...valid, requiredApprovals: 11 })).toBe(false);
    expect(isValidWorkflowRule({ ...valid, approverRoles: [] })).toBe(false);
    expect(isValidWorkflowRule({ ...valid, approverRoles: ['admin', 'admin'] })).toBe(false);
  });

  it('computes the approval quorum', () => {
    expect(isApprovalQuorumMet(2, 2)).toBe(true);
    expect(isApprovalQuorumMet(3, 2)).toBe(true);
    expect(isApprovalQuorumMet(1, 2)).toBe(false);
  });

  it('only allows self-approval when the rule opts in', () => {
    expect(canSelfApprove(false, 'user-1', 'user-1')).toBe(false);
    expect(canSelfApprove(true, 'user-1', 'user-1')).toBe(true);
    expect(canSelfApprove(false, 'user-1', 'user-2')).toBe(true);
  });
});

describe('audit retention policy', () => {
  it('null retention never yields a cutoff', () => {
    expect(auditRetentionCutoff(null, new Date('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('finite retention subtracts whole days from now', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const cutoff = auditRetentionCutoff(30, now);
    expect(cutoff?.toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });

  it('validates retention day bounds', () => {
    expect(isValidAuditRetentionDays(1)).toBe(true);
    expect(isValidAuditRetentionDays(3650)).toBe(true);
    expect(isValidAuditRetentionDays(0)).toBe(false);
    expect(isValidAuditRetentionDays(3651)).toBe(false);
    expect(isValidAuditRetentionDays(1.5)).toBe(false);
    expect(isValidAuditRetentionDays(null)).toBe(false);
  });
});

describe('export policy expiry', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('never expires when maxAgeDays is null', () => {
    expect(isExportExpired(new Date('2020-01-01T00:00:00Z'), { enabled: true, maxAgeDays: null }, now)).toBe(
      false,
    );
  });

  it('expires files older than the window but keeps fresh ones', () => {
    const policy = { enabled: true, maxAgeDays: 7 };
    expect(isExportExpired(new Date('2026-05-20T00:00:00Z'), policy, now)).toBe(true);
    expect(isExportExpired(new Date('2026-05-28T00:00:00Z'), policy, now)).toBe(false);
  });

  it('treats an export exactly at the cutoff as still valid (strict boundary)', () => {
    const policy = { enabled: true, maxAgeDays: 7 };
    // 2026-05-25T00:00:00Z is exactly 7 days before now -> not older than the window.
    expect(isExportExpired(new Date('2026-05-25T00:00:00Z'), policy, now)).toBe(false);
  });
});

describe('asset tags', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeAssetTag('  off-000142 ')).toBe('OFF-000142');
  });

  it('accepts uppercase alphanumerics and hyphens', () => {
    expect(isValidAssetTag('OFF-000142')).toBe(true);
    expect(isValidAssetTag('A1')).toBe(true);
  });

  it('rejects spaces, symbols and lowercase after normalization rules', () => {
    expect(isValidAssetTag('OFF 000142')).toBe(false);
    expect(isValidAssetTag('OFF_0001')).toBe(false);
    expect(isValidAssetTag('-OFF-1')).toBe(false);
    expect(isValidAssetTag('')).toBe(false);
  });
});

describe('VersionConflictError', () => {
  it('exposes expected and actual versions', () => {
    const err = new VersionConflictError(3, 4);
    expect(err.expected).toBe(3);
    expect(err.actual).toBe(4);
    expect(err.message).toContain('3');
  });
});
