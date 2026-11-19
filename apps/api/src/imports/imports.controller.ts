import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ImportsService } from './imports.service.js';
import { previewImportSchema, runImportSchema, type PreviewImportInput, type RunImportInput } from './dto.js';

@Controller({ path: 'workspaces/:workspaceId/imports', version: '1' })
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('preview')
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.OK)
  preview(@Body(new ZodValidationPipe(previewImportSchema)) body: PreviewImportInput) {
    return this.importsService.preview(body);
  }

  @Post()
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.OK)
  run(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(runImportSchema)) body: RunImportInput,
  ) {
    return this.importsService.run(ctx, user.id, body);
  }
}
