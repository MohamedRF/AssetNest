/**
 * Typed fetch wrapper for the AssetNest API.
 *
 * - Base URL: `import.meta.env.VITE_API_URL` ?? `/api/v1`
 * - Session auth via cookies (`credentials: 'include'`); CSRF is enforced by the API.
 * - 401 responses trigger a redirect to `/login` (unless already there).
 * - RFC 7807 problem+json error bodies are normalized into {@link ApiError}.
 * - Secrets are never logged.
 */

export interface ApiErrorInit {
  status: number;
  code: string;
  title: string;
  detail: string;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly requestId?: string;

  constructor(init: ApiErrorInit) {
    super(init.detail || init.title);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    if (init.requestId !== undefined) this.requestId = init.requestId;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Where the SPA sends the user when the session is missing/expired. */
export function shouldRedirectToLogin(pathname: string): boolean {
  return pathname !== '/login';
}

export type UnauthorizedHandler = () => void;

const defaultUnauthorizedHandler: UnauthorizedHandler = () => {
  if (typeof window !== 'undefined' && shouldRedirectToLogin(window.location.pathname)) {
    window.location.assign('/login');
  }
};

let unauthorizedHandler: UnauthorizedHandler = defaultUnauthorizedHandler;

/**
 * Override the 401 handler (used by tests and by the login page).
 * Pass `undefined` to restore the default redirect behavior.
 */
export function setUnauthorizedHandler(handler?: UnauthorizedHandler): void {
  unauthorizedHandler = handler ?? defaultUnauthorizedHandler;
}

/**
 * Session CSRF token (synchronizer pattern). Issued by /auth/login,
 * /auth/register and /auth/me; kept in memory only — never persisted.
 * Attached automatically as `x-csrf-token` on mutating requests.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

const BASE_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

export function getApiBaseUrl(): string {
  return BASE_URL;
}

const JSON_CONTENT_TYPE = 'application/json';

/** RFC 7807 uses application/problem+json; some servers emit +json suffixes generally. */
function isJsonContentType(contentType: string): boolean {
  return contentType.includes(JSON_CONTENT_TYPE) || contentType.includes('+json');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Normalize an RFC 7807 (problem+json) body — or any fallback — into ApiError. */
async function toApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get('content-type') ?? '';
  let body: unknown;
  try {
    body = isJsonContentType(contentType) ? await response.json() : await response.text();
  } catch {
    body = undefined;
  }

  const problem = asRecord(body);
  const title =
    asString(problem?.title) ?? (response.statusText || `Request failed with status ${response.status}`);
  const detailFromBody = asString(problem?.detail) ?? asString(problem?.message);
  const code = asString(problem?.code) ?? asString(problem?.type) ?? `http_${response.status}`;
  const requestId = asString(problem?.requestId) ?? asString(problem?.instance);

  const init: ApiErrorInit = {
    status: response.status,
    code,
    title,
    detail:
      detailFromBody ??
      (typeof body === 'string' && body.length > 0
        ? body.slice(0, 500)
        : `The server responded with status ${response.status}.`),
  };
  if (requestId !== undefined) init.requestId = requestId;
  return new ApiError(init);
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const { method, body, signal } = options;
  const hasBody = body !== undefined;
  // The request type models GET plus mutating verbs; every non-GET needs CSRF.
  const isMutating = method !== 'GET';

  let response: Response;
  try {
    const headers: Record<string, string> = hasBody
      ? { 'Content-Type': JSON_CONTENT_TYPE, Accept: JSON_CONTENT_TYPE }
      : { Accept: JSON_CONTENT_TYPE };
    if (isMutating && csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch (error) {
    // Caller-initiated aborts propagate untouched.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({
      status: 0,
      code: 'network_error',
      title: 'Network error',
      detail: 'Could not reach the API. Check your connection and that the server is running.',
    });
  }

  if (response.status === 401) {
    setCsrfToken(null);
    unauthorizedHandler();
    throw await toApiError(response);
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!isJsonContentType(contentType)) {
    // Success with no JSON payload (e.g. 200 empty) — surface as undefined.
    return undefined as T;
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({
      status: response.status,
      code: 'invalid_response',
      title: 'Invalid response',
      detail: 'The server returned malformed JSON.',
    });
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    request<T>(path, { method: 'GET', ...(signal !== undefined ? { signal } : {}) }),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
} as const;
