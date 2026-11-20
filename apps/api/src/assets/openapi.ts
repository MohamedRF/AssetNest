import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { ASSET_STATUSES } from '@assetnest/domain';
import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import { CONDITION, listAssetsQuerySchema } from './dto.js';

export const assetRow = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  assetTag: z.string(),
  categoryId: z.uuid().nullable(),
  modelId: z.uuid().nullable(),
  locationId: z.uuid().nullable(),
  custodianMembershipId: z.uuid().nullable(),
  displayName: z.string(),
  serialNumber: z.string().nullable(),
  status: z.enum(ASSET_STATUSES),
  condition: z.enum(CONDITION),
  version: z.int(),
  purchasedAt: z.iso.date().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

export const assetDetailResponse = openApiSchema(
  assetRow.extend({
    tags: z.array(z.string()),
    customValues: z.record(z.string(), z.unknown()),
  }),
);

export const assetListResponse = openApiSchema(
  z.object({ items: z.array(assetRow), page: z.int(), pageSize: z.int(), total: z.int() }),
);

export const assetHistoryResponse = openApiSchema(
  z.object({
    events: z.array(
      z.object({
        id: z.uuid(),
        action: z.string(),
        actorId: z.uuid().nullable(),
        beforeJson: z.unknown(),
        afterJson: z.unknown(),
        occurredAt: z.iso.datetime(),
        correlationId: z.string(),
      }),
    ),
  }),
);

export function ApiAssetListQuery(): MethodDecorator {
  return applyDecorators(
    ...Object.entries(listAssetsQuerySchema.shape).map(([name, schema]) =>
      ApiQuery({ name, required: false, schema: openApiSchema(schema, 'input') }),
    ),
  );
}
