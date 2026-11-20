import { providerKindSchema } from '@assetnest/ai';
import { z } from 'zod';

export const connectionIdSchema = z.uuid();

const name = z.string().trim().min(1).max(120);
const endpoint = z.string().trim().min(1).max(2048);
const credential = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/, 'Use printable characters without spaces')
  .meta({ writeOnly: true });
const invalidFields = { error: 'Unexpected connection fields' };

export const createAiConnectionSchema = z.discriminatedUnion('kind', [
  z.strictObject(
    {
      kind: providerKindSchema.extract(['openai', 'anthropic', 'gemini']),
      name,
      endpoint: z.null().optional(),
      credential,
      enabled: z.boolean().default(true),
    },
    invalidFields,
  ),
  z.strictObject(
    {
      kind: providerKindSchema.extract(['openai_compatible', 'ollama']),
      name,
      endpoint,
      credential: credential.nullable().optional(),
      enabled: z.boolean().default(true),
    },
    invalidFields,
  ),
]);

export const updateAiConnectionSchema = z
  .strictObject(
    {
      name: name.optional(),
      endpoint: endpoint.nullable().optional(),
      credential: credential.nullable().optional(),
      enabled: z.boolean().optional(),
    },
    invalidFields,
  )
  .refine((input) => Object.values(input).some((value) => value !== undefined), 'Provide a field to update');

export type CreateAiConnectionInput = z.output<typeof createAiConnectionSchema>;
export type UpdateAiConnectionInput = z.output<typeof updateAiConnectionSchema>;

export const aiConnectionResponseSchema = z.object({
  id: connectionIdSchema,
  kind: providerKindSchema,
  name: z.string(),
  endpoint: z.url().nullable(),
  enabled: z.boolean(),
  hasCredential: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listAiConnectionsResponseSchema = z.object({
  connections: z.array(aiConnectionResponseSchema),
});

export const testAiConnectionResponseSchema = z.object({
  models: z.array(z.object({ id: z.string().min(1).max(255), label: z.string().min(1).max(255) })).max(100),
});
