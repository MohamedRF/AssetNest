import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
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
import { WebhooksService } from './webhooks.service.js';
import {
  createWebhookSchema,
  updateWebhookSchema,
  type CreateWebhookInput,
  type UpdateWebhookInput,
} from './dto.js';
import {
  createWebhookResponse,
  listWebhookDeliveriesResponse,
  listWebhooksResponse,
  removeWebhookResponse,
  retryWebhookDeliveriesResponse,
  testWebhookResponse,
  updateWebhookResponse,
} from './openapi.js';

@ApiTags('Webhooks')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/webhooks', version: '1' })
@RequirePermissions('integrations:manage')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({ operationId: 'createWebhook', description: 'Requires integrations:manage.' })
  @ApiBody({ schema: openApiSchema(createWebhookSchema, 'input') })
  @ApiCreatedResponse({ schema: createWebhookResponse })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createWebhookSchema)) body: CreateWebhookInput,
  ) {
    return this.webhooksService.create(ctx, user.id, body);
  }

  @Get()
  @ApiOperation({ operationId: 'listWebhooks', description: 'Requires integrations:manage.' })
  @ApiOkResponse({ schema: listWebhooksResponse })
  async list(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { webhooks: await this.webhooksService.list(ctx) };
  }

  @Patch(':webhookId')
  @ApiOperation({ operationId: 'updateWebhook', description: 'Requires integrations:manage.' })
  @ApiBody({ schema: openApiSchema(updateWebhookSchema, 'input') })
  @ApiOkResponse({ schema: updateWebhookResponse })
  async update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('webhookId') webhookId: string,
    @Body(new ZodValidationPipe(updateWebhookSchema)) body: UpdateWebhookInput,
  ) {
    return this.webhooksService.update(ctx, user.id, webhookId, body);
  }

  @Delete(':webhookId')
  @ApiOperation({ operationId: 'removeWebhook', description: 'Requires integrations:manage.' })
  @ApiOkResponse({ schema: removeWebhookResponse })
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('webhookId') webhookId: string,
  ) {
    return this.webhooksService.remove(ctx, user.id, webhookId);
  }

  @Post(':webhookId/test')
  @ApiOperation({ operationId: 'testWebhook', description: 'Requires integrations:manage.' })
  @ApiOkResponse({ schema: testWebhookResponse })
  @HttpCode(HttpStatus.OK)
  async test(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('webhookId') webhookId: string,
  ) {
    return this.webhooksService.test(ctx, user.id, webhookId);
  }

  @Post(':webhookId/retry-failed')
  @ApiOperation({ operationId: 'retryWebhookDeliveries', description: 'Requires integrations:manage.' })
  @ApiOkResponse({ schema: retryWebhookDeliveriesResponse })
  @HttpCode(HttpStatus.OK)
  async retryFailed(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('webhookId') webhookId: string,
  ) {
    return this.webhooksService.retryFailed(ctx, user.id, webhookId);
  }

  @Get(':webhookId/deliveries')
  @ApiOperation({ operationId: 'listWebhookDeliveries', description: 'Requires integrations:manage.' })
  @ApiOkResponse({ schema: listWebhookDeliveriesResponse })
  async deliveries(@CurrentWorkspace() ctx: WorkspaceContext, @Param('webhookId') webhookId: string) {
    return { deliveries: await this.webhooksService.deliveries(ctx, webhookId) };
  }
}
