import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, getApiBaseUrl, setUnauthorizedHandler, shouldRedirectToLogin } from './api';

function jsonResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

describe('api client', () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    setUnauthorizedHandler(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(undefined);
    window.history.pushState({}, '', '/');
  });

  it('defaults the base URL to /api/v1', () => {
    expect(getApiBaseUrl()).toBe('/api/v1');
  });

  it('only redirects to login when not already there', () => {
    expect(shouldRedirectToLogin('/assets')).toBe(true);
    expect(shouldRedirectToLogin('/')).toBe(true);
    expect(shouldRedirectToLogin('/login')).toBe(false);
  });

  it('sends credentials: include and JSON headers on POST', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await api.post('/auth/login', { email: 'a@b.c', password: 'secret' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/v1/auth/login');
    expect(init?.credentials).toBe('include');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }));
    expect(init?.body).toBe(JSON.stringify({ email: 'a@b.c', password: 'secret' }));
  });

  it('invokes the unauthorized handler and throws ApiError on 401', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        type: 'https://assetnest.test/problems/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Session expired',
        code: 'unauthorized',
        requestId: 'req-123',
      }),
    );

    await expect(api.get('/assets')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'unauthorized',
      title: 'Unauthorized',
      detail: 'Session expired',
      requestId: 'req-123',
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('default handler does not attempt navigation while on /login', async () => {
    window.history.pushState({}, '', '/login');
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { title: 'Unauthorized' }));
    // Default handler must not attempt navigation while on /login.
    await expect(api.get('/auth/me')).rejects.toBeInstanceOf(ApiError);
  });

  it('normalizes RFC 7807 problem+json error bodies', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        422,
        {
          type: 'https://assetnest.test/problems/validation',
          title: 'Validation failed',
          status: 422,
          detail: 'assetTag must match ^[A-Z0-9][A-Z0-9-]{0,63}$',
          code: 'validation_failed',
          requestId: 'req-422',
        },
        'application/problem+json',
      ),
    );

    const error = await api.get('/assets').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).code).toBe('validation_failed');
    expect((error as ApiError).title).toBe('Validation failed');
    expect((error as ApiError).detail).toContain('assetTag');
    expect((error as ApiError).requestId).toBe('req-422');
  });

  it('falls back gracefully when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const error = await api.get('/assets').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).code).toBe('http_502');
    expect((error as ApiError).detail).toBe(
      'AssetNest could not complete the request. Try again in a moment.',
    );
  });

  it('maps network failures to a status-0 network_error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const error = await api.get('/assets').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).code).toBe('network_error');
    expect((error as ApiError).detail).toMatch(/could not reach/i);
  });

  it('returns undefined for 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.post('/assets/1/archive', {})).resolves.toBeUndefined();
  });

  it('parses JSON success responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ id: 'a1' }]));
    await expect(api.get<Array<{ id: string }>>('/assets')).resolves.toEqual([{ id: 'a1' }]);
  });

  it('throws invalid_response when success JSON is malformed', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const error = await api.get('/assets').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_response');
  });
});
