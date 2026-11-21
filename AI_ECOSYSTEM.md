# Provider-Agnostic AI Ecosystem Specification

## 1. Non-negotiable goal

AssetNest's AI functionality is **optional and vendor-neutral**. Users choose a supported AI service, API provider, aggregator, proxy, or locally hosted model. Core asset management works with AI disabled. No proprietary provider becomes a mandatory dependency.

## 2. Subscription reality and promise

"Any subscription" is not technically guaranteed. A consumer ChatGPT/Claude/Gemini/etc. subscription **does not necessarily include API credentials or third-party access**. Only support subscription sign-in via a provider's **documented, authorized OAuth/SDK/partner flow**, if available for that account and usage. Never scrape browser sessions, extract tokens, bypass subscriptions, impersonate first-party clients or advertise unsupported compatibility. BYOK paid APIs and local models are primary universal approaches. Display unsupported subscription methods clearly in UI.

## 3. Adapter abstraction

```ts
interface AIProviderAdapter {
  id: string;
  validateConfig(config: SafeConnectionConfig): Promise<ConnectionCheck>;
  discoverModels(config: SafeConnectionConfig): Promise<ModelInfo[]>;
  capabilities(model: string): Promise<ModelCapabilities>;
  generate(request: GenerateRequest): Promise<AIResponse>;
  stream?(request: GenerateRequest): AsyncIterable<AIChunk>;
  embed?(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  extractVision?(request: VisionRequest): Promise<StructuredExtraction>;
}
```

The shared capability matrix covers `text`, `vision`, `structured_output`, `tool_calling`, `embeddings`, `streaming`, `image_input`, `file_input`, `context_limit` and `token_usage`. Features gate themselves on capability, not brand name. Never silently pass unsupported features.

## 4. Provider support tiers

**Tier A — first implementation (tested end-to-end)**

1. OpenAI-compatible `/v1` API via configurable base URL, key, model name (supports compatible gateways, local servers and many vendors).
2. Native OpenAI adapter (for provider-specific capabilities when relevant).
3. Native Anthropic adapter.
4. Native Google Gemini adapter.
5. Ollama/local OpenAI-compatible endpoint (local/private networking policy applied).

**Tier B — follow-up via generic compatibility or integration**
Azure OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together AI, Amazon Bedrock, Vertex AI, LM Studio, vLLM, llama.cpp-compatible servers, LiteLLM gateway, Vercel AI Gateway and other authenticated OpenAI-compatible services. Explicit adapters only when generic APIs are inadequate.

**Tier C — subscription integrations**
Where a platform officially authorizes third-party subscription access, implement a separate supported auth connector with provider-compliant OAuth/token storage and accurate account capability checks. Never equate subscription with API billing.

## 5. Recommended implementation

- `packages/ai` defines adapters, policy, task router and typed outputs. Use a stable TypeScript model SDK such as Vercel AI SDK where appropriate, but **wrap it in AssetNest interfaces** to avoid provider lock-in.
- Optional LiteLLM **gateway** may be deployed for users seeking its wide provider routing and budgets; don't require LiteLLM or Python for basic AI. LiteLLM is independent infrastructure, not the only integration path.
- Python + FastAPI becomes optional only for OCR models, image preprocessing or heavier local inference that cannot practically run in Node.
- Users can configure multiple named connections and task routes with fallback order.
- Admin defines `invoice_extraction`, `image_tagging`, `natural_language_search`, `maintenance_assistant`, `asset_chat`, and later `semantic_search` routes.
- Each route has provider/model, timeout, max tokens, budget, retry/fallback policy, and privacy notice.

## 6. Settings UX

Settings → AI → Connections → Add Connection:
Provider type (native / OpenAI-compatible / local / gateway); display name; endpoint if applicable; credential method (API key / supported OAuth / none local); model ID or test discovery; `Test Connection`; capability report; select default task routes; set per-workspace limits; opt-in remote data transfer. Mask credentials; show fingerprint and last four only if supported; rotate and revoke.

## 7. Secrets and endpoints

Secrets encrypted at rest by KMS or authenticated envelope encryption with key from deployment secret manager; never expose keys to browser, jobs, logs, exports or agents. Workspace AI admin only can update configuration; other members only invoke allowed tasks. SSRF protection for custom URLs: reject unsafe schemes, redirect chains, embedded credentials, metadata IPs; provide explicit admin allowlist for private local-model endpoints, with network isolation and DNS/IP revalidation. Do not permit arbitrary outbound URLs through generic provider configuration.

## 8. Model routing

1. Validate task and actor permissions.
2. Fetch workspace-approved route and provider credential from server-side secret store.
3. Check capability requirements and per-user/workspace budget.
4. Redact unnecessary PII; request consent for remote processing if not already granted.
5. Run adapter with timeout, rate limits, constrained tools, input size caps.
6. Parse strict Zod schema and business validation; record job metadata and estimated usage.
7. Return **draft suggestions**; require explicit approval before modifying assets.
8. Fallback only to another **explicitly authorized** provider respecting data residency/consent; no silent upload to remote model.

## 9. Workflows

### Invoice extraction

Private document → sanitized content/OCR → AI structured proposal `{vendor, invoiceNo, purchaseDate, currency, items:[{name, model, serial, price, warranty}]}` → confidence and source references → editable review UI → user approves → app transaction creates asset(s) + event.

### Image-assisted categorization

Asset photo → permitted vision model → proposals for category/model/visible serial; require human verification; never assert a serial not visible.

### Natural-language search

User text → model outputs **allowlisted filter AST** (NOT SQL) → server schema validates operator, field permissions and limits → repository creates parameterized query → display filters and result. No arbitrary SQL.

### Maintenance assistant

Summarize existing records and manufacturer data supplied by user; suggestions are informational and clearly labeled; no automatic repairs/expenses.

### Chat over assets

Read-only scoped retrieval with per-tool permission enforcement. Mutations require two-step proposed action and explicit approval UI with audit trail.

## 10. Compatibility test matrix

For every connection adapter test: auth failures, model selection, unavailable API method, text response, structured output, image input when supported, streaming when supported, quota exhaustion, timeout, malformed output, fallback consent, redaction, provider outage and secret redaction. Report each model capability as `supported`, `unsupported`, or `unverified` (never assume).

## 11. AI agent and MCP requirements

Expose `asset_search`, `asset_get`, `asset_warranty_due`, `asset_maintenance_history` as read-only first. Mutating MCP tools are disabled by default and require explicit scopes, user confirmation, short-lived grants and audit records. Remote MCP authorization follows current MCP spec with audience-bound tokens and no token passthrough. Treat retrieved docs and tool content as untrusted; mitigate prompt injection and data exfiltration.

## 12. Cost, privacy and observability

Per-workspace task quota, provider budgets, request timeout and concurrency; show estimated cost only when pricing data is known and dated. Log model, task, duration and token usage where available, **not** raw prompts/photos by default. Provide retention policy and deletion controls for AI jobs. Disable AI without removing asset data. Test AI-disabled install as a first-class deployment.

## 13. Acceptance criteria

- Connect one native API, one OpenAI-compatible custom endpoint and one local model with documented instructions.
- Switch providers without code changes; unsupported capabilities shown rather than hidden failures.
- No secrets in frontend network responses or logs.
- Invoice extraction requires human approval and stores source document reference.
- AI unavailable → core application remains fully usable.
- Subscription compatibility claims limited to officially supported access methods.
