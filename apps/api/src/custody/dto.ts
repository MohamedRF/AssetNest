import { z } from 'zod';

export const assignSchema = z.object({
  memberId: z.uuid('Expected a membership id (uuid)'),
  notes: z.string().trim().max(1000).optional(),
  expectedVersion: z.number().int().min(1),
});
export type AssignInput = z.infer<typeof assignSchema>;

export const returnSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
  expectedVersion: z.number().int().min(1),
});
export type ReturnInput = z.infer<typeof returnSchema>;

export const transferSchema = z.object({
  toLocationId: z.uuid('Expected a location id (uuid)'),
  notes: z.string().trim().max(1000).optional(),
  expectedVersion: z.number().int().min(1),
});
export type TransferInput = z.infer<typeof transferSchema>;
