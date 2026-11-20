import { PERMISSIONS } from '@assetnest/domain';
import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';

const tokenSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  tokenPrefix: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const issuedTokenResponse = openApiSchema(
  tokenSummary.extend({
    scopes: z.array(z.enum(PERMISSIONS)),
    token: z.string().describe('The opaque bearer token. It is returned once at issuance.'),
  }),
);

export const listTokensResponse = openApiSchema(
  z.object({
    tokens: z.array(
      tokenSummary.extend({
        scopes: z.array(z.string()),
        lastUsedAt: z.iso.datetime().nullable(),
        revokedAt: z.iso.datetime().nullable(),
      }),
    ),
  }),
);

export const revokeTokenResponse = openApiSchema(z.object({ ok: z.literal(true) }));
