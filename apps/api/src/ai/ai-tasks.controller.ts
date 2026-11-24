import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { aiTaskSchema, taskOutputSchemas } from '@assetnest/ai';
import type { AgUiEvent } from '@assetnest/contracts';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { JsonLoggerService } from '../common/logging/json-logger.service.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AiFeatureGuard } from './ai-feature.guard.js';
import { AiTaskDraftsService } from './ai-task-drafts.service.js';
import { createAssetSchema } from '../assets/dto.js';

const routeKeySchema = z.string().trim().min(1).max(200);
const queryBody = z.strictObject({
  question: z.string().trim().min(1).max(2_000),
  consent: z.boolean(),
  routeKey: routeKeySchema.optional(),
});
const chatBody = queryBody.extend({ assetIds: z.array(z.uuid()).min(1).max(6) });
const chatStreamBody = chatBody.extend({ routeKey: routeKeySchema });
const maintenanceBody = queryBody.extend({ assetId: z.uuid() });
const documentBody = z.strictObject({ documentId: z.uuid(), consent: z.boolean() });
const previewParamSchema = aiTaskSchema;
const approveInvoiceSchema = z.strictObject({
  jobId: z.uuid(),
  assets: z.array(createAssetSchema).min(1).max(100),
});
const approveInvoiceResponse = z.object({
  approvalId: z.uuid(),
  assetIds: z.array(z.uuid()),
  assets: z.array(z.object({ id: z.uuid(), assetTag: z.string(), displayName: z.string() })),
  alreadyApproved: z.boolean(),
});
const invoiceDraftResponse = z.object({
  jobId: z.uuid(),
  draft: taskOutputSchemas.invoice_extraction,
});
const providerLegSchema = z.object({
  connectionName: z.string(),
  providerKind: z.string(),
  modelLabel: z.string(),
});
const aiRoutePreviewSchema = z.object({
  task: aiTaskSchema,
  available: z.boolean(),
  consentRequired: z.boolean(),
  routeKey: z.string(),
  primary: providerLegSchema.nullable(),
  fallback: providerLegSchema.nullable(),
});
const jobIdParamSchema = z.uuid();
const draftResponse = (draft: z.ZodType) => openApiSchema(z.object({ jobId: jobIdParamSchema, draft }));
const jobResponse = z.object({
  id: z.uuid(),
  task: aiTaskSchema,
  status: z.enum(['running', 'succeeded', 'failed']),
  sourceDocumentId: z.uuid().nullable(),
  inputTokens: z.int().nullable(),
  outputTokens: z.int().nullable(),
  errorCode: z.string().nullable(),
  durationMs: z.int().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});

@ApiTags('AI')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@UseGuards(AiFeatureGuard)
@RequirePermissions('ai:use', 'assets:read')
@Controller({ path: 'workspaces/:workspaceId/ai', version: '1' })
export class AiTasksController {
  private readonly logger = new JsonLoggerService(AiTasksController.name);

  constructor(@Inject(AiTaskDraftsService) private readonly drafts: AiTaskDraftsService) {}

  @Post('tasks/query')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'draftAiInventoryQuery' })
  @ApiBody({ schema: openApiSchema(queryBody, 'input') })
  @ApiOkResponse({ schema: draftResponse(taskOutputSchemas.natural_language_search) })
  query(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(queryBody)) body: z.output<typeof queryBody>,
  ) {
    return this.drafts.query(ctx, user.id, body.question, body.consent, body.routeKey);
  }

  @Post('tasks/chat')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'askAiAboutAssets' })
  @ApiBody({ schema: openApiSchema(chatBody, 'input') })
  @ApiOkResponse({ schema: draftResponse(taskOutputSchemas.asset_chat) })
  chat(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(chatBody)) body: z.output<typeof chatBody>,
  ) {
    return this.drafts.chat(ctx, user.id, body.question, body.assetIds, body.consent, body.routeKey);
  }

  /**
   * AG-UI streaming variant of {@link chat}. Streams the read-only asset chat
   * answer as server-sent events (`text/event-stream`); each `data:` frame is
   * one AG-UI event (RUN_STARTED, STEP_*, TEXT_MESSAGE_*, then RUN_FINISHED or
   * RUN_ERROR). Reuses the existing JSON chat's services, provider routing,
   * consent/budget/capability gating and output validation.
   *
   * The existing `POST .../tasks/chat` JSON contract is unchanged for current
   * callers; this is an additive pilot endpoint.
   */
  @Post('tasks/chat/stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'streamAiAssetChat',
    description:
      'Stream a read-only asset chat answer as an AG-UI server-sent event stream. Each `data:` frame is one ' +
      'JSON-encoded AG-UI event (RUN_STARTED, STEP_STARTED/STEP_FINISHED progress, TEXT_MESSAGE_* answer, then ' +
      'RUN_FINISHED, or RUN_ERROR on failure). Requires ai:use and assets:read; tenant/user identity is derived ' +
      'server-side from the session. The AssetNest request body requires the route key from the provider preview.',
  })
  @ApiBody({ schema: openApiSchema(chatStreamBody, 'input') })
  @ApiOkResponse({
    description: 'AG-UI event stream. Each SSE `data:` frame is one JSON-encoded AG-UI event.',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  async chatStream(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(chatStreamBody)) body: z.output<typeof chatStreamBody>,
    @Res() res: Response,
  ): Promise<void> {
    // Surface the stream as a normal HTTP error (problem+json) if a guard/pipe
    // rejects the request — those run before this handler and never open a stream.
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    // Disable proxy buffering (nginx) so progress reaches the browser promptly.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // A disconnect destroys the response. Check before advancing the generator
    // as well as after it yields so a closed stream cannot start another step.
    const canWrite = () => !res.destroyed && !res.writableEnded;
    const writeEvent = (event: AgUiEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    try {
      if (!canWrite()) return;
      const events = this.drafts.chatStream(
        ctx,
        user.id,
        body.question,
        body.assetIds,
        body.consent,
        body.routeKey,
      );
      for await (const event of events) {
        if (!canWrite()) return;
        writeEvent(event);
        if (!canWrite()) return;
      }
    } catch {
      if (!canWrite()) return;
      this.logger.error('Unexpected asset chat stream failure', { code: 'AI_STREAM_ERROR' });
      writeEvent({
        type: 'RUN_ERROR',
        message: 'The AI request could not be completed.',
        code: 'AI_STREAM_ERROR',
      });
    } finally {
      if (canWrite()) res.end();
    }
  }

  @Get('tasks/:task/preview')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'previewAiTaskRoute',
    description:
      'Describe the configured primary/fallback provider for a task so the UI can show what is shared before consenting.',
  })
  @ApiParam({ name: 'task', schema: openApiSchema(previewParamSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(aiRoutePreviewSchema) })
  preview(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('task', new ZodValidationPipe(previewParamSchema)) task: z.output<typeof previewParamSchema>,
  ) {
    return this.drafts.preview(ctx, task);
  }

  @Get('tasks/invoice-drafts/:jobId')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ai:use', 'assets:read', 'documents:read')
  @ApiOperation({
    operationId: 'getAiInvoiceDraft',
    description:
      'Retrieve a stored invoice draft for review. Requires ai:use, assets:read and documents:read.',
  })
  @ApiParam({ name: 'jobId', schema: openApiSchema(jobIdParamSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(invoiceDraftResponse) })
  getInvoiceDraft(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('jobId', new ZodValidationPipe(jobIdParamSchema)) jobId: string,
  ) {
    return this.drafts.getInvoiceDraft(ctx, jobId);
  }

  @Post('tasks/approve-invoice')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ai:use', 'assets:read', 'assets:write', 'documents:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'approveAiInvoice',
    description:
      'Approve a reviewed invoice draft, creating the proposed assets atomically with the approval and audit records. Requires a human session with ai:use and assets:write.',
  })
  @ApiBody({ schema: openApiSchema(approveInvoiceSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(approveInvoiceResponse) })
  approveInvoice(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(approveInvoiceSchema)) body: z.output<typeof approveInvoiceSchema>,
  ) {
    return this.drafts.approveInvoice(ctx, user.id, body.jobId, body.assets);
  }

  @Post('tasks/maintenance')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'askAiMaintenanceAssistant' })
  @ApiBody({ schema: openApiSchema(maintenanceBody, 'input') })
  @ApiOkResponse({ schema: draftResponse(taskOutputSchemas.maintenance_assistant) })
  maintenance(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(maintenanceBody)) body: z.output<typeof maintenanceBody>,
  ) {
    return this.drafts.maintenance(ctx, user.id, body.assetId, body.question, body.consent);
  }

  @Post('tasks/extract-invoice')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ai:use', 'documents:read', 'assets:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'draftAiInvoice' })
  @ApiBody({ schema: openApiSchema(documentBody, 'input') })
  @ApiOkResponse({ schema: draftResponse(taskOutputSchemas.invoice_extraction) })
  invoice(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(documentBody)) body: z.output<typeof documentBody>,
  ) {
    return this.drafts.invoice(ctx, user.id, body.documentId, body.consent);
  }

  @Post('tasks/asset-suggestions')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ai:use', 'documents:read', 'assets:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'draftAiPhotoSuggestions' })
  @ApiBody({ schema: openApiSchema(documentBody, 'input') })
  @ApiOkResponse({ schema: draftResponse(taskOutputSchemas.image_tagging) })
  photo(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(documentBody)) body: z.output<typeof documentBody>,
  ) {
    return this.drafts.photo(ctx, user.id, body.documentId, body.consent);
  }

  @Get('jobs/:jobId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getOwnAiJob' })
  @ApiOkResponse({ schema: openApiSchema(jobResponse) })
  getJob(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('jobId', new ZodValidationPipe(jobIdParamSchema)) id: string,
  ) {
    return this.drafts.getOwnJob(ctx, user.id, id);
  }
}
