import { Body, Controller, Header, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentAuth } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { ApiSessionCsrf } from '../auth/openapi.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { AuthContext } from '../auth/session-auth.guard.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AssetLabelExportService } from './asset-label-export.service.js';
import { assetRow } from './openapi.js';

const exportLabelsRequest = z.strictObject({
  assetIds: z
    .array(z.uuid().toLowerCase())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Asset IDs must be distinct'),
});

const labelDetails = assetRow
  .pick({
    id: true,
    assetTag: true,
    displayName: true,
    serialNumber: true,
    status: true,
    condition: true,
    purchasedAt: true,
    amount: true,
    currency: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    categoryName: z.string().nullable(),
    locationName: z.string().nullable(),
    maker: z.string().nullable(),
    modelName: z.string().nullable(),
    tags: z.array(z.string()),
    customValues: z.record(z.string(), z.unknown()),
  });

@ApiTags('Assets')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/assets/qr-label-export', version: '1' })
export class AssetLabelExportController {
  constructor(@Inject(AssetLabelExportService) private readonly labels: AssetLabelExportService) {}

  @Post()
  @ApiOperation({
    operationId: 'getAssetLabelExport',
    description:
      'Returns private label export metadata. Requires assets:read, reports:read, and an enabled workspace export policy.',
  })
  @ApiSessionCsrf({ bearerSupported: true })
  @ApiBody({ schema: openApiSchema(exportLabelsRequest, 'input') })
  @ApiOkResponse({
    schema: openApiSchema(z.object({ items: z.array(labelDetails) })),
    headers: { 'Cache-Control': { schema: { type: 'string' } } },
  })
  @RequirePermissions('assets:read', 'reports:read')
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(HttpStatus.OK)
  async exportLabels(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(exportLabelsRequest)) body: z.infer<typeof exportLabelsRequest>,
  ) {
    return this.labels.getDetails(ctx, auth, body.assetIds);
  }
}
