import { HttpException, HttpStatus, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ProblemDetailsFilter, type ProblemDetails } from './problem-details.filter.js';
import { correlationMiddleware } from '../correlation.middleware.js';

interface MockResponse {
  statusCode: number;
  contentType: string | undefined;
  body: ProblemDetails | undefined;
  status: (code: number) => MockResponse;
  type: (value: string) => MockResponse;
  json: (payload: ProblemDetails) => MockResponse;
}

function mockHost(url = '/api/v1/example') {
  const res: MockResponse = {
    statusCode: 0,
    contentType: undefined,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    type(value: string) {
      res.contentType = value;
      return res;
    },
    json(payload: ProblemDetails) {
      res.body = payload;
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url }),
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

function expectNoLeaks(body: ProblemDetails | undefined) {
  expect(body).toBeDefined();
  expect(body?.type).toBe('about:blank');
  expect(body?.instance).toBeDefined();
  expect(body?.requestId).toBeDefined();
  // Never leak internals to clients.
  expect(JSON.stringify(body)).not.toMatch(/at\s+\S+\s+\(/); // stack frame shape
  expect(JSON.stringify(body)).not.toContain('node_modules');
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  it('maps a ZodError to 400 VALIDATION_FAILED', () => {
    const schema = z.object({ name: z.string().min(2) });
    const parsed = schema.safeParse({ name: '' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const { host, res } = mockHost('/api/v1/assets');
    filter.catch(parsed.error, host);
    expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(res.contentType).toContain('application/problem+json');
    expect(res.body?.code).toBe('VALIDATION_FAILED');
    expect(res.body?.status).toBe(400);
    expect(res.body?.detail).toContain('name');
    expectNoLeaks(res.body);
  });

  it('passes through a NestJS HttpException with its status and message', () => {
    const { host, res } = mockHost('/api/v1/assets/123');
    filter.catch(new NotFoundException('Asset not found'), host);
    expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(res.body?.detail).toBe('Asset not found');
    expect(res.body?.status).toBe(404);
    expectNoLeaks(res.body);
  });

  it('omits authentication query parameters from the problem instance', () => {
    const { host, res } = mockHost('/api/v1/auth/oidc/callback?code=private-code&state=private-state');
    filter.catch(new HttpException('Invalid authentication state', HttpStatus.BAD_REQUEST), host);
    expect(res.body?.instance).toBe('/api/v1/auth/oidc/callback');
    expect(JSON.stringify(res.body)).not.toContain('private-code');
  });

  it('uses the first string message when an HttpException carries an array message', () => {
    const { host, res } = mockHost();
    filter.catch(
      new HttpException({ message: ['first problem', 'second problem'] }, HttpStatus.BAD_REQUEST),
      host,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body?.detail).toBe('first problem; second problem');
  });

  it('maps a 5xx HttpException to a generic body', () => {
    const { host, res } = mockHost();
    filter.catch(
      new HttpException('database connection failed at 10.0.0.5', HttpStatus.INTERNAL_SERVER_ERROR),
      host,
    );
    expect(res.statusCode).toBe(500);
    expect(res.body?.detail).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });

  it('maps an unknown error to 500 INTERNAL_ERROR without leaking details', () => {
    const { host, res } = mockHost('/api/v1/boom');
    filter.catch(new Error('secret internal failure: password db-prod-01'), host);
    expect(res.statusCode).toBe(500);
    expect(res.body?.code).toBe('INTERNAL_ERROR');
    expect(res.body?.detail).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('db-prod-01');
    expectNoLeaks(res.body);
  });

  it('maps a non-Error thrown value to 500 INTERNAL_ERROR', () => {
    const { host, res } = mockHost();
    filter.catch('string failure', host);
    expect(res.statusCode).toBe(500);
    expect(res.body?.code).toBe('INTERNAL_ERROR');
    expectNoLeaks(res.body);
  });

  it('includes the x-request-id from the correlation context', () => {
    const req = { headers: { 'x-request-id': 'test-req-123' } } as unknown as Parameters<
      typeof correlationMiddleware
    >[0];
    const resHeaders: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        resHeaders[name] = value;
      },
    } as unknown as Parameters<typeof correlationMiddleware>[1];
    correlationMiddleware(req, res, () => {
      const { host, res: mockRes } = mockHost('/api/v1/in-context');
      filter.catch(new NotFoundException('nope'), host);
      expect(mockRes.body?.requestId).toBe('test-req-123');
    });
    expect(resHeaders['x-request-id']).toBe('test-req-123');
  });
});
