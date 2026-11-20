import { describe, expect, it, vi } from 'vitest';
import type { GenerateRequest, ProviderTransport } from '../provider.js';
import { createOllamaAdapter } from './ollama.js';

const input = {
  model: 'sample-vision:latest',
  prompt: 'Identify this equipment.',
  maxOutputTokens: 128,
  signal: new AbortController().signal,
} satisfies GenerateRequest;
const chatResponse = {
  done: true,
  done_reason: 'stop',
  message: { role: 'assistant', content: 'A printer.' },
};

describe('Ollama provider adapter', () => {
  it('normalizes an installed model list from the native tags endpoint', async () => {
    const request = vi.fn<ProviderTransport['request']>().mockResolvedValue({
      models: [
        { name: 'sample-vision:latest', details: { family: 'example' } },
        { name: 'sample-vision:latest' },
      ],
    });
    const adapter = createOllamaAdapter({ request });
    await expect(adapter.discoverModels(input.signal)).resolves.toEqual([
      { id: input.model, label: input.model },
    ]);
    expect(request).toHaveBeenCalledWith({ path: '/api/tags', method: 'GET', signal: input.signal });
    expect((await adapter.capabilities(input.model, input.signal)).features.vision).toBe('unverified');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('uses native non-streaming chat, JSON Schema and base64 image data', async () => {
    const request = vi.fn<ProviderTransport['request']>().mockResolvedValue({
      ...chatResponse,
      message: { role: 'assistant', content: '{"category":"printer"}' },
      prompt_eval_count: 16,
      eval_count: 8,
    });
    const adapter = createOllamaAdapter({ request });
    const schema = { type: 'object', properties: { category: { type: 'string' } } };
    await expect(
      adapter.generate({
        ...input,
        system: 'Describe equipment.',
        images: [{ mimeType: 'image/png', base64: 'iVBORw0KGgo=' }],
        structuredOutput: { name: 'category', schema },
      }),
    ).resolves.toEqual({ text: '{"category":"printer"}', usage: { inputTokens: 16, outputTokens: 8 } });
    expect(request).toHaveBeenCalledWith({
      path: '/api/chat',
      method: 'POST',
      signal: input.signal,
      body: {
        model: input.model,
        messages: [
          { role: 'system', content: 'Describe equipment.' },
          { role: 'user', content: input.prompt, images: ['iVBORw0KGgo='] },
        ],
        format: schema,
        options: { num_predict: 128 },
        stream: false,
      },
    });
  });

  it('accepts text responses without token counts and rejects truncated generations', async () => {
    const request = vi
      .fn<ProviderTransport['request']>()
      .mockResolvedValueOnce(chatResponse)
      .mockResolvedValueOnce({ ...chatResponse, done_reason: 'length' });
    const adapter = createOllamaAdapter({ request });
    await expect(adapter.generate(input)).resolves.toEqual({ text: 'A printer.', usage: null });
    await expect(adapter.generate(input)).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects unlimited generation settings before transport', async () => {
    const request = vi.fn<ProviderTransport['request']>();
    const adapter = createOllamaAdapter({ request });
    await expect(adapter.generate({ ...input, maxOutputTokens: -1 })).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(request).not.toHaveBeenCalled();
  });
});
