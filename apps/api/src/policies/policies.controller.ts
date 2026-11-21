import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiSessionCsrf } from '../auth/openapi.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  auditRetentionSchema,
  exportPolicySchema,
  type AuditRetentionInput,
  type ExportPolicyInput,
} from './dto.js';
import { PoliciesService } from './policies.service.js';
import {
  auditPruneResponse,
  auditRetentionRequestSchema,
  exportPolicyRequestSchema,
  workspacePoliciesResponse,
} from './openapi.js';

/**
 * Workspace-scoped policy administration (P6-01).
 *
 * Fine-grained permissions: reading policies needs `workspace:manage`; changing
 * audit retention needs `audit:manage`; changing the export policy needs
 * `exports:manage`; pruning needs `audit:manage`. Session or API-token callers
 * are both accepted (tokens must carry the scope).
 */
@ApiTags('Workspace policies')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/policies', version: '1' })
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Get()
  @ApiOperation({
    operationId: 'getWorkspacePolicies',
    description: 'Requires workspace:manage. Returns audit-retention and export policy.',
  })
  @ApiOkResponse({ schema: workspacePoliciesResponse })
  @RequirePermissions('workspace:manage')
  async get(@CurrentWorkspace() ctx: WorkspaceContext) {
    return this.policiesService.get(ctx);
  }

  @Put('audit-retention')
  @ApiOperation({
    operationId: 'setWorkspaceAuditRetention',
    description:
      'Requires audit:manage. retentionDays=null retains forever; a finite value prunes older rows when pruning runs.',
  })
  @ApiSecurity('bearer')
  @ApiSessionCsrf({ bearerSupported: true })
  @ApiBody({ schema: openApiSchema(auditRetentionRequestSchema, 'input') })
  @ApiOkResponse({ schema: workspacePoliciesResponse })
  @RequirePermissions('audit:manage')
  async setAuditRetention(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(auditRetentionSchema)) body: AuditRetentionInput,
  ) {
    return this.policiesService.setAuditRetention(ctx, user.id, body);
  }

  @Put('export-policy')
  @ApiOperation({
    operationId: 'setWorkspaceExportPolicy',
    description:
      'Requires exports:manage. Disabling blocks create/list/download; maxAgeDays expires previously generated files.',
  })
  @ApiSecurity('bearer')
  @ApiSessionCsrf({ bearerSupported: true })
  @ApiBody({ schema: openApiSchema(exportPolicyRequestSchema, 'input') })
  @ApiOkResponse({ schema: workspacePoliciesResponse })
  @RequirePermissions('exports:manage')
  async setExportPolicy(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(exportPolicySchema)) body: ExportPolicyInput,
  ) {
    return this.policiesService.setExportPolicy(ctx, user.id, body);
  }

  @Post('audit-retention/prune')
  @ApiOperation({
    operationId: 'pruneWorkspaceAuditLog',
    description:
      'Requires audit:manage. Deletes this workspace’s audit rows older than its retention cutoff. A no-op when retention is indefinite.',
  })
  @ApiSecurity('bearer')
  @ApiSessionCsrf({ bearerSupported: true })
  @ApiOkResponse({ schema: auditPruneResponse })
  @RequirePermissions('audit:manage')
  @HttpCode(HttpStatus.OK)
  async prune(@CurrentWorkspace() ctx: WorkspaceContext, @CurrentUser() user: PublicUser) {
    return this.policiesService.pruneAuditLog(ctx, user.id);
  }
}
