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
import { MaintenanceService } from './maintenance.service.js';
import {
  createPlanSchema,
  createRecordSchema,
  listRecordsQuerySchema,
  updatePlanSchema,
  type CreatePlanInput,
  type CreateRecordInput,
  type ListRecordsQuery,
  type UpdatePlanInput,
} from './dto.js';
import {
  listMaintenancePlansResponse,
  listMaintenanceRecordsResponse,
  maintenancePlanResponse,
  maintenanceRecordResponse,
} from './openapi.js';

@ApiTags('Maintenance')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/maintenance', version: '1' })
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get('plans')
  @ApiOperation({ operationId: 'listMaintenancePlans' })
  @ApiOkResponse({ schema: listMaintenancePlansResponse })
  @RequirePermissions('assets:read')
  async listPlans(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { plans: await this.maintenanceService.listPlans(ctx) };
  }

  @Post('plans')
  @ApiOperation({ operationId: 'createMaintenancePlan' })
  @ApiBody({ schema: openApiSchema(createPlanSchema, 'input') })
  @ApiCreatedResponse({ schema: maintenancePlanResponse })
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.CREATED)
  async createPlan(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createPlanSchema)) body: CreatePlanInput,
  ) {
    return this.maintenanceService.createPlan(ctx, user.id, body);
  }

  @Patch('plans/:planId')
  @ApiOperation({ operationId: 'updateMaintenancePlan' })
  @ApiBody({ schema: openApiSchema(updatePlanSchema, 'input') })
  @ApiOkResponse({ schema: maintenancePlanResponse })
  @RequirePermissions('assets:write')
  async updatePlan(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) body: UpdatePlanInput,
  ) {
    return this.maintenanceService.updatePlan(ctx, user.id, planId, body);
  }

  @Get('records')
  @ApiOperation({ operationId: 'listMaintenanceRecords' })
  @ApiQuery({
    name: 'assetId',
    required: false,
    schema: openApiSchema(listRecordsQuerySchema.shape.assetId, 'input'),
  })
  @ApiOkResponse({ schema: listMaintenanceRecordsResponse })
  @RequirePermissions('assets:read')
  async listRecords(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodValidationPipe(listRecordsQuerySchema)) query: ListRecordsQuery,
  ) {
    return { records: await this.maintenanceService.listRecords(ctx, query) };
  }

  @Post('records')
  @ApiOperation({ operationId: 'createMaintenanceRecord' })
  @ApiBody({ schema: openApiSchema(createRecordSchema, 'input') })
  @ApiCreatedResponse({ schema: maintenanceRecordResponse })
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.CREATED)
  async createRecord(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createRecordSchema)) body: CreateRecordInput,
  ) {
    return this.maintenanceService.createRecord(ctx, user.id, body);
  }
}
