import { describe, expect, it, vi } from 'vitest';
import { AIProviderError, type GenerateRequest, type ProviderTransport } from '../provider.js';
import { createOpenAIAdapter, createOpenAICompatibleAdapter } from './openai.js';

const input = {
  model: 'example-model',
  system: 'Use only catalog data.',
  prompt: 'List office assets.',
  maxOutputTokens: 128,
  signal: new AbortController().signal,
} satisfies GenerateRequest;
const image = { mimeType: 'image/png', base64: 'iVBORw0KGgo=' } as const;
const structuredOutput = { name: 'catalog_summary', schema: { type: 'object', additionalProperties: false } };

describe('OpenAI provider adapters', () => {
  it.each([createOpenAIAdapter, createOpenAICompatibleAdapter])(
    'discovers exact model IDs without assuming capabilities',
    async (createAdapter) => {
      const request = vi.fn<ProviderTransport['request']>().mockResolvedValue({
        data: [{ id: 'vendor/text-model' }, { id: ' vendor/text-model ' }, { id: 'vendor/embedding-model' }],
      });
      const adapter = createAdapter({ request });
      await expect(adapter.validateConfig(input.signal)).resolves.toBeUndefined();
      await expect(adapter.discoverModels(input.signal)).resolves.toEqual([
        { id: 'vendor/text-model', label: 'vendor/text-model' },
        { id: 'vendor/embedding-model', label: 'vendor/embedding-model' },
      ]);
      expect(request).toHaveBeenCalledWith({ path: '/models', method: 'GET', signal: input.signal });
      expect((await adapter.capabilities(input.model, input.signal)).features.vision).toBe('unverified');
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it('calls native Responses with a token limit, image bytes, JSON Schema and storage disabled', async () => {
    const request = vi.fn<ProviderTransport['request']>().mockResolvedValue({
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: '{' },
            { type: 'output_text', text: '}' },
          ],
        },
      ],
      usage: { input_tokens: 14, output_tokens: 5, total_tokens: 19 },
    });

    const adapter = createOpenAIAdapter({ request });
    await expect(adapter.generate({ ...input, images: [image], structuredOutput })).resolves.toEqual({
      text: '{}',
      usage: { inputTokens: 14, outputTokens: 5 },
    });
    expect(request).toHaveBeenCalledWith({
      path: '/responses',
      method: 'POST',
      signal: input.signal,
      body: {
        model: input.model,
        instructions: input.system,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: input.prompt },
              { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=', detail: 'auto' },
            ],
          },
        ],
        max_output_tokens: 128,
        store: false,
        text: { format: { type: 'json_schema', ...structuredOutput, strict: true } },
      },
    });
  });

  it('rejects native refusals and incomplete results without exposing provider text', async () => {
    const request = vi
      .fn<ProviderTransport['request']>()
      .mockResolvedValueOnce({
        status: 'completed',
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'private refusal' }] },
        ],
      })
      .mockResolvedValueOnce({
        status: 'incomplete',
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'private part' }] },
        ],
      });
    const adapter = createOpenAIAdapter({ request });
    for (let index = 0; index < 2; index += 1) {
      await expect(adapter.generate(input)).rejects.toMatchObject({
        code: 'invalid_response',
        message: 'AI provider request failed (invalid_response)',
      });
    }
  });

  it('uses Chat Completions for a compatible service and handles missing usage', async () => {
    const request = vi.fn<ProviderTransport['request']>().mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'One printer.' } }],
    });
    const adapter = createOpenAICompatibleAdapter({ request });
    await expect(adapter.generate(input)).resolves.toEqual({ text: 'One printer.', usage: null });
    expect(request).toHaveBeenCalledWith({
      path: '/chat/completions',
      method: 'POST',
      signal: input.signal,
      body: {
        model: input.model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.prompt },
        ],
        max_tokens: 128,
        stream: false,
      },
    });
  });

  it('uses compatible image blocks and structured output without silently downgrading', async () => {
    const request = vi
      .fn<ProviderTransport['request']>()
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{}' } }],
        usage: { prompt_tokens: 15, completion_tokens: 2 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'unstructured' } }],
      });
    const adapter = createOpenAICompatibleAdapter({ request });
    await expect(adapter.generate({ ...input, images: [image], structuredOutput })).resolves.toEqual({
      text: '{}',
      usage: { inputTokens: 15, outputTokens: 2 },
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          messages: [
            { role: 'system', content: input.system },
            {
              role: 'user',
              content: [
                { type: 'text', text: input.prompt },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
              ],
            },
          ],
          response_format: { type: 'json_schema', json_schema: { ...structuredOutput, strict: true } },
        }),
      }),
    );
    await expect(adapter.generate({ ...input, structuredOutput })).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed discovery and scrubs unexpected operational errors', async () => {
    const request = vi
      .fn<ProviderTransport['request']>()
      .mockResolvedValueOnce({ data: [{ id: null }] })
      .mockRejectedValueOnce(new Error('sensitive URL or body'))
      .mockRejectedValueOnce(new AIProviderError('invalid_credentials'));
    const adapter = createOpenAICompatibleAdapter({ request });
    await expect(adapter.discoverModels(input.signal)).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(adapter.generate(input)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'AI provider request failed (unavailable)',
    });
    await expect(adapter.validateConfig(input.signal)).rejects.toMatchObject({ code: 'invalid_credentials' });
  });
});
