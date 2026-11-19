import { z } from 'zod';

export const REPORTS = ['assets', 'warranties', 'maintenance'] as const;
export type ReportKind = (typeof REPORTS)[number];

export const createExportSchema = z.object({
  report: z.enum(REPORTS),
});
export type CreateExportInput = z.infer<typeof createExportSchema>;
