import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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
import { aiAuditActorId } from './ai-actor.js';
import { AiConnectionDiagnosticsService } from './ai-connection-diagnostics.service.js';
import { AiConnectionsService } from './ai-connections.service.js';
import { AiFeatureGuard } from './ai-feature.guard.js';
import {
  aiConnectionResponseSchema,
  connectionIdSchema,
  createAiConnectionSchema,
  listAiConnectionsResponseSchema,
  testAiConnectionResponseSchema,
  updateAiConnectionSchema,
  type CreateAiConnectionInput,
  type UpdateAiConnectionInput,
} from './dto.js';

@ApiTags('AI')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@UseGuards(AiFeatureGuard)
@RequirePermissions('ai:configure')
@Controller({ path: 'workspaces/:workspaceId/ai/connections', version: '1' })
export class AiConnectionsController {
  constructor(
    @Inject(AiConnectionsService) private readonly service: AiConnectionsService,
    @Inject(AiConnectionDiagnosticsService) private readonly diagnostics: AiConnectionDiagnosticsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiSecurity('bearer')
  @ApiOperation({ operationId: 'listAiConnections' })
  @ApiOkResponse({ schema: openApiSchema(listAiConnectionsResponseSchema) })
  async list(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { connections: await this.service.list(ctx) };
  }

  @Post()
  @ApiSecurity('bearer')
  @ApiOperation({ operationId: 'createAiConnection' })
  @ApiBody({ schema: openApiSchema(createAiConnectionSchema, 'input') })
  @ApiCreatedResponse({ schema: openApiSchema(aiConnectionResponseSchema) })
  create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createAiConnectionSchema)) body: CreateAiConnectionInput,
  ) {
    return this.service.create(ctx, aiAuditActorId(user), body);
  }

  @Patch(':connectionId')
  @ApiSecurity('bearer')
  @ApiOperation({ operationId: 'updateAiConnection' })
  @ApiParam({ name: 'connectionId', schema: openApiSchema(connectionIdSchema, 'input') })
  @ApiBody({ schema: openApiSchema(updateAiConnectionSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(aiConnectionResponseSchema) })
  update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('connectionId', new ZodValidationPipe(connectionIdSchema)) connectionId: string,
    @Body(new ZodValidationPipe(updateAiConnectionSchema)) body: UpdateAiConnectionInput,
  ) {
    return this.service.update(ctx, aiAuditActorId(user), connectionId, body);
  }

  @Delete(':connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSecurity('bearer')
  @ApiOperation({ operationId: 'deleteAiConnection' })
  @ApiParam({ name: 'connectionId', schema: openApiSchema(connectionIdSchema, 'input') })
  @ApiNoContentResponse({ description: 'AI connection deleted' })
  remove(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('connectionId', new ZodValidationPipe(connectionIdSchema)) connectionId: string,
  ) {
    return this.service.remove(ctx, aiAuditActorId(user), connectionId);
  }

  @Post(':connectionId/test')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'testAiConnection',
    description: 'List models from the configured provider. Requires a workspace administrator session.',
  })
  @ApiParam({ name: 'connectionId', schema: openApiSchema(connectionIdSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(testAiConnectionResponseSchema) })
  test(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('connectionId', new ZodValidationPipe(connectionIdSchema)) connectionId: string,
  ) {
    return this.diagnostics.test(ctx, user.id, connectionId);
  }
}
