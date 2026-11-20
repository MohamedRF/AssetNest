import type { operations } from './openapi.generated.js';
import { restOperations } from './operations.generated.js';
import type { OperationId, OperationOptions, OperationResult } from './operation-types.js';
export type { operations, paths } from './openapi.generated.js';
export type { OperationId, OperationOptions, OperationResult } from './operation-types.js';

export type AssetListQuery = NonNullable<operations['listAssets']['parameters']['query']>;
export type AssetPage = operations['listAssets']['responses'][200]['content']['application/json'];
export type AssetDetail = operations['getAsset']['responses'][200]['content']['application/json'];
export type AssetHistory = operations['getAssetHistory']['responses'][200]['content']['application/json'];
export type CreateAssetRequest = operations['createAsset']['requestBody']['content']['application/json'];
export type UpdateAssetRequest = operations['updateAsset']['requestBody']['content']['application/json'];
export type TransitionAssetRequest =
  operations['transitionAssetStatus']['requestBody']['content']['application/json'];

type ResponseFormat = 'json' | 'text' | 'blob' | 'empty';

interface RequestOptions {
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  format?: ResponseFormat;
  responseFormats?: Partial<Record<number, ResponseFormat>>;
  multipart?: boolean;
  allowUnavailable?: boolean;
  session?: boolean;
  csrfToken?: string;
  headers?: ConstructorParameters<typeof Headers>[0];
  signal?: AbortSignal;
}

const REQUEST_TIMEOUT_MS = 30_000;

export interface AssetNestClientOptions {
  /** Deployment root, for example https://inventory.example.com */
  baseUrl: string | URL;
  /** Workspace-scoped token for operations whose OpenAPI scheme permits bearer auth. */
  token?: string;
}

export class AssetNestHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`AssetNest API returned HTTP ${status}`);
    this.name = 'AssetNestHttpError';
  }
}

function pathSegment(value: string): string {
  if (!value || value === '.' || value === '..') throw new TypeError('Invalid AssetNest resource ID');
  return encodeURIComponent(value);
}

export class AssetNestClient {
  readonly #baseUrl: URL;
  readonly #token?: string;

  constructor({ baseUrl, token }: AssetNestClientOptions) {
    const url = new URL(baseUrl);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new TypeError('Expected an HTTP(S) deployment URL without credentials, query or fragment');
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    this.#baseUrl = url;
    this.#token = token;
  }

  execute<T extends OperationId>(
    operation: T,
    options: OperationOptions<NoInfer<T>>,
  ): Promise<OperationResult<T>> {
    if (!Object.hasOwn(restOperations, operation)) throw new TypeError('Unknown AssetNest operation');
    const definition = restOperations[operation];
    const pathParams = options.path as Record<string, string> | undefined;
    const path = definition.path.replace(/\{([^}]+)\}/g, (_placeholder, name: string) =>
      pathSegment(pathParams?.[name] ?? ''),
    );
    return this.#request(
      path.slice('/api/v1'.length),
      {
        method: definition.method,
        multipart: definition.multipart,
        responseFormats: definition.responseFormats,
        query: options.query as Record<string, unknown> | undefined,
        body: options.body,
        headers: options.headers,
        signal: options.signal,
        csrfToken: options.csrfToken,
        session: options.session,
      },
      definition.bearer && !options.session ? this.#token : undefined,
    );
  }

  getLiveness(signal?: AbortSignal) {
    return this.#request<operations['getLiveness']['responses'][200]['content']['application/json']>(
      '/health/live',
      { signal },
    );
  }

  getReadiness(signal?: AbortSignal) {
    type Responses = operations['getReadiness']['responses'];
    return this.#request<Responses[200 | 503]['content']['application/json']>('/health/ready', {
      signal,
      allowUnavailable: true,
    });
  }

  getVersion(signal?: AbortSignal) {
    return this.#request<operations['getVersion']['responses'][200]['content']['application/json']>(
      '/version',
      { signal },
    );
  }

  listAssets(workspaceId: string, query?: AssetListQuery, signal?: AbortSignal): Promise<AssetPage> {
    return this.#assetRequest(workspaceId, '', { query, signal });
  }

  createAsset(workspaceId: string, body: CreateAssetRequest, signal?: AbortSignal): Promise<AssetDetail> {
    return this.#assetRequest(workspaceId, '', { method: 'POST', body, signal });
  }

  getAsset(workspaceId: string, assetId: string, signal?: AbortSignal): Promise<AssetDetail> {
    return this.#assetRequest(workspaceId, `/${pathSegment(assetId)}`, { signal });
  }

  updateAsset(
    workspaceId: string,
    assetId: string,
    body: UpdateAssetRequest,
    signal?: AbortSignal,
  ): Promise<AssetDetail> {
    return this.#assetRequest(workspaceId, `/${pathSegment(assetId)}`, { method: 'PATCH', body, signal });
  }

  archiveAsset(workspaceId: string, assetId: string, signal?: AbortSignal): Promise<AssetDetail> {
    return this.#assetRequest(workspaceId, `/${pathSegment(assetId)}/archive`, { method: 'POST', signal });
  }

  transitionAssetStatus(
    workspaceId: string,
    assetId: string,
    body: TransitionAssetRequest,
    signal?: AbortSignal,
  ): Promise<AssetDetail> {
    return this.#assetRequest(workspaceId, `/${pathSegment(assetId)}/status-transition`, {
      method: 'POST',
      body,
      signal,
    });
  }

  getAssetHistory(workspaceId: string, assetId: string, signal?: AbortSignal): Promise<AssetHistory> {
    return this.#assetRequest(workspaceId, `/${pathSegment(assetId)}/history`, { signal });
  }

  getAssetQr(workspaceId: string, assetId: string, signal?: AbortSignal) {
    return this.#assetRequest<operations['getAssetQr']['responses'][200]['content']['image/svg+xml']>(
      workspaceId,
      `/${pathSegment(assetId)}/qr`,
      { format: 'text', signal },
    );
  }

  #assetRequest<T>(workspaceId: string, path: string, options: RequestOptions): Promise<T> {
    return this.#request(`/workspaces/${pathSegment(workspaceId)}/assets${path}`, options, this.#token);
  }

  async #request<T>(path: string, options: RequestOptions, token?: string): Promise<T> {
    const url = new URL(this.#baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1${path}`;
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (Array.isArray(value)) {
        for (const entry of value) url.searchParams.append(key, String(entry));
        continue;
      }
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers = new Headers(options.headers);
    if (!headers.has('Accept')) {
      headers.set('Accept', options.format === 'text' ? 'image/svg+xml' : options.responseFormats ? '*/*' : 'application/json');
    }
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    if (options.csrfToken) headers.set('X-CSRF-Token', options.csrfToken);
    let body: string | FormData | undefined;
    if (options.multipart && options.body !== undefined) {
      if (!(options.body instanceof FormData)) throw new TypeError('Expected a FormData request body');
      headers.delete('Content-Type');
      body = options.body;
    } else if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      credentials: options.session ? 'include' : 'omit',
      redirect: 'error',
    });
    if (!response.ok && !(options.allowUnavailable && response.status === 503)) {
      const contentType = response.headers.get('content-type') ?? '';
      const body: unknown = contentType.includes('json')
        ? await response.json().catch(() => undefined)
        : await response.body?.cancel();
      throw new AssetNestHttpError(response.status, body);
    }
    switch (options.responseFormats?.[response.status] ?? options.format ?? 'json') {
      case 'blob':
        return (await response.blob()) as T;
      case 'text':
        return (await response.text()) as T;
      case 'empty':
        return undefined as T;
      case 'json':
        return (await response.json()) as T;
    }
  }
}
