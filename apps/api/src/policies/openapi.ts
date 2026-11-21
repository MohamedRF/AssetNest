import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import { auditRetentionSchema, exportPolicySchema } from './dto.js';

export const auditRetentionRequestSchema = auditRetentionSchema;
export const exportPolicyRequestSchema = exportPolicySchema;

export const workspacePoliciesResponse = openApiSchema(
  z.object({
    auditRetentionDays: z.number().int().nullable().describe('Null = retain audit history indefinitely.'),
    exportPolicy: z.object({
      enabled: z.boolean(),
      maxAgeDays: z.number().int().nullable().describe('Null = generated exports never expire.'),
    }),
  }),
);

export const auditPruneResponse = openApiSchema(
  z.object({
    cutoff: z.iso.datetime().nullable().describe('Null when retention is indefinite (nothing pruned).'),
    deleted: z.number().int().describe('Number of audit rows deleted for this workspace.'),
  }),
);
