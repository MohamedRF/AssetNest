import { z } from 'zod';
import {
  AIProviderError,
  unverifiedCapabilities,
  type AIProviderAdapter,
  type AIResponse,
  type GenerateRequest,
  type ProviderTransport,
} from '../provider.js';

const modelList = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1).max(255) })),
});
const tokenCount = z.int().nonnegative().nullish();
const nativeResponse = z.object({
  status: z.literal('completed'),
  output: z.array(
    z.object({
      type: z.string(),
      role: z.string().optional(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    }),
  ),
  usage: z.object({ input_tokens: tokenCount, output_tokens: tokenCount }).nullish(),
});
const compatibleResponse = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({ content: z.string().nullable(), refusal: z.string().nullish() }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: tokenCount, completion_tokens: tokenCount }).nullish(),
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
  const result = modelList.safeParse(await send(transport, { path: '/models', method: 'GET', signal }));
  if (!result.success) throw new AIProviderError('invalid_response');
  return Array.from(new Set(result.data.data.map(({ id }) => id)), (id) => ({ id, label: id }));
}

function response(
  request: GenerateRequest,
  text: string,
  inputTokens: number | null = null,
  outputTokens: number | null = null,
): AIResponse {
  if (!text.trim()) throw new AIProviderError('invalid_response');
  if (request.structuredOutput) {
    try {
      JSON.parse(text);
    } catch {
      throw new AIProviderError('invalid_response');
    }
  }
  return {
    text,
    usage: inputTokens === null && outputTokens === null ? null : { inputTokens, outputTokens },
  };
}

function imageDataUrl(image: NonNullable<GenerateRequest['images']>[number]): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}

function checkTokenLimit(maxOutputTokens: number): void {
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new AIProviderError('unsupported');
  }
}

export function createOpenAIAdapter(transport: ProviderTransport): AIProviderAdapter {
  return {
    id: 'openai',
    async validateConfig(signal) {
      await discoverModels(transport, signal);
    },
    discoverModels: (signal) => discoverModels(transport, signal),
    async capabilities() {
      return unverifiedCapabilities();
    },
    async generate(request) {
      checkTokenLimit(request.maxOutputTokens);
      const modelOutput = nativeResponse.safeParse(
        await send(transport, {
          path: '/responses',
          method: 'POST',
          signal: request.signal,
          body: {
            model: request.model,
            instructions: request.system,
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: request.prompt },
                  ...(request.images ?? []).map((image) => ({
                    type: 'input_image',
                    image_url: imageDataUrl(image),
                    detail: 'auto',
                  })),
                ],
              },
            ],
            max_output_tokens: request.maxOutputTokens,
            store: false,
            text: request.structuredOutput && {
              format: {
                type: 'json_schema',
                name: request.structuredOutput.name,
                schema: request.structuredOutput.schema,
                strict: true,
              },
            },
          },
        }),
      );
      if (!modelOutput.success) throw new AIProviderError('invalid_response');
      const parts = modelOutput.data.output.flatMap((item) =>
        item.type === 'message' && item.role === 'assistant' ? (item.content ?? []) : [],
      );
      if (parts.some((part) => part.type !== 'output_text' || part.text === undefined)) {
        throw new AIProviderError('invalid_response');
      }
      return response(
        request,
        parts.map((part) => part.text).join(''),
        modelOutput.data.usage?.input_tokens,
        modelOutput.data.usage?.output_tokens,
      );
    },
  };
}

export function createOpenAICompatibleAdapter(transport: ProviderTransport): AIProviderAdapter {
  return {
    id: 'openai_compatible',
    async validateConfig(signal) {
      await discoverModels(transport, signal);
    },
    discoverModels: (signal) => discoverModels(transport, signal),
    async capabilities() {
      return unverifiedCapabilities();
    },
    async generate(request) {
      checkTokenLimit(request.maxOutputTokens);
      const modelOutput = compatibleResponse.safeParse(
        await send(transport, {
          path: '/chat/completions',
          method: 'POST',
          signal: request.signal,
          body: {
            model: request.model,
            messages: [
              ...(request.system ? [{ role: 'system', content: request.system }] : []),
              {
                role: 'user',
                content: request.images?.length
                  ? [
                      { type: 'text', text: request.prompt },
                      ...request.images.map((image) => ({
                        type: 'image_url',
                        image_url: { url: imageDataUrl(image) },
                      })),
                    ]
                  : request.prompt,
              },
            ],
            max_tokens: request.maxOutputTokens,
            stream: false,
            response_format: request.structuredOutput && {
              type: 'json_schema',
              json_schema: {
                name: request.structuredOutput.name,
                schema: request.structuredOutput.schema,
                strict: true,
              },
            },
          },
        }),
      );
      if (!modelOutput.success) throw new AIProviderError('invalid_response');
      const choice = modelOutput.data.choices[0]!;
      if (choice.message.refusal || (choice.finish_reason && choice.finish_reason !== 'stop')) {
        throw new AIProviderError('invalid_response');
      }
      return response(
        request,
        choice.message.content ?? '',
        modelOutput.data.usage?.prompt_tokens,
        modelOutput.data.usage?.completion_tokens,
      );
    },
  };
}
