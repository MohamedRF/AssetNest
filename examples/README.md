# AssetNest integration examples

Working integration patterns for AssetNest. Everything here runs against a
local or self-hosted instance — no hosted services required.

## Files

| File                              | What it is                                                                                                                  | Verification                                                                                                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webhook-receiver.mjs`            | Zero-dependency Node server with raw-byte HMAC verification, a five-minute replay window, and signed event ID deduplication | Local HTTP test covers valid and altered payloads, duplicate events, stale timestamps, invalid UTF-8, and the 2 MiB limit.                                                                                                                             |
| `import-assets.mjs`               | Bulk CSV → AssetNest via the HTTP API (Bearer `anst_` token), dry-run first with per-row verdicts, `--commit` to apply      | Executed against a live instance: dry-run reported an invalid `status` row (`maintenance` → valid options are e.g. `in_repair`); after fixing, dry-run clean; `--commit` imported 3 assets; re-run skipped 3 duplicates; temp token revoked afterwards |
| `n8n-asset-webhook-receiver.json` | Reads raw webhook bytes, computes HMAC with a Crypto credential, and compares the signature before the ticket branch        | Workflow graph and Code nodes verified with synthetic fixtures. Live n8n verification pending.                                                                                                                                                         |
| `n8n-asset-health.json`           | Daily digest of lost assets and warranties expiring within 30 days                                                          | Workflow graph and Code node verified with synthetic REST responses. Live n8n verification pending.                                                                                                                                                    |

## Auth model

All examples use a first-party **API token** (`anst_…`) created in the
Integrations UI with the minimal scopes needed (e.g. `assets:read`,
`assets:write`, `reports:read`). Scope is enforced per route; the token is
bound to exactly one workspace; cross-workspace access is refused.

## Quick start — import example

```bash
ASSETNEST_URL=http://localhost:3000 \
ASSETNEST_TOKEN=anst_xxx \
ASSETNEST_WORKSPACE_ID=00000000-0000-0000-0000-000000000000 \
node examples/import-assets.mjs ./assets.csv           # dry-run
ASSETNEST_URL=... ASSETNEST_TOKEN=... ASSETNEST_WORKSPACE_ID=... \
node examples/import-assets.mjs ./assets.csv --commit  # apply
```

## Quick start — webhook receiver example

```bash
WEBHOOK_SECRET=whsec_xxx node examples/webhook-receiver.mjs 8787
```

Then create a webhook in AssetNest (Integrations UI) pointing at
`http://<host>:8787/assetnest`, subscribe to some events, press **Send test**.

Signature format: `X-Assetnest-Signature: t=<unix>,v1=<hex hmac-sha256("<t>.<raw-body>")>`
Additional headers include `X-Assetnest-Event` and `X-Assetnest-Delivery`. Delivery is at least once. Verify the signature before processing and use the signed event ID as your durable idempotency key.

## n8n setup

Run the dependency-free fixture tests with `node --test examples/n8n-workflows.test.mjs examples/webhook-receiver.test.mjs`.

Import the webhook workflow into self-hosted n8n 2.22 or later. Add the signing key as the Hmac Secret in a Crypto credential and select it on the **Compute HMAC from credential** node. Allow the built-in `crypto` module for the JavaScript task runner so the verification node can call `timingSafeEqual`. Leave environment-variable access blocked. [Crypto credentials](https://docs.n8n.io/integrations/builtin/credentials/crypto/) · [Task runner module allowlisting](https://docs.n8n.io/deploy/host-n8n/configure-n8n/set-up-task-runners/)

Activate the workflow and use its Production URL in the AssetNest webhook subscription. A 2xx response acknowledges receipt. The workflow verifies the HMAC and timestamp before evaluating the ticket branch, which handles only `asset.status_changed`. Use the signed `eventId` as a durable idempotency key for downstream actions. The template omits persisted execution data and leaves the example ticket node disabled until configured.

For the health digest, set your deployment URL and workspace UUID in both HTTP nodes. Create a Header Auth credential with `Authorization` set to `Bearer <token>` and attach it to both nodes. The token needs only `assets:read`. Run the workflow manually before enabling the schedule and notification node.

## Optional: LiteLLM gateway (P5-11)

LiteLLM is an **optional, independent** gateway that fans AssetNest's
OpenAI-compatible connection out to many upstream providers with budgets,
retries and fallbacks. AssetNest never requires LiteLLM or Python — the native
OpenAI/Anthropic/Gemini adapters, the generic OpenAI-compatible adapter and the
local Ollama connector all work on their own. Use this only if you want LiteLLM's
provider routing.

Bring it up alongside the reference stack (from the repo root, with a `.env`
that defines `LITELLM_MASTER_KEY` and `LITELLM_OPENAI_API_KEY`):

```bash
docker compose --env-file .env \
  -f infrastructure/compose/compose.yaml \
  -f infrastructure/compose/compose.litellm.yaml \
  --profile app --profile litellm up -d
```

The gateway is not published on the host; only the `api` and `worker`
containers can reach it, as `http://litellm:4000`. To let AssetNest use it, set
both of these in the repo-root `.env` (the `api` and `worker` services read it
through their `env_file`):

```dotenv
AI_ENABLED=true                         # AI is off by default
AI_PRIVATE_ORIGINS=http://litellm:4000  # comma-separated HTTP(S) origins
```

`AI_PRIVATE_ORIGINS` is AssetNest's SSRF allowlist. The AI transport refuses
plain `http://` endpoints and private (RFC1918 / loopback) addresses unless the
exact origin is listed there, so `http://litellm:4000` must be allowlisted or
every request fails with `AI_PROVIDER_INVALID_ENDPOINT`. Keep the list to
**trusted internal origins only** — adding a public host would relax the guard
for that origin. TLS verification is unchanged for public `https://` endpoints:
the transport resolves the hostname, rejects private/link-local/metadata
addresses, then pins the request to that checked address while still verifying
the certificate and SNI against the original hostname.

Only `LITELLM_MASTER_KEY` and `OPENAI_API_KEY` (from `LITELLM_OPENAI_API_KEY`)
are passed into the gateway container — there is no `env_file`, so AssetNest's
own `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, SMTP credentials and AI
keys never reach it. The image is pinned to the `v1.110.2` release tag rather
than the mutable `main-stable`.

Then in AssetNest **Settings → AI → Connections** add an _OpenAI-compatible API_
connection with Base URL `http://litellm:4000/v1` (container network name) and
the LiteLLM master key as the API key. Mark a model as verified and route the
tasks you want through it. `infrastructure/compose/litellm-config.yaml` shows a
single-upstream example; add more `model_list` entries for other providers,
fallbacks and budgets — see <https://docs.litellm.ai/docs/proxy/configs>.
