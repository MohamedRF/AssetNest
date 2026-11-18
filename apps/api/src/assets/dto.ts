import { z } from 'zod';
import { ASSET_STATUSES } from '@assetnest/domain';

export const assetTagSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9][A-Z0-9-]{0,63}$/,
    'Asset tag must be uppercase letters, digits and hyphens (max 64 chars)',
  );

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO date YYYY-MM-DD');

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Expected ISO 4217 currency (3 uppercase letters)');

export const amountSchema = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Expected numeric amount with at most 2 decimals');

export const CONDITION = ['new', 'good', 'fair', 'poor', 'damaged', 'unknown'] as const;

export const createAssetSchema = z.object({
  assetTag: assetTagSchema,
  displayName: z.string().trim().min(1, 'Display name is required').max(200),
  serialNumber: z.string().trim().max(120).optional(),
  categoryId: z.uuid().nullable().optional(),
  modelId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  custodianMembershipId: z.uuid().nullable().optional(),
  status: z.enum(ASSET_STATUSES).default('available'),
  condition: z.enum(CONDITION).default('good'),
  purchasedAt: isoDateSchema.optional(),
  amount: amountSchema.optional(),
  currency: currencySchema.optional(),
  notes: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(50).toLowerCase()).max(20).optional(),
  customValues: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = z.object({
  assetTag: assetTagSchema.optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  serialNumber: z.string().trim().max(120).nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  modelId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  custodianMembershipId: z.uuid().nullable().optional(),
  condition: z.enum(CONDITION).optional(),
  purchasedAt: isoDateSchema.nullable().optional(),
  amount: amountSchema.nullable().optional(),
  currency: currencySchema.nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50).toLowerCase()).max(20).optional(),
  customValues: z.record(z.string(), z.unknown()).optional(),
  /** Optimistic concurrency guard — required on every mutating asset write. */
  expectedVersion: z.number().int().min(1),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const statusTransitionSchema = z.object({
  to: z.enum(ASSET_STATUSES),
  expectedVersion: z.number().int().min(1),
});
export type StatusTransitionInput = z.infer<typeof statusTransitionSchema>;

export const listAssetsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  categoryId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  condition: z.enum(CONDITION).optional(),
  sort: z.enum(['createdAt', 'displayName', 'assetTag', 'status', 'updatedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;
