import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface CorrelationStore {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<CorrelationStore>();

/**
 * Read-side accessor for the correlation context. Returns `undefined` outside
 * a request scope (e.g. during bootstrap).
 */
export class CorrelationContext {
  static getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  }
}

/**
 * Accept inbound x-request-id only if it is a conservative, header-safe value.
 * Anything else is replaced with a fresh UUID so a malicious or buggy client
 * cannot inject arbitrary content into logs or response headers.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function resolveRequestId(incoming: string | string[] | undefined): string {
  if (typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}

/**
 * Express-style middleware. Reads or creates the x-request-id, stores it in
 * AsyncLocalStorage for the lifetime of the request and echoes it back as a
 * response header. Registered globally via `app.use(...)`.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  res.setHeader('x-request-id', requestId);
  storage.run({ requestId }, () => next());
}
