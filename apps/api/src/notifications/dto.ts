import { z } from 'zod';

export const upsertPreferenceSchema = z.object({
  channel: z.enum(['log', 'email']),
  event: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_.-]*$/, 'Event key format'),
  enabled: z.boolean(),
});
export type UpsertPreferenceInput = z.infer<typeof upsertPreferenceSchema>;
