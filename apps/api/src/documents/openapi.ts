import type { ContentObject, SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import type { SniffedMime } from './content-sniff.js';
import { documentKindSchema } from './dto.js';

const binaryDocument = { schema: { type: 'string', format: 'binary' } };
export const documentDownloadContent = {
  'application/pdf': binaryDocument,
  'image/png': binaryDocument,
  'image/jpeg': binaryDocument,
  'image/webp': binaryDocument,
  'text/plain': binaryDocument,
} satisfies Record<SniffedMime, ContentObject[string]>;

const document = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  kind: documentKindSchema,
  originalName: z.string(),
  mime: z.enum(Object.keys(documentDownloadContent)),
  size: z.int().nonnegative(),
  checksum: z.string(),
  uploadedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const uploadDocumentBody: SchemaObject = {
  type: 'object',
  required: ['file', 'kind'],
  properties: {
    file: {
      ...binaryDocument.schema,
      description: 'A single non-empty file of up to 10 MiB.',
    },
    kind: openApiSchema(documentKindSchema, 'input'),
  },
};
export const uploadDocumentResponse = openApiSchema(document);
export const listDocumentsResponse = openApiSchema(z.object({ documents: z.array(document) }));
export const removeDocumentResponse = openApiSchema(z.object({ ok: z.literal(true) }));
