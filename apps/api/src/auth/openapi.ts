import { WORKSPACE_MODES, WORKSPACE_ROLES } from '@assetnest/domain';
import type { HeaderObject } from '@nestjs/swagger';
import { ApiHeader } from '@nestjs/swagger';
import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';

export const workspaceSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  mode: z.enum(WORKSPACE_MODES),
  role: z.enum(WORKSPACE_ROLES),
});

export const sessionIdentityResponse = openApiSchema(
  z.object({
    user: z.object({ id: z.uuid(), email: z.email(), displayName: z.string() }),
    workspaces: z.array(workspaceSummarySchema),
    csrfToken: z.string().describe('Send as x-csrf-token for authenticated session mutations'),
  }),
);

export const sessionsResponse = openApiSchema(
  z.object({
    sessions: z.array(
      z.object({
        id: z.uuid(),
        createdAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        lastSeenAt: z.iso.datetime().nullable(),
        userAgent: z.string().nullable(),
        revokedAt: z.iso.datetime().nullable(),
        isCurrent: z.boolean(),
      }),
    ),
  }),
);

export const okResponse = openApiSchema(z.object({ ok: z.literal(true) }));

export const sessionCookieHeader: HeaderObject = {
  description: 'Establishes the HttpOnly assetnest_session cookie',
  schema: { type: 'string' },
};

export const clearSessionCookieHeader: HeaderObject = {
  description: 'Clears the assetnest_session cookie when the current session is revoked',
  schema: { type: 'string' },
};

export function ApiSessionCsrf(options: { bearerSupported?: boolean } = {}): MethodDecorator {
  return ApiHeader({
    name: 'x-csrf-token',
    required: !options.bearerSupported,
    description: options.bearerSupported
      ? 'Required when authenticating with the session cookie'
      : 'CSRF token returned by login or GET /api/v1/auth/me',
    schema: { type: 'string' },
  });
}
