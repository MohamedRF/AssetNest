import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { aiTaskSchema, type AITask } from '@assetnest/ai';
import type { PublicUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { aiAuditActorId } from './ai-actor.js';
import { AiFeatureGuard } from './ai-feature.guard.js';
import { AiRoutesService } from './ai-routes.service.js';
import {
  aiRouteResponseSchema,
  listAiRoutesResponseSchema,
  upsertAiRouteSchema,
  type UpsertAiRouteInput,
} from './ai-settings.dto.js';

@ApiTags('AI')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@RequirePermissions('ai:configure')
@UseGuards(AiFeatureGuard)
@Controller({ path: 'workspaces/:workspaceId/ai/routes', version: '1' })
export class AiRoutesController {
  constructor(@Inject(AiRoutesService) private readonly service: AiRoutesService) {}

  @Get()
  @ApiOperation({ operationId: 'listAiRoutes' })
  @ApiOkResponse({ schema: openApiSchema(listAiRoutesResponseSchema) })
  async list(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { routes: await this.service.list(ctx) };
  }

  @Put(':task')
  @ApiOperation({ operationId: 'upsertAiRoute' })
  @ApiParam({ name: 'task', schema: openApiSchema(aiTaskSchema, 'input') })
  @ApiBody({ schema: openApiSchema(upsertAiRouteSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(aiRouteResponseSchema) })
  upsert(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('task', new ZodValidationPipe(aiTaskSchema)) task: AITask,
    @Body(new ZodValidationPipe(upsertAiRouteSchema)) body: UpsertAiRouteInput,
  ) {
    return this.service.upsert(ctx, aiAuditActorId(user), task, body);
  }

  @Delete(':task')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteAiRoute' })
  @ApiParam({ name: 'task', schema: openApiSchema(aiTaskSchema, 'input') })
  @ApiNoContentResponse({ description: 'AI task route cleared' })
  remove(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('task', new ZodValidationPipe(aiTaskSchema)) task: AITask,
  ) {
    return this.service.remove(ctx, aiAuditActorId(user), task);
  }
}
