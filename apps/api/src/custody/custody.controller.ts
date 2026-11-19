import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CustodyService } from './custody.service.js';
import {
  assignSchema,
  returnSchema,
  transferSchema,
  type AssignInput,
  type ReturnInput,
  type TransferInput,
} from './dto.js';

@Controller({ path: 'workspaces/:workspaceId', version: '1' })
export class CustodyController {
  constructor(private readonly custodyService: CustodyService) {}

  @Get('custody')
  @RequirePermissions('assets:read')
  async listActive(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { assignments: await this.custodyService.listActive(ctx) };
  }

  @Post('assets/:assetId/assign')
  @RequirePermissions('assets:assign')
  @HttpCode(HttpStatus.OK)
  async assign(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(assignSchema)) body: AssignInput,
  ) {
    return this.custodyService.assign(ctx, user.id, assetId, body);
  }

  @Post('assets/:assetId/return')
  @RequirePermissions('assets:assign')
  @HttpCode(HttpStatus.OK)
  async returnAsset(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(returnSchema)) body: ReturnInput,
  ) {
    return this.custodyService.returnAsset(ctx, user.id, assetId, body);
  }

  @Post('assets/:assetId/transfer')
  @RequirePermissions('assets:assign')
  @HttpCode(HttpStatus.OK)
  async transfer(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(transferSchema)) body: TransferInput,
  ) {
    return this.custodyService.transfer(ctx, user.id, assetId, body);
  }
}
