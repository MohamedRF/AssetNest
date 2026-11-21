import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { AssetsService } from './assets.service.js';
import { QrService } from './qr.service.js';
import {
  ApiAssetListQuery,
  assetDetailResponse,
  assetHistoryResponse,
  assetListResponse,
} from './openapi.js';
import {
  createAssetSchema,
  listAssetsQuerySchema,
  statusTransitionSchema,
  updateAssetSchema,
  type CreateAssetInput,
  type ListAssetsQuery,
  type StatusTransitionInput,
  type UpdateAssetInput,
} from './dto.js';

@ApiTags('Assets')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/assets', version: '1' })
export class AssetsController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly qrService: QrService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listAssets' })
  @ApiAssetListQuery()
  @ApiOkResponse({ schema: assetListResponse })
  @RequirePermissions('assets:read')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodValidationPipe(listAssetsQuerySchema)) query: ListAssetsQuery,
  ) {
    return this.assetsService.list(ctx, query);
  }

  @Post()
  @ApiOperation({ operationId: 'createAsset' })
  @ApiBody({ schema: openApiSchema(createAssetSchema, 'input') })
  @ApiCreatedResponse({ schema: assetDetailResponse })
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createAssetSchema)) body: CreateAssetInput,
  ) {
    return this.assetsService.create(ctx, user.id, body);
  }

  @Get(':assetId')
  @ApiOperation({ operationId: 'getAsset' })
  @ApiOkResponse({ schema: assetDetailResponse })
  @RequirePermissions('assets:read')
  async get(@CurrentWorkspace() ctx: WorkspaceContext, @Param('assetId') assetId: string) {
    return this.assetsService.get(ctx, assetId);
  }

  @Patch(':assetId')
  @ApiOperation({ operationId: 'updateAsset' })
  @ApiBody({ schema: openApiSchema(updateAssetSchema, 'input') })
  @ApiOkResponse({ schema: assetDetailResponse })
  @RequirePermissions('assets:write')
  async update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(updateAssetSchema)) body: UpdateAssetInput,
  ) {
    return this.assetsService.update(ctx, user.id, assetId, body);
  }

  @Post(':assetId/archive')
  @ApiOperation({ operationId: 'archiveAsset' })
  @ApiOkResponse({ schema: assetDetailResponse })
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('assetId') assetId: string,
  ) {
    return this.assetsService.archive(ctx, user.id, assetId);
  }

  @Post(':assetId/status-transition')
  @ApiOperation({ operationId: 'transitionAssetStatus' })
  @ApiBody({ schema: openApiSchema(statusTransitionSchema, 'input') })
  @ApiOkResponse({ schema: assetDetailResponse })
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.OK)
  async statusTransition(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(statusTransitionSchema)) body: StatusTransitionInput,
  ) {
    return this.assetsService.transitionStatus(ctx, user.id, assetId, body);
  }

  @Get(':assetId/history')
  @ApiOperation({ operationId: 'getAssetHistory' })
  @ApiOkResponse({ schema: assetHistoryResponse })
  @RequirePermissions('assets:read')
  async history(@CurrentWorkspace() ctx: WorkspaceContext, @Param('assetId') assetId: string) {
    return { events: await this.assetsService.history(ctx, assetId) };
  }

  @Get(':assetId/qr')
  @ApiOperation({ operationId: 'getAssetQr' })
  @ApiQuery({ name: 'format', required: false, enum: ['link'] })
  @ApiOkResponse({ content: { 'image/svg+xml': { schema: { type: 'string' } } } })
  @RequirePermissions('assets:read')
  async qr(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('assetId') assetId: string,
    @Query('format', new ZodValidationPipe(z.literal('link').optional())) format: 'link' | undefined,
    @Res() res: Response,
  ) {
    const svg = await this.qrService.svgFor(ctx, assetId, format);
    res.type('image/svg+xml').set('Cache-Control', 'private, max-age=60').send(svg);
  }
}
