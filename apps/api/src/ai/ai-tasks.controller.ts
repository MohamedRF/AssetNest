import { Body, Controller, Get, Header, HttpCode, HttpStatus, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { aiTaskSchema, taskOutputSchemas } from '@assetnest/ai';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AiFeatureGuard } from './ai-feature.guard.js';
import { AiTaskDraftsService } from './ai-task-drafts.service.js';

const queryBody = z.strictObject({ question: z.string().trim().min(1).max(2_000), consent: z.boolean() });
const chatBody = queryBody.extend({ assetIds: z.array(z.uuid()).min(1).max(6) });
const documentBody = z.strictObject({ documentId: z.uuid(), consent: z.boolean() });
const jobIdParamSchema = z.uuid();
const draftResponse = (draft: z.ZodType) => openApiSchema(z.object({ jobId: jobIdParamSchema, draft }));
const jobResponse = z.object({
  id: z.uuid(), task: aiTaskSchema, status: z.enum(['running', 'succeeded', 'failed']),
  sourceDocumentId: z.uuid().nullable(), inputTokens: z.int().nullable(), outputTokens: z.int().nullable(),
  errorCode: z.string().nullable(), durationMs: z.int().nullable(),
  createdAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
});

@ApiTags('AI')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@UseGuards(AiFeatureGuard)
@RequirePermissions('ai:use', 'assets:read')
@Controller({ path: 'workspaces/:workspaceId/ai', version: '1' })
export class AiTasksController {
  constructor(@Inject(AiTaskDraftsService) private readonly drafts: AiTaskDraftsService) {}

  @Post('tasks/query')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'draftAiInventoryQuery' })
  @ApiBody({ schema: openApiSchema(queryBody, 'input') })
  @ApiOkResponse({ schema: draftResponse(taskOutputSchemas.natural_language_search) })
  query(
    @CurrentWorkspace() ctx: WorkspaceContext, @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(queryBody)) body: z.output<typeof queryBody>,
  ) {
    return this.drafts.query(ctx, user.id, body.question, body.consent);
  }

  @Post('tasks/chat')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'askAiAboutAssets' })
  @ApiBody({ schema: openApiSchema(chatBody, 'input') })
  @ApiOkResponse({ schema: draftResponse(taskOutputSchemas.asset_chat) })
  chat(
    @CurrentWorkspace() ctx: WorkspaceContext, @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(chatBody)) body: z.output<typeof chatBody>,
  ) {
    return this.drafts.chat(ctx, user.id, body.question, body.assetIds, body.consent);
  }

  @Post('tasks/extract-invoice')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ai:use', 'documents:read', 'assets:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'draftAiInvoice' })
  @ApiBody({ schema: openApiSchema(documentBody, 'input') })
  @ApiOkResponse({ schema: draftResponse(taskOutputSchemas.invoice_extraction) })
  invoice(
    @CurrentWorkspace() ctx: WorkspaceContext, @CurrentUser() user: PublicUser,
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
    @CurrentWorkspace() ctx: WorkspaceContext, @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(documentBody)) body: z.output<typeof documentBody>,
  ) {
    return this.drafts.photo(ctx, user.id, body.documentId, body.consent);
  }

  @Get('jobs/:jobId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getOwnAiJob' })
  @ApiOkResponse({ schema: openApiSchema(jobResponse) })
  getJob(
    @CurrentWorkspace() ctx: WorkspaceContext, @CurrentUser() user: PublicUser,
    @Param('jobId', new ZodValidationPipe(jobIdParamSchema)) id: string,
  ) {
    return this.drafts.getOwnJob(ctx, user.id, id);
  }
}
