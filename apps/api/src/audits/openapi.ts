import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import { createAuditSchema } from './dto.js';

const auditSummary = z.object({
  id: z.uuid(),
  label: z.string(),
  status: z.enum(['open', 'closed']),
  scopeJson: createAuditSchema.shape.scope.removeDefault(),
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
});

const auditSession = auditSummary.extend({
  workspaceId: z.uuid(),
  openedBy: z.uuid().nullable(),
  closedBy: z.uuid().nullable(),
});

const observation = z.enum(['unobserved', 'present', 'missing', 'moved', 'extra']);
const itemSummary = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  observation,
  observedLocationId: z.uuid().nullable(),
  observedAt: z.iso.datetime().nullable(),
  notes: z.string().nullable(),
});

export const listAuditsResponse = openApiSchema(z.object({ audits: z.array(auditSummary) }));
export const auditDetailResponse = openApiSchema(
  auditSession.extend({
    items: z.array(itemSummary.extend({ assetTag: z.string(), displayName: z.string() })),
    counts: z.object({
      total: z.int().nonnegative(),
      unobserved: z.int().nonnegative(),
      present: z.int().nonnegative(),
      missing: z.int().nonnegative(),
      moved: z.int().nonnegative(),
      extra: z.int().nonnegative(),
    }),
  }),
);
export const auditItemResponse = openApiSchema(
  itemSummary.extend({
    workspaceId: z.uuid(),
    auditId: z.uuid(),
    observedBy: z.uuid().nullable(),
  }),
);
export const closedAuditResponse = openApiSchema(
  auditSession.extend({ status: z.literal('closed'), closedAt: z.iso.datetime() }),
);
