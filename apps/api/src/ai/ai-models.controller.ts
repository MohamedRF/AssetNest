import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { PublicUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { aiAuditActorId } from './ai-actor.js';
import { AiFeatureGuard } from './ai-feature.guard.js';
import { AiModelsService } from './ai-models.service.js';
import {
  aiModelResponseSchema,
  createAiModelSchema,
  listAiModelsResponseSchema,
  modelIdParamSchema,
  testAiModelSchema,
  type CreateAiModelInput,
  type TestAiModelInput,
} from './ai-settings.dto.js';

@ApiTags('AI')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@UseGuards(AiFeatureGuard)
@RequirePermissions('ai:configure')
@Controller({ path: 'workspaces/:workspaceId/ai/models', version: '1' })
export class AiModelsController {
  constructor(@Inject(AiModelsService) private readonly service: AiModelsService) {}

  @Get()
  @ApiSecurity('bearer')
  @ApiOperation({ operationId: 'listAiModels' })
  @ApiOkResponse({ schema: openApiSchema(listAiModelsResponseSchema) })
  async list(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { models: await this.service.list(ctx) };
  }

  @Post()
  @ApiSecurity('bearer')
  @ApiOperation({ operationId: 'createAiModel' })
  @ApiBody({ schema: openApiSchema(createAiModelSchema, 'input') })
  @ApiCreatedResponse({ schema: openApiSchema(aiModelResponseSchema) })
  create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createAiModelSchema)) body: CreateAiModelInput,
  ) {
    return this.service.create(ctx, aiAuditActorId(user), body);
  }

  @Post(':modelId/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'testAiModel',
    description:
      'Verify model capabilities with synthetic samples. Requires a workspace administrator session.',
  })
  @ApiParam({ name: 'modelId', schema: openApiSchema(modelIdParamSchema, 'input') })
  @ApiBody({ required: false, schema: openApiSchema(testAiModelSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(aiModelResponseSchema) })
  test(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('modelId', new ZodValidationPipe(modelIdParamSchema)) modelId: string,
    @Body(new ZodValidationPipe(testAiModelSchema)) body: TestAiModelInput,
  ) {
    return this.service.test(ctx, user.id, modelId, body);
  }
}
