import { z } from 'zod';

export const createAuditSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(200),
  scope: z
    .object({
      locationId: z.uuid().optional(),
      categoryId: z.uuid().optional(),
    })
    .strict()
    .default({}),
});
export type CreateAuditInput = z.infer<typeof createAuditSchema>;

export const verifyItemSchema = z.object({
  assetId: z.uuid(),
  observation: z.enum(['present', 'missing', 'moved', 'extra']),
  observedLocationId: z.uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type VerifyItemInput = z.infer<typeof verifyItemSchema>;

export const closeAuditSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type CloseAuditInput = z.infer<typeof closeAuditSchema>;
