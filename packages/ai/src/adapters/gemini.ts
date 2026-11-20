import { z } from 'zod';
import { AIProviderError, unverifiedCapabilities, type AIProviderAdapter, type ProviderTransport } from '../provider.js';

const modelSchema = z.object({
  name: z.string().regex(/^models\/[A-Za-z0-9][A-Za-z0-9._-]*$/),
  displayName: z.string().optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
  inputTokenLimit: z.int().positive().optional(),
});
const models = z.object({ models: z.array(modelSchema).default([]) });
const response = z.object({
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) })
      .optional(),
  })).optional(),
  usageMetadata: z.object({
    promptTokenCount: z.int().nonnegative().optional(),
    candidatesTokenCount: z.int().nonnegative().optional(),
    thoughtsTokenCount: z.int().nonnegative().optional(),
  }).optional(),
});

function modelName(raw: string): string {
  const id = raw.replace(/^models\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) throw new AIProviderError('unsupported');
  return `models/${id}`;
}

export function createGeminiAdapter(transport: ProviderTransport): AIProviderAdapter {
  const discoverModels: AIProviderAdapter['discoverModels'] = async (signal) => {
    const result = models.safeParse(await transport.request({ path: '/models?pageSize=100', method: 'GET', signal }));
    if (!result.success) throw new AIProviderError('invalid_response');
    return result.data.models
      .filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent'))
      .map((model) => ({ id: model.name, label: model.displayName ?? model.name }));
  };
  return {
    id: 'gemini',
    discoverModels,
    async validateConfig(signal) { await discoverModels(signal); },
    async capabilities(model, signal) {
      const result = modelSchema.safeParse(await transport.request({ path: `/${modelName(model)}`, method: 'GET', signal }));
      if (!result.success) throw new AIProviderError('invalid_response');
      const capabilities = unverifiedCapabilities();
      if (result.data.supportedGenerationMethods && !result.data.supportedGenerationMethods.includes('generateContent')) {
        capabilities.features.text = 'unsupported';
      }
      return { ...capabilities, contextLimit: result.data.inputTokenLimit ?? null };
    },
    async generate(input) {
      const result = response.safeParse(await transport.request({
        path: `/${modelName(input.model)}:generateContent`,
        method: 'POST',
        signal: input.signal,
        body: {
          ...(input.system && { systemInstruction: { parts: [{ text: input.system }] } }),
          contents: [{
            role: 'user',
            parts: [
              { text: input.prompt },
              ...(input.images ?? []).map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })),
            ],
          }],
          generationConfig: {
            maxOutputTokens: input.maxOutputTokens,
            ...(input.structuredOutput && {
              responseMimeType: 'application/json',
              responseJsonSchema: input.structuredOutput.schema,
            }),
          },
        },
      }));
      if (!result.success) throw new AIProviderError('invalid_response');
      const candidate = result.data.candidates?.[0];
      if (!candidate || (candidate.finishReason && candidate.finishReason !== 'STOP')) {
        throw new AIProviderError('invalid_response');
      }
      const text = candidate.content?.parts.filter((part) => !part.thought).map((part) => part.text ?? '').join('');
      if (!text?.trim()) throw new AIProviderError('invalid_response');
      const usage = result.data.usageMetadata;
      const outputTokens = usage?.candidatesTokenCount === undefined && usage?.thoughtsTokenCount === undefined
        ? null : (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
      return { text, usage: usage ? { inputTokens: usage.promptTokenCount ?? null, outputTokens } : null };
    },
  };
}
