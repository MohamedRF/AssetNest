import { aiTaskSchema, capabilitySchema } from '@assetnest/ai';
import { z } from 'zod';

export const modelIdParamSchema = z.uuid();

const modelField = z.string().trim().min(1).max(255).regex(/^[^\p{Cc}\p{Cf}]+$/u);
export const createAiModelSchema = z.strictObject({
  connectionId: z.uuid(),
  modelId: modelField,
  label: modelField,
});
export type CreateAiModelInput = z.output<typeof createAiModelSchema>;
export const testAiModelSchema = z
  .strictObject({ probeImage: z.boolean().default(false) })
  .default({ probeImage: false });
export type TestAiModelInput = z.output<typeof testAiModelSchema>;

export const aiModelResponseSchema = z.object({
  id: modelIdParamSchema,
  connectionId: z.uuid(),
  modelId: z.string(),
  label: z.string(),
  capabilities: capabilitySchema,
  verifiedAt: z.iso.datetime().nullable(),
  verifiedConnectionUpdatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listAiModelsResponseSchema = z.object({ models: z.array(aiModelResponseSchema) });

export const upsertAiRouteSchema = z
  .strictObject({
    modelId: modelIdParamSchema,
    fallbackModelId: modelIdParamSchema.nullable().default(null),
    timeoutMs: z.int().min(1_000).max(30_000).default(10_000),
    maxOutputTokens: z.int().min(1).max(4_096).default(512),
    dailyTokenBudget: z.int().min(1).max(1_000_000).default(50_000),
    allowProviderData: z.boolean().default(false),
  })
  .refine((input) => input.modelId !== input.fallbackModelId, 'Choose a different fallback model')
  .refine(
    (input) => input.dailyTokenBudget >= input.maxOutputTokens,
    'Daily token budget must cover the maximum output tokens',
  );
export type UpsertAiRouteInput = z.output<typeof upsertAiRouteSchema>;

export const aiRouteResponseSchema = z.object({
  ...upsertAiRouteSchema.shape,
  task: aiTaskSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listAiRoutesResponseSchema = z.object({ routes: z.array(aiRouteResponseSchema) });
