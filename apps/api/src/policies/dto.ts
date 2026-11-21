import { z } from 'zod';
import {
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  DEFAULT_EXPORT_POLICY,
  EXPORT_MAX_AGE_MAX_DAYS,
  EXPORT_MAX_AGE_MIN_DAYS,
  type ExportPolicy,
} from '@assetnest/domain';

/**
 * `null` = retain audit history indefinitely (the conservative default).
 * Finite values must be a whole number of days within bounds.
 */
export const auditRetentionSchema = z.object({
  retentionDays: z
    .number()
    .int('Retention must be a whole number of days')
    .min(AUDIT_RETENTION_MIN_DAYS)
    .max(AUDIT_RETENTION_MAX_DAYS)
    .nullable(),
});
export type AuditRetentionInput = z.infer<typeof auditRetentionSchema>;

export const exportPolicySchema = z.object({
  enabled: z.boolean(),
  /** `null` = generated exports never expire. */
  maxAgeDays: z
    .number()
    .int('Max age must be a whole number of days')
    .min(EXPORT_MAX_AGE_MIN_DAYS)
    .max(EXPORT_MAX_AGE_MAX_DAYS)
    .nullable(),
});
export type ExportPolicyInput = z.infer<typeof exportPolicySchema>;

/**
 * Defensive parse of the stored `export_policy_json` column. Anything that is
 * not a valid policy falls back to the safe default (exports enabled, no
 * expiry) so a malformed row can never brick the exports surface open or shut.
 */
export function parseExportPolicy(value: unknown): ExportPolicy {
  const parsed = exportPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_EXPORT_POLICY };
}
