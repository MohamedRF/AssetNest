import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import { IMPORTABLE_FIELDS } from './dto.js';

export const importPreviewResponse = openApiSchema(
  z.object({
    headers: z.array(z.string()),
    sample: z.array(z.array(z.string())).max(5),
    totalRows: z.int().nonnegative(),
    suggestedMapping: z.record(z.string(), z.enum([...IMPORTABLE_FIELDS, ''])),
  }),
);

export const importSummaryResponse = openApiSchema(
  z.object({
    total: z.int().nonnegative(),
    imported: z.int().nonnegative(),
    skippedDuplicate: z.int().nonnegative(),
    failed: z.int().nonnegative(),
    errors: z.array(
      z.object({
        row: z.int().positive().describe('The 1-based data row, excluding the header.'),
        field: z.string().optional(),
        message: z.string(),
      }),
    ),
    importId: z.uuid().optional(),
  }),
);
