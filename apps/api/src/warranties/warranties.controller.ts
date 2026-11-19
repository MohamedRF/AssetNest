import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { WarrantiesService } from './warranties.service.js';
import {
  createWarrantySchema,
  listWarrantiesQuerySchema,
  updateWarrantySchema,
  type CreateWarrantyInput,
  type ListWarrantiesQuery,
  type UpdateWarrantyInput,
} from './dto.js';

@Controller({ path: 'workspaces/:workspaceId/warranties', version: '1' })
export class WarrantiesController {
  constructor(private readonly warrantiesService: WarrantiesService) {}

  @Get()
  @RequirePermissions('assets:read')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodValidationPipe(listWarrantiesQuerySchema)) query: ListWarrantiesQuery,
  ) {
    return { warranties: await this.warrantiesService.list(ctx, query) };
  }

  @Post()
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createWarrantySchema)) body: CreateWarrantyInput,
  ) {
    return this.warrantiesService.create(ctx, user.id, body);
  }

  @Patch(':warrantyId')
  @RequirePermissions('assets:write')
  async update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('warrantyId') warrantyId: string,
    @Body(new ZodValidationPipe(updateWarrantySchema)) body: UpdateWarrantyInput,
  ) {
    return this.warrantiesService.update(ctx, user.id, warrantyId, body);
  }
}
