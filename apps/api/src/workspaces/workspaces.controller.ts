import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AppConfig } from '@assetnest/config';
import { APP_CONFIG } from '../common/tokens.js';
import { Public } from '../common/public.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';
import { sessionCookieOptions } from '../auth/session-cookie.js';
import {
  acceptInviteSchema,
  changeRoleSchema,
  createInviteSchema,
  createWorkspaceSchema,
  updateWorkspaceSchema,
  type AcceptInviteInput,
  type ChangeRoleInput,
  type CreateInviteInput,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
} from './dto.js';
import { WorkspacesService } from './workspaces.service.js';

@Controller({ path: 'workspaces', version: '1' })
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  async listMine(@CurrentUser() user: PublicUser) {
    return { workspaces: await this.workspacesService.listMine(user.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
  ) {
    const created = await this.workspacesService.create(body, user.id);
    return { ...created, role: 'owner' as const };
  }

  @Get(':workspaceId')
  async get(@CurrentWorkspace() ctx: WorkspaceContext) {
    return this.workspacesService.get(ctx);
  }

  @Patch(':workspaceId')
  @RequirePermissions('workspace:manage')
  async update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput,
  ) {
    return this.workspacesService.update(ctx, user.id, body);
  }

  @Get(':workspaceId/members')
  async listMembers(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { members: await this.workspacesService.listMembers(ctx) };
  }

  @Get(':workspaceId/audit-log')
  @RequirePermissions('workspace:manage')
  async auditLog(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const parsedLimit = Number.parseInt(limit, 10) || 50;
    const parsedOffset = Number.parseInt(offset, 10) || 0;
    return { entries: await this.workspacesService.listAuditLog(ctx, parsedLimit, parsedOffset) };
  }

  @Post(':workspaceId/invites')
  @RequirePermissions('workspace:manage')
  @HttpCode(HttpStatus.CREATED)
  async createInvite(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createInviteSchema)) body: CreateInviteInput,
  ) {
    return this.workspacesService.createInvite(ctx, user.id, body);
  }

  @Get(':workspaceId/invites')
  @RequirePermissions('workspace:manage')
  async listInvites(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { invites: await this.workspacesService.listInvites(ctx) };
  }

  @Delete(':workspaceId/invites/:inviteId')
  @RequirePermissions('workspace:manage')
  @HttpCode(HttpStatus.OK)
  async revokeInvite(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('inviteId') inviteId: string,
  ) {
    return this.workspacesService.revokeInvite(ctx, user.id, inviteId);
  }

  @Post(':workspaceId/members/:userId/role')
  @RequirePermissions('workspace:manage')
  @HttpCode(HttpStatus.OK)
  async changeRole(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: ChangeRoleInput,
  ) {
    return this.workspacesService.changeRole(ctx, user.id, userId, body);
  }

  @Delete(':workspaceId/members/:userId')
  @RequirePermissions('workspace:manage')
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('userId') userId: string,
  ) {
    return this.workspacesService.removeMember(ctx, user.id, userId);
  }
}

/** Invite acceptance lives at the auth boundary (@Public, sets a session cookie). */
@Controller({ path: 'auth', version: '1' })
export class InviteAcceptController {
  constructor(
    private readonly workspacesService: WorkspacesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('invites/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.workspacesService.acceptInvite(body.token, body.displayName, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.cookie(SESSION_COOKIE, result.sessionToken, sessionCookieOptions(this.config));
    return { user: result.user, workspaces: result.workspaces, csrfToken: result.csrfToken };
  }
}
