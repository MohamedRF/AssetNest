import { z } from 'zod';
import { isoDateSchema, amountSchema, currencySchema } from '@assetnest/contracts';

export const CADENCES = ['monthly', 'quarterly', 'semiannual', 'yearly', 'once'] as const;
export const cadenceSchema = z.enum(CADENCES);
export type Cadence = z.infer<typeof cadenceSchema>;

export const createPlanSchema = z.object({
  assetId: z.uuid(),
  title: z.string().trim().min(1, 'Title is required').max(200),
  cadence: cadenceSchema,
  nextDueAt: isoDateSchema,
  enabled: z.boolean().default(true),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    cadence: cadenceSchema.optional(),
    nextDueAt: isoDateSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (v) => Object.values(v).some((value) => value !== undefined),
    'At least one field must be provided',
  );
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const createRecordSchema = z.object({
  assetId: z.uuid(),
  planId: z.uuid().optional(),
  performedAt: isoDateSchema,
  vendorId: z.uuid().optional(),
  cost: amountSchema.optional(),
  currency: currencySchema.optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateRecordInput = z.infer<typeof createRecordSchema>;

export const listRecordsQuerySchema = z.object({
  assetId: z.uuid().optional(),
});
export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;
