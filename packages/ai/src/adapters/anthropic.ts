import { z } from 'zod';
import { AIProviderError, unverifiedCapabilities, type AIProviderAdapter, type ProviderTransport } from '../provider.js';

const models = z.object({
  data: z.array(z.object({ id: z.string().min(1), display_name: z.string().optional() })),
});
const response = z.object({
  stop_reason: z.string().nullish(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.int().nonnegative(), output_tokens: z.int().nonnegative() }).optional(),
});

export function createAnthropicAdapter(transport: ProviderTransport): AIProviderAdapter {
  const discoverModels: AIProviderAdapter['discoverModels'] = async (signal) => {
    const result = models.safeParse(await transport.request({ path: '/models?limit=100', method: 'GET', signal }));
    if (!result.success) throw new AIProviderError('invalid_response');
    return result.data.data.map((model) => ({ id: model.id, label: model.display_name ?? model.id }));
  };
  return {
    id: 'anthropic',
    discoverModels,
    async validateConfig(signal) { await discoverModels(signal); },
    async capabilities() { return unverifiedCapabilities(); },
    async generate(input) {
      const result = response.safeParse(await transport.request({
        path: '/messages',
        method: 'POST',
        signal: input.signal,
        body: {
          model: input.model,
          system: input.system,
          max_tokens: input.maxOutputTokens,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: input.prompt },
              ...(input.images ?? []).map((image) => ({
                type: 'image',
                source: { type: 'base64', media_type: image.mimeType, data: image.base64 },
              })),
            ],
          }],
          ...(input.structuredOutput && {
            output_config: { format: { type: 'json_schema', schema: input.structuredOutput.schema } },
          }),
        },
      }));
      if (!result.success || !['end_turn', 'stop_sequence'].includes(result.data.stop_reason ?? '')) {
        throw new AIProviderError('invalid_response');
      }
      const text = result.data.content.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('');
      if (!text.trim()) throw new AIProviderError('invalid_response');
      const usage = result.data.usage;
      return { text, usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : null };
    },
  };
}
