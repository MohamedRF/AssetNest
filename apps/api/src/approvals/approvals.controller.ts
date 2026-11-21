import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
import type { ApprovalStatus } from '@assetnest/domain';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiSessionCsrf } from '../auth/openapi.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  createApprovalRequestSchema,
  decideApprovalSchema,
  setWorkflowRulesSchema,
  type CreateApprovalRequestInput,
  type DecideApprovalInput,
  type SetWorkflowRulesInput,
} from './dto.js';
import {
  approvalRequestListResponse,
  approvalRequestResponse,
  createApprovalRequestSchemaOut,
  decideApprovalRequestSchema,
  setWorkflowRulesRequestSchema,
  workflowRulesResponse,
} from './openapi.js';
import { ApprovalsService } from './approvals.service.js';

/**
 * Configurable approval workflows (P6-02). A workspace owner/admin defines
 * rules per guarded action; eligible members then approve or reject requests.
 * Enforcement lives in the domain services (asset dispose/retire), which call
 * `ApprovalsService.assertApproved` and `consume`.
 */
@ApiTags('Approvals')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/approvals', version: '1' })
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get('rules')
  @ApiOperation({ operationId: 'listApprovalRules', description: 'Requires approvals:read.' })
  @ApiOkResponse({ schema: workflowRulesResponse })
  @RequirePermissions('approvals:read')
  async listRules(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { rules: await this.approvalsService.listRules(ctx) };
  }

  @Put('rules')
  @ApiOperation({
    operationId: 'setApprovalRules',
    description: 'Requires approvals:manage and an owner/admin session.',
  })
  @ApiSessionCsrf({ bearerSupported: true })
  @ApiBody({ schema: openApiSchema(setWorkflowRulesRequestSchema, 'input') })
  @ApiOkResponse({ schema: workflowRulesResponse })
  @RequirePermissions('approvals:manage')
  async setRules(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(setWorkflowRulesSchema)) body: SetWorkflowRulesInput,
  ) {
    return { rules: await this.approvalsService.setRules(ctx, user.id, body.rules) };
  }

  @Get('requests')
  @ApiOperation({ operationId: 'listApprovalRequests', description: 'Requires approvals:read.' })
  @ApiQuery({ name: 'status', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'resourceId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ schema: approvalRequestListResponse })
  @RequirePermissions('approvals:read')
  async listRequests(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query('status') status?: string,
    @Query('resourceId', new ParseUUIDPipe({ optional: true })) resourceId?: string,
  ) {
    const allowed = ['pending', 'approved', 'rejected', 'cancelled', 'executed'];
    const filter = status && allowed.includes(status) ? (status as ApprovalStatus) : undefined;
    return { requests: await this.approvalsService.listRequests(ctx, filter, resourceId) };
  }

  @Post('requests')
  @ApiOperation({
    operationId: 'createApprovalRequest',
    description: 'Requires approvals:read. Creates a pending request for a guarded action.',
  })
  @ApiSessionCsrf({ bearerSupported: true })
  @ApiBody({ schema: openApiSchema(createApprovalRequestSchemaOut, 'input') })
  @ApiCreatedResponse({ schema: approvalRequestResponse })
  @RequirePermissions('approvals:read')
  @HttpCode(HttpStatus.CREATED)
  async createRequest(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createApprovalRequestSchema)) body: CreateApprovalRequestInput,
  ) {
    return this.approvalsService.createRequest(ctx, user.id, body);
  }

  @Post('requests/:requestId/decide')
  @ApiOperation({
    operationId: 'decideApprovalRequest',
    description: 'Requires approvals:manage and an eligible approver role.',
  })
  @ApiSessionCsrf({ bearerSupported: true })
  @ApiBody({ schema: openApiSchema(decideApprovalRequestSchema, 'input') })
  @ApiOkResponse({ schema: approvalRequestResponse })
  @RequirePermissions('approvals:manage')
  @HttpCode(HttpStatus.OK)
  async decide(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(new ZodValidationPipe(decideApprovalSchema)) body: DecideApprovalInput,
  ) {
    return this.approvalsService.decide(ctx, user.id, requestId, body);
  }

  @Post('requests/:requestId/cancel')
  @ApiOperation({
    operationId: 'cancelApprovalRequest',
    description: 'Requires approvals:read. Only the requester or a workspace owner/admin.',
  })
  @ApiSessionCsrf({ bearerSupported: true })
  @ApiOkResponse({ schema: approvalRequestResponse })
  @RequirePermissions('approvals:read')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.approvalsService.cancel(ctx, user.id, requestId);
  }
}
