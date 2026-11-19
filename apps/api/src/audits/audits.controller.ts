import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AuditsService } from './audits.service.js';
import {
  closeAuditSchema,
  createAuditSchema,
  verifyItemSchema,
  type CloseAuditInput,
  type CreateAuditInput,
  type VerifyItemInput,
} from './dto.js';

@Controller({ path: 'workspaces/:workspaceId/audits', version: '1' })
export class AuditsController {
  constructor(private readonly auditsService: AuditsService) {}

  @Get()
  @RequirePermissions('audits:manage')
  async list(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { audits: await this.auditsService.list(ctx) };
  }

  @Post()
  @RequirePermissions('audits:manage')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createAuditSchema)) body: CreateAuditInput,
  ) {
    return this.auditsService.create(ctx, user.id, body);
  }

  @Get(':auditId')
  @RequirePermissions('audits:manage')
  async get(@CurrentWorkspace() ctx: WorkspaceContext, @Param('auditId') auditId: string) {
    return this.auditsService.get(ctx, auditId);
  }

  @Post(':auditId/verify')
  @RequirePermissions('audits:manage')
  @HttpCode(HttpStatus.OK)
  async verify(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('auditId') auditId: string,
    @Body(new ZodValidationPipe(verifyItemSchema)) body: VerifyItemInput,
  ) {
    return this.auditsService.verify(ctx, user.id, auditId, body);
  }

  @Post(':auditId/close')
  @RequirePermissions('audits:manage')
  @HttpCode(HttpStatus.OK)
  async close(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('auditId') auditId: string,
    @Body(new ZodValidationPipe(closeAuditSchema)) body: CloseAuditInput,
  ) {
    return this.auditsService.close(ctx, user.id, auditId, body);
  }
}
