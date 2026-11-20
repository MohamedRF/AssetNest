import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';

const warrantyDetails = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  provider: z.string(),
  startsOn: z.iso.date(),
  expiresOn: z.iso.date(),
  details: z.string().nullable(),
});

export const warrantyResponse = openApiSchema(
  warrantyDetails.extend({
    workspaceId: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export const listWarrantiesResponse = openApiSchema(
  z.object({
    warranties: z.array(
      warrantyDetails.extend({
        assetTag: z.string(),
        assetName: z.string(),
        derivedStatus: z.enum(['expired', 'expiring_90', 'expiring_30', 'active']),
      }),
    ),
  }),
);
