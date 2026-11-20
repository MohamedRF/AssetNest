import { z } from 'zod';

export const providerKindSchema = z.enum(['openai', 'anthropic', 'gemini', 'openai_compatible', 'ollama']);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const capabilityNames = [
  'text',
  'vision',
  'structured_output',
  'tool_calling',
  'embeddings',
  'streaming',
  'image_input',
  'file_input',
  'token_usage',
] as const;
export type Capability = (typeof capabilityNames)[number];
const capabilityState = z.enum(['supported', 'unsupported', 'unverified']);
export const capabilitySchema = z.strictObject({
  features: z.record(z.enum(capabilityNames), capabilityState),
  contextLimit: z.int().positive().nullable(),
});
export type ModelCapabilities = z.infer<typeof capabilitySchema>;

export function unverifiedCapabilities(): ModelCapabilities {
  return {
    features: {
      text: 'unverified',
      vision: 'unverified',
      structured_output: 'unverified',
      tool_calling: 'unverified',
      embeddings: 'unverified',
      streaming: 'unverified',
      image_input: 'unverified',
      file_input: 'unverified',
      token_usage: 'unverified',
    },
    contextLimit: null,
  };
}

export interface ModelInfo {
  id: string;
  label: string;
}

export const tokenUsageSchema = z.strictObject({
  inputTokens: z.int().nonnegative().nullable(),
  outputTokens: z.int().nonnegative().nullable(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export interface GenerateRequest {
  model: string;
  system?: string;
  prompt: string;
  images?: readonly { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string }[];
  structuredOutput?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface AIResponse {
  text: string;
  usage: TokenUsage | null;
}

export type ProviderErrorCode =
  | 'invalid_endpoint'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'unsupported'
  | 'unavailable'
  | 'invalid_response'
  | 'timeout';

export class AIProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) {
    super(`AI provider request failed (${code})`);
    this.name = 'AIProviderError';
  }
}

/** A provider adapter receives a server-owned transport bound to one connection. */
export interface ProviderTransport {
  request(options: {
    path: string;
    method: 'GET' | 'POST';
    body?: unknown;
    signal: AbortSignal;
  }): Promise<unknown>;
}

export interface AIProviderAdapter {
  readonly id: ProviderKind;
  validateConfig(signal: AbortSignal): Promise<void>;
  discoverModels(signal: AbortSignal): Promise<ModelInfo[]>;
  capabilities(model: string, signal: AbortSignal): Promise<ModelCapabilities>;
  generate(request: GenerateRequest): Promise<AIResponse>;
}

export type ProviderFactory = (transport: ProviderTransport) => AIProviderAdapter;

export class AIProviderRegistry {
  readonly #factories: ReadonlyMap<ProviderKind, ProviderFactory>;

  constructor(factories: ReadonlyMap<ProviderKind, ProviderFactory>) {
    this.#factories = new Map(factories);
  }

  connect(kind: ProviderKind, transport: ProviderTransport): AIProviderAdapter {
    const factory = this.#factories.get(kind);
    if (!factory) throw new AIProviderError('unsupported');
    const adapter = factory(transport);
    if (adapter.id !== kind) throw new AIProviderError('unsupported');
    return adapter;
  }
}
