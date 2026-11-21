import { describe, expect, it, vi } from 'vitest';
import type { GenerateRequest } from '../provider.js';
import { createAnthropicAdapter } from './anthropic.js';
import { createGeminiAdapter } from './gemini.js';

const fixture: GenerateRequest = {
  model: 'fixture-model',
  prompt: 'Synthetic prompt',
  system: 'Use the schema.',
  images: [{ mimeType: 'image/png', base64: 'AA==' }],
  structuredOutput: { name: 'fixture', schema: { type: 'object' } },
  maxOutputTokens: 24,
  signal: AbortSignal.timeout(1000),
};

describe('native Anthropic and Gemini adapters', () => {
  it('normalizes Anthropic content, stop reason and usage', async () => {
    const request = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{}' }],
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    const adapter = createAnthropicAdapter({ request });
    await expect(adapter.generate(fixture)).resolves.toEqual({
      text: '{}',
      usage: { inputTokens: 10, outputTokens: 2 },
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/messages',
        body: expect.objectContaining({
          max_tokens: 24,
          output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
        }),
      }),
    );
    request.mockResolvedValue({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'bad' }] });
    await expect(adapter.generate(fixture)).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('filters internal Gemini thought blocks and rejects malformed model names', async () => {
    const request = vi.fn().mockResolvedValue({
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ text: 'private', thought: true }, { text: '{}' }] } },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 3 },
    });
    const adapter = createGeminiAdapter({ request });
    await expect(adapter.generate(fixture)).resolves.toEqual({
      text: '{}',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/models/fixture-model:generateContent',
        body: expect.objectContaining({
          generationConfig: {
            maxOutputTokens: 24,
            responseMimeType: 'application/json',
            responseJsonSchema: { type: 'object' },
          },
        }),
      }),
    );
    await expect(adapter.generate({ ...fixture, model: '../unsafe' })).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
