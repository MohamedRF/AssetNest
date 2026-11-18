import { z } from 'zod';

/**
 * Wire-format contracts shared between API and clients.
 * Keep this package free of server/framework concerns — pure schemas + types.
 */

export const uuidSchema = z.uuid();

/** RFC7807-inspired problem details, extended with a stable machine code + requestId. */
export const problemDetailsSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  requestId: z.string(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(25);

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: pageSizeSchema,
  sort: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO date YYYY-MM-DD');

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Expected ISO 4217 currency code (3 uppercase letters)');

export const amountSchema = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Expected numeric amount with at most 2 decimals');

/** Opaque QR payload identifier — never contains serials or personal data. */
export const assetQrPayloadSchema = z.object({
  kind: z.literal('assetnest/asset'),
  v: z.literal(1),
  workspaceId: uuidSchema,
  assetId: uuidSchema,
});
export type AssetQrPayload = z.infer<typeof assetQrPayloadSchema>;

/** Asset tag wire rule mirrors the domain policy (uppercase alphanumerics + hyphen). */
export const assetTagSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,63}$/, 'Asset tag: A-Z, 0-9 and hyphens, max 64 chars'));
