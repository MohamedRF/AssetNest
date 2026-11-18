import { describe, expect, it } from 'vitest';
import {
  ASSET_STATUSES,
  VersionConflictError,
  allowedTransitions,
  canTransition,
  isValidAssetTag,
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
