import { z } from 'zod';

export const IMPORTABLE_FIELDS = [
  'assetTag',
  'displayName',
  'serialNumber',
  'status',
  'condition',
  'purchaseDate',
  'amount',
  'currency',
  'notes',
  'tags',
  'categoryId',
  'locationId',
] as const;
export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

export const fieldMappingSchema = z.record(z.string(), z.enum(IMPORTABLE_FIELDS));

export const previewImportSchema = z.object({
  csvText: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
});
export type PreviewImportInput = z.infer<typeof previewImportSchema>;

export const runImportSchema = z.object({
  csvText: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
  mapping: fieldMappingSchema,
  onDuplicate: z.enum(['skip', 'fail']).default('skip'),
  dryRun: z.boolean().default(false),
});
export type RunImportInput = z.infer<typeof runImportSchema>;
