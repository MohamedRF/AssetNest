import { z } from 'zod';
import { assetRow } from '../assets/openapi.js';
import { openApiSchema } from '../common/openapi.js';

export const assignAssetResponse = openApiSchema(
  z.object({
    asset: assetRow,
    assignment: z.object({
      id: z.uuid(),
      memberId: z.uuid(),
      assignedAt: z.iso.datetime(),
    }),
  }),
);

export const custodyAssetResponse = openApiSchema(assetRow);

export const listAssignmentsResponse = openApiSchema(
  z.object({
    assignments: z.array(
      z.object({
        assignmentId: z.uuid(),
        assetId: z.uuid(),
        assetTag: z.string(),
        displayName: z.string(),
        memberId: z.uuid(),
        memberName: z.string(),
        memberEmail: z.email(),
        role: z.string(),
        assignedAt: z.iso.datetime(),
        notes: z.string().nullable(),
      }),
    ),
  }),
);
