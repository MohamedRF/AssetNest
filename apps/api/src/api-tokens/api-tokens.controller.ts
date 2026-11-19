import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ApiTokensService } from './api-tokens.service.js';
import { createTokenSchema, type CreateTokenInput } from './dto.js';

@Controller({ path: 'workspaces/:workspaceId/api-tokens', version: '1' })
@RequirePermissions('integrations:manage')
export class ApiTokensController {
  constructor(private readonly apiTokensService: ApiTokensService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createTokenSchema)) body: CreateTokenInput,
  ) {
    return this.apiTokensService.create(ctx, user.id, body);
  }

  @Get()
  async list(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { tokens: await this.apiTokensService.list(ctx) };
  }

  @Delete(':tokenId')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('tokenId') tokenId: string,
  ) {
    return this.apiTokensService.revoke(ctx, user.id, tokenId);
  }

  @Post(':tokenId/rotate')
  @HttpCode(HttpStatus.OK)
  async rotate(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('tokenId') tokenId: string,
  ) {
    return this.apiTokensService.rotate(ctx, user.id, tokenId);
  }
}
