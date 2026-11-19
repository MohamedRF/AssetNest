import { z } from 'zod';
import { isoDateSchema } from '@assetnest/contracts';

export const createWarrantySchema = z
  .object({
    assetId: z.uuid(),
    provider: z.string().trim().min(1, 'Provider is required').max(200),
    startsOn: isoDateSchema,
    expiresOn: isoDateSchema,
    details: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.expiresOn >= v.startsOn, {
    message: 'expiresOn must be on or after startsOn',
    path: ['expiresOn'],
  });
export type CreateWarrantyInput = z.infer<typeof createWarrantySchema>;

export const updateWarrantySchema = z
  .object({
    provider: z.string().trim().min(1).max(200).optional(),
    startsOn: isoDateSchema.optional(),
    expiresOn: isoDateSchema.optional(),
    details: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (v) => Object.values(v).some((value) => value !== undefined),
    'At least one field must be provided',
  );
export type UpdateWarrantyInput = z.infer<typeof updateWarrantySchema>;

export const listWarrantiesQuerySchema = z.object({
  /** Only warranties expiring within this many days (or already expired). */
  expiringDays: z.coerce.number().int().min(0).max(3650).optional(),
});
export type ListWarrantiesQuery = z.infer<typeof listWarrantiesQuerySchema>;
