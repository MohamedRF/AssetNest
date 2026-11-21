# AssetNest REST SDK

The TypeScript SDK generates request and response types from the REST v1 OpenAPI document. Use `client.execute(operationId, options)` for generated operations. Asset catalog and system endpoints also have dedicated methods.

Download and unpack the outer `sdk-<commit SHA>` artifact from a passing CI run, then install the package tarball:

```sh
npm install ./assetnest-sdk-0.1.0.tgz
```

```ts
import { AssetNestClient } from '@assetnest/sdk';

const client = new AssetNestClient({
  baseUrl: 'https://inventory.example.com',
  token: process.env.ASSETNEST_API_TOKEN,
});
const assets = await client.listAssets('your-workspace-uuid', {
  pageSize: 20,
  status: 'available',
});
```

Use a token from your deployment's Integrations page with the required workspace scopes. Listing and reading assets require `assets:read`. Asset mutations require `assets:write`. Keep tokens in server-side configuration and use HTTPS for remote deployments. The SDK rejects redirects and limits requests to 30 seconds. Bearer calls omit cookies. Generated operations also support session mode for browser clients. Pass an `AbortSignal` to cancel earlier. HTTP errors surface as `AssetNestHttpError` with a status and an optional JSON body. Readiness returns the API's typed response for both HTTP 200 and 503.

## Development

```sh
pnpm sdk:generate
pnpm sdk:check
pnpm --filter @assetnest/sdk build
pnpm --filter @assetnest/sdk pack
```

The export command scans the same Nest controllers used by `/api/docs-json`. Request schemas come from the controllers' Zod definitions and response schemas describe the wire format. CI checks the committed declarations for drift and uploads the SDK package and OpenAPI document as separate artifacts keyed by commit SHA.
