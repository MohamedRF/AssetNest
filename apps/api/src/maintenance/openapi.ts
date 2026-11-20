import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import { cadenceSchema } from './dto.js';

const maintenancePlan = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  title: z.string(),
  cadence: cadenceSchema,
  nextDueAt: z.iso.date(),
  enabled: z.boolean(),
});

export const maintenancePlanResponse = openApiSchema(
  maintenancePlan.extend({
    workspaceId: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export const listMaintenancePlansResponse = openApiSchema(
  z.object({
    plans: z.array(
      maintenancePlan.extend({
        assetTag: z.string(),
        assetName: z.string(),
        dueState: z.enum(['disabled', 'overdue', 'due_7', 'due_30', 'scheduled']),
      }),
    ),
  }),
);

const maintenanceRecord = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  planId: z.uuid().nullable(),
  performedAt: z.iso.date(),
  vendorId: z.uuid().nullable(),
  cost: z.string().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const maintenanceRecordResponse = openApiSchema(
  maintenanceRecord.extend({
    workspaceId: z.uuid(),
    createdById: z.uuid().nullable(),
  }),
);

export const listMaintenanceRecordsResponse = openApiSchema(
  z.object({
    records: z.array(
      maintenanceRecord.extend({
        assetTag: z.string(),
        vendorName: z.string().nullable(),
      }),
    ),
  }),
);
