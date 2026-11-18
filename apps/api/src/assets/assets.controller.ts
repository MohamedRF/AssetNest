import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { AssetsService } from './assets.service.js';
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

@Controller({ path: 'workspaces/:workspaceId/assets', version: '1' })
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  @RequirePermissions('assets:read')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodValidationPipe(listAssetsQuerySchema)) query: ListAssetsQuery,
  ) {
    return this.assetsService.list(ctx, query);
  }

  @Post()
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
  @RequirePermissions('assets:read')
  async get(@CurrentWorkspace() ctx: WorkspaceContext, @Param('assetId') assetId: string) {
    return this.assetsService.get(ctx, assetId);
  }

  @Patch(':assetId')
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
  @RequirePermissions('assets:read')
  async history(@CurrentWorkspace() ctx: WorkspaceContext, @Param('assetId') assetId: string) {
    return { events: await this.assetsService.history(ctx, assetId) };
  }
}
