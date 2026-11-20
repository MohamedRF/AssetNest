# AssetNest REST SDK

The TypeScript SDK covers the REST v1 asset catalog and system endpoints. Asset operations include list, create, fetch, update, archive, status transition, history, and QR. System operations include liveness, readiness, and version. Other REST routes are listed in the OpenAPI document and still need schema coverage.

Download the `sdk-<commit SHA>` artifact from a passing CI run, extract it, and install its package:

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

Use a token from your deployment's Integrations page with the required workspace scopes. Listing and reading require `assets:read`. Asset mutations require `assets:write`. Keep tokens in server-side configuration. Use HTTPS for remote deployments. The SDK rejects redirects, omits cookies, and limits requests to 30 seconds. Pass an `AbortSignal` to cancel earlier. HTTP errors surface as `AssetNestHttpError` with a status and an optional JSON body. Readiness returns the API's typed response for both HTTP 200 and 503.

## Development

```sh
pnpm sdk:generate
pnpm sdk:check
pnpm --filter @assetnest/sdk build
pnpm --filter @assetnest/sdk pack --pack-destination dist
```

The export command scans the same Nest controllers used by `/api/docs-json` with isolated settings. It writes the full route document to `dist/openapi.json`. Request validation schemas come from the controllers' existing Zod definitions. Response schemas describe serialized JSON and SVG. The generator selects the Assets and System operations. CI checks the committed declarations for drift and uploads the package and full OpenAPI as separate artifacts keyed by commit SHA. The web app uses the generated catalog types with its existing cookie and CSRF transport.
