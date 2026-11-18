import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { CorrelationContext, correlationMiddleware, resolveRequestId } from './correlation.middleware.js';

function fakeRequestResponse(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const captured: { setHeader?: [string, string] } = {};
  const res = {
    setHeader: (name: string, value: string) => {
      captured.setHeader = [name, value];
    },
  } as unknown as Response;
  return { req, res, captured };
}

describe('correlationMiddleware', () => {
  it('creates a request id when the client did not send one', () => {
    const { req, res, captured } = fakeRequestResponse();
    let seen: string | undefined;
    const next: NextFunction = () => {
      seen = CorrelationContext.getRequestId();
    };
    correlationMiddleware(req, res, next);
    expect(seen).toBeDefined();
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(captured.setHeader?.[0]).toBe('x-request-id');
    expect(captured.setHeader?.[1]).toBe(seen);
  });

  it('preserves a safe incoming x-request-id', () => {
    const { req, res, captured } = fakeRequestResponse({ 'x-request-id': 'req-abc123_.-' });
    let seen: string | undefined;
    const next: NextFunction = () => {
      seen = CorrelationContext.getRequestId();
    };
    correlationMiddleware(req, res, next);
    expect(seen).toBe('req-abc123_.-');
    expect(captured.setHeader?.[1]).toBe('req-abc123_.-');
  });

  it('replaces an unsafe incoming id', () => {
    // ':' is outside the safe charset and must be replaced, not echoed.
    const { req, res } = fakeRequestResponse({ 'x-request-id': 'bad:id' });
    let seen: string | undefined;
    correlationMiddleware(req, res, () => {
      seen = CorrelationContext.getRequestId();
    });
    expect(seen).not.toBe('bad:id');
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resolveRequestId rejects invalid shapes and keeps valid ones', () => {
    const longId = 'a'.repeat(500);
    expect(resolveRequestId(longId)).not.toBe(longId);
    expect(resolveRequestId('bad id with spaces')).not.toBe('bad id with spaces');
    expect(resolveRequestId(['a', 'b'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('keep-me_1.2.3-xyz')).toBe('keep-me_1.2.3-xyz');
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
