import { z } from 'zod';

export const DOCUMENT_KINDS = [
  'invoice',
  'warranty',
  'manual',
  'service_evidence',
  'photo',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const documentKindSchema = z.enum(DOCUMENT_KINDS);

export const listDocumentsQuerySchema = z.object({
  kind: documentKindSchema.optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
