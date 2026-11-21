import {
  AIProviderError,
  unverifiedCapabilities,
  type AIProviderAdapter,
  type ModelCapabilities,
} from '@assetnest/ai';
import { z } from 'zod';

const expectedText = 'ASSETNEST_PROBE_OK';
const expectedJson = z.strictObject({ probe: z.literal('ok') });
const expectedColor = z.strictObject({ color: z.literal('red') });
// A generated 64 by 64 solid red RGB PNG, with no workspace content.
const redPng =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC';

function matchesJson(schema: z.ZodType, text: string): boolean {
  try {
    return schema.safeParse(JSON.parse(text)).success;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return false;
  }
}

async function probe(
  request: () => Promise<{ text: string }>,
  matches: (text: string) => boolean,
): Promise<'supported' | 'unsupported' | 'unverified'> {
  try {
    const result = await request();
    return matches(result.text) ? 'supported' : 'unverified';
  } catch (error) {
    if (error instanceof AIProviderError && error.code === 'unsupported') return 'unsupported';
    if (error instanceof AIProviderError && error.code === 'invalid_response') return 'unverified';
    throw error;
  }
}

/** Fixed, minimal payloads verify observed behavior without sending workspace data. */
export async function verifyModelCapabilities(
  adapter: AIProviderAdapter,
  model: string,
  signal: AbortSignal,
  probeImage: boolean,
): Promise<ModelCapabilities> {
  const capabilities = unverifiedCapabilities();
  const options = { model, maxOutputTokens: 64, signal };
  capabilities.features.text = await probe(
    () => adapter.generate({ ...options, prompt: `Reply with exactly this text: ${expectedText}` }),
    (text) => text.trim() === expectedText,
  );
  capabilities.features.structured_output = await probe(
    () =>
      adapter.generate({
        ...options,
        prompt: 'Return a JSON object with field probe set to the text ok.',
        structuredOutput: {
          name: 'assetnest_probe',
          schema: z.toJSONSchema(expectedJson, { target: 'openapi-3.0' }),
        },
      }),
    (text) => matchesJson(expectedJson, text),
  );
  if (probeImage) {
    const vision = await probe(
      () =>
        adapter.generate({
          ...options,
          prompt:
            'Inspect the attached image. Return only a JSON object with its dominant color in the color field.',
          images: [{ mimeType: 'image/png', base64: redPng }],
        }),
      (text) => matchesJson(expectedColor, text),
    );
    capabilities.features.vision = vision;
    capabilities.features.image_input = vision;
  }
  return capabilities;
}
