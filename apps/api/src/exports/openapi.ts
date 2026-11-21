import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import { REPORTS } from './dto.js';

const reportKind = z.enum(REPORTS);

export const listExportsResponse = openApiSchema(
  z.object({
    exports: z.array(
      z.object({
        id: z.uuid(),
        report: reportKind,
        status: z.enum(['pending', 'completed', 'failed']),
        requestedBy: z.uuid().nullable(),
        createdAt: z.iso.datetime(),
      }),
    ),
    policy: z.object({
      enabled: z.boolean(),
      maxAgeDays: z.number().int().nullable(),
    }),
  }),
);

export const createExportResponse = openApiSchema(
  z.object({
    id: z.uuid(),
    report: reportKind,
    status: z.literal('completed'),
    downloadUrl: z.string().describe('Relative path to download the export through the authenticated API.'),
  }),
);
