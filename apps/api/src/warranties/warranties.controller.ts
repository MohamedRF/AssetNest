import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
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
import { listWarrantiesResponse, warrantyResponse } from './openapi.js';

@ApiTags('Warranties')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/warranties', version: '1' })
export class WarrantiesController {
  constructor(private readonly warrantiesService: WarrantiesService) {}

  @Get()
  @ApiOperation({ operationId: 'listWarranties' })
  @ApiQuery({
    name: 'expiringDays',
    description: 'Include warranties expiring within this many days and those already expired',
    required: false,
    schema: openApiSchema(listWarrantiesQuerySchema.shape.expiringDays, 'input'),
  })
  @ApiOkResponse({ schema: listWarrantiesResponse })
  @RequirePermissions('assets:read')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodValidationPipe(listWarrantiesQuerySchema)) query: ListWarrantiesQuery,
  ) {
    return { warranties: await this.warrantiesService.list(ctx, query) };
  }

  @Post()
  @ApiOperation({ operationId: 'createWarranty' })
  @ApiBody({ schema: openApiSchema(createWarrantySchema, 'input') })
  @ApiCreatedResponse({ schema: warrantyResponse })
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
  @ApiOperation({ operationId: 'updateWarranty' })
  @ApiBody({ schema: openApiSchema(updateWarrantySchema, 'input') })
  @ApiOkResponse({ schema: warrantyResponse })
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
