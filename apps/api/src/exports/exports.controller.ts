import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ExportsService } from './exports.service.js';
import { createExportSchema, type CreateExportInput } from './dto.js';
import { createExportResponse, listExportsResponse } from './openapi.js';

@ApiTags('Exports')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/exports', version: '1' })
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get()
  @ApiOperation({ operationId: 'listExports', description: 'Requires reports:read.' })
  @ApiOkResponse({ schema: listExportsResponse })
  @RequirePermissions('reports:read')
  async list(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { exports: await this.exportsService.listAll(ctx) };
  }

  @Post()
  @ApiOperation({ operationId: 'createExport', description: 'Requires reports:read.' })
  @ApiBody({ schema: openApiSchema(createExportSchema, 'input') })
  @ApiCreatedResponse({ schema: createExportResponse })
  @RequirePermissions('reports:read')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createExportSchema)) body: CreateExportInput,
  ) {
    return this.exportsService.generate(ctx, user.id, body.report);
  }

  @Get(':exportId/download')
  @ApiOperation({ operationId: 'downloadExport', description: 'Requires reports:read.' })
  @ApiOkResponse({
    description: 'CSV report as a private attachment.',
    headers: {
      'Content-Disposition': { schema: { type: 'string' } },
      'Content-Length': { schema: { type: 'integer', minimum: 0 } },
      'Cache-Control': { schema: { type: 'string' } },
    },
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  @RequirePermissions('reports:read')
  async download(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('exportId') exportId: string,
    @Res() res: Response,
  ) {
    const { row, filePath, size } = await this.exportsService.getForDownload(ctx, exportId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${row.report}-export.csv"`);
    createReadStream(filePath).pipe(res);
  }
}
