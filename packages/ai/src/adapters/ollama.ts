import { z } from 'zod';
import {
  AIProviderError,
  unverifiedCapabilities,
  type AIProviderAdapter,
  type ProviderTransport,
} from '../provider.js';

const modelList = z.object({
  models: z.array(z.object({ name: z.string().trim().min(1).max(255) })),
});
const chatResponse = z.object({
  done: z.literal(true),
  done_reason: z.string().optional(),
  message: z.object({ role: z.literal('assistant'), content: z.string() }),
  prompt_eval_count: z.int().nonnegative().nullish(),
  eval_count: z.int().nonnegative().nullish(),
});

async function send(transport: ProviderTransport, options: Parameters<ProviderTransport['request']>[0]) {
  try {
    return await transport.request(options);
  } catch (error: unknown) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError(options.signal.aborted ? 'timeout' : 'unavailable');
  }
}

async function discoverModels(transport: ProviderTransport, signal: AbortSignal) {
  const result = modelList.safeParse(await send(transport, { path: '/api/tags', method: 'GET', signal }));
  if (!result.success) throw new AIProviderError('invalid_response');
  return Array.from(new Set(result.data.models.map(({ name }) => name)), (id) => ({ id, label: id }));
}

export function createOllamaAdapter(transport: ProviderTransport): AIProviderAdapter {
  return {
    id: 'ollama',
    async validateConfig(signal) {
      await discoverModels(transport, signal);
    },
    discoverModels: (signal) => discoverModels(transport, signal),
    async capabilities() {
      return unverifiedCapabilities();
    },
    async generate({ model, system, prompt, images, structuredOutput, maxOutputTokens, signal }) {
      if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
        throw new AIProviderError('unsupported');
      }
      const result = chatResponse.safeParse(
        await send(transport, {
          path: '/api/chat',
          method: 'POST',
          signal,
          body: {
            model,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              {
                role: 'user',
                content: prompt,
                images: images?.length ? images.map((image) => image.base64) : undefined,
              },
            ],
            options: { num_predict: maxOutputTokens },
            stream: false,
            format: structuredOutput?.schema,
          },
        }),
      );
      if (!result.success) throw new AIProviderError('invalid_response');
      const { message, done_reason, prompt_eval_count, eval_count } = result.data;
      if (!message.content.trim() || (done_reason && done_reason !== 'stop')) {
        throw new AIProviderError('invalid_response');
      }
      if (structuredOutput) {
        try {
          JSON.parse(message.content);
        } catch {
          throw new AIProviderError('invalid_response');
        }
      }
      const inputTokens = prompt_eval_count ?? null;
      const outputTokens = eval_count ?? null;
      return {
        text: message.content,
        usage: inputTokens === null && outputTokens === null ? null : { inputTokens, outputTokens },
      };
    },
  };
}
