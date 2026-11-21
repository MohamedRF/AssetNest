# AI compatibility matrix and offline regression (P5-12)

AssetNest's AI layer is optional and provider-neutral. This document records how
each supported connection is exercised and what the offline (AI-disabled)
deployment guarantees.

## Provider support tiers

| Tier | Provider                                      | Adapter                  | Transport                                          | Notes                                                           |
| ---- | --------------------------------------------- | ------------------------ | -------------------------------------------------- | --------------------------------------------------------------- |
| A    | OpenAI (native)                               | `@assetnest/ai` `openai` | `https://api.openai.com/v1`                        | `/responses` + JSON schema                                      |
| A    | OpenAI-compatible                             | `openai_compatible`      | configurable base URL                              | `/chat/completions`, any vendor/gateway                         |
| A    | Anthropic                                     | `anthropic`              | `https://api.anthropic.com/v1`                     | `x-api-key`, `anthropic-version`                                |
| A    | Google Gemini                                 | `gemini`                 | `https://generativelanguage.googleapis.com/v1beta` | `x-goog-api-key`                                                |
| A    | Ollama / local                                | `ollama`                 | configurable base URL (private origins opt-in)     | no credential required                                          |
| B    | LiteLLM, OpenRouter, Groq, vLLM, LM Studio, … | `openai_compatible`      | their OpenAI-compatible URL                        | see `examples/` + `infrastructure/compose/compose.litellm.yaml` |

Tier B providers need no dedicated code: point an _OpenAI-compatible_ connection
at their base URL. Tier C (subscription sign-in) is intentionally **not**
implemented — only documented, authorized API/OAuth flows are supported
(see `AI_ECOSYSTEM.md`).

## Per-connection checks

Every adapter test covers the same matrix (`AI_ECOSYSTEM.md` §10). The shared
`ProviderTransport` enforces the network policy for all of them:

- **Auth failures** → `AI_PROVIDER_INVALID_CREDENTIALS` (422), credentials never logged.
- **Rate limiting** → `AI_PROVIDER_RATE_LIMITED` (429).
- **Unsupported method/model** → `AI_PROVIDER_UNSUPPORTED` (422).
- **Timeout** → `AI_PROVIDER_TIMEOUT` (504), bounded by the route timeout.
- **Malformed output** → `AI_PROVIDER_INVALID_RESPONSE` (502); 5xx bodies hide the internal code.
- **Unavailable** → `AI_PROVIDER_UNAVAILABLE` (502).
- **Structured output** validated against a strict Zod schema before a draft is returned.
- **Image input** only sent when the model reports `vision`/`image_input` support.
- **Token usage** recorded per job when the provider reports it.
- **Redaction**: API keys are encrypted at rest, never returned, and never written to logs or audit metadata.
- **SSRF policy**: schemes, embedded credentials, private/link-local/metadata IPs and redirect chains are rejected; DNS is re-checked at registration and request time; `AI_PRIVATE_ORIGINS` is the only opt-in for local models.

### Reaching a private gateway (LiteLLM on the compose network)

Tier B connections usually point at a public `https://` endpoint and need no
extra configuration. A gateway hosted on a private network — for example the
optional LiteLLM service in `infrastructure/compose/compose.litellm.yaml`,
reachable only as `http://litellm:4000` — needs two environment settings on the
`api` and `worker` processes:

| Setting              | Value                 | Why                                                                                                                                                                                                                                    |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_ENABLED`         | `true`                | Feature flag; the default is `false`, and with it off every `/ai/*` route returns `404 AI_DISABLED`.                                                                                                                                   |
| `AI_PRIVATE_ORIGINS` | `http://litellm:4000` | Comma-separated allowlist of exact HTTP(S) origins. The transport refuses `http://` endpoints and private (RFC1918 / loopback) addresses unless the origin is listed, so a private compose-network origin must be opted in explicitly. |

Then add an _OpenAI-compatible API_ connection in **Settings → AI →
Connections** with Base URL `http://litellm:4000/v1` and the gateway's master
key as the API key, verify a model, and route tasks through it.

`AI_PRIVATE_ORIGINS` is a trusted-origin allowlist, not a general "allow
private" switch: list only internal endpoints you control, and never a public
host. Adding an origin does not disable TLS verification for `https://`
endpoints — `ProviderTransport` resolves the hostname, rejects
private/link-local/metadata addresses, pins the request to that checked address,
and still verifies the certificate and SNI against the original hostname. For a
public gateway leave `AI_PRIVATE_ORIGINS` unset; the default policy already
permits public `https://` endpoints.

LiteLLM and Python are optional: the native OpenAI/Anthropic/Gemini adapters,
the generic OpenAI-compatible adapter and the local Ollama connector all work
without this gateway.

## Capability gating

Capabilities are reported as `supported` / `unsupported` / `unverified` per model
and are **never assumed**. A task runs only when its required features are all
`supported` (`packages/ai` `canRunTask`):

| Task                      | Required capabilities                        |
| ------------------------- | -------------------------------------------- |
| `invoice_extraction`      | `text`, `structured_output`                  |
| `image_tagging`           | `vision`, `image_input`, `structured_output` |
| `natural_language_search` | `text`, `structured_output`                  |
| `maintenance_assistant`   | `text`                                       |
| `asset_chat`              | `text`                                       |

A model must be verified (a live probe) against its current connection before it
can be routed; changing the connection invalidates verification.

## Offline / AI-disabled regression

With `AI_ENABLED=false` (the default), the AI controllers are guarded by
`AiFeatureGuard`, which returns `404 AI_DISABLED` for every `/ai/*` route while
**all core endpoints keep working**. This is verified by automated tests:

- `apps/api/src/ai/ai-connections.e2e.test.ts` boots a second application with
  `AI_ENABLED=false` and asserts `404 AI_DISABLED` on AI routes while a core
  workspace read still returns `200`.
- `apps/api/src/ai/ai-tasks.e2e.test.ts` runs the full draft pipeline (query,
  chat, maintenance) against a faked adapter and asserts consent, budget,
  capability and scoping rules.
- `apps/api/src/perf/perf.e2e.test.ts` and the rest of the suite run with
  `AI_ENABLED=false`, proving core asset management never depends on AI.

## Manual live verification (not yet executed)

The following require real credentials and are documented, not claimed:

1. Add one native (e.g. OpenAI), one OpenAI-compatible custom endpoint, and one
   local Ollama connection; run _Test connection_ and _Test model_ on each.
2. Route `invoice_extraction` to a vision/text model, upload a text invoice,
   confirm a draft with confidence + evidence, approve, and verify the created
   asset + audit trail.
3. Toggle `AI_ENABLED=false` and confirm the SPA hides AI controls and core
   flows (login, assets, documents) are unaffected.
