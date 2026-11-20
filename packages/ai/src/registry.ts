import { createAnthropicAdapter } from './adapters/anthropic.js';
import { createGeminiAdapter } from './adapters/gemini.js';
import { createOllamaAdapter } from './adapters/ollama.js';
import { createOpenAIAdapter, createOpenAICompatibleAdapter } from './adapters/openai.js';
import { AIProviderRegistry, type ProviderFactory, type ProviderKind } from './provider.js';

export const aiProviderRegistry = new AIProviderRegistry(
  new Map<ProviderKind, ProviderFactory>([
    ['openai', createOpenAIAdapter],
    ['anthropic', createAnthropicAdapter],
    ['gemini', createGeminiAdapter],
    ['openai_compatible', createOpenAICompatibleAdapter],
    ['ollama', createOllamaAdapter],
  ]),
);
