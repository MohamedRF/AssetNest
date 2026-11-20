import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiProblemResponse } from '../common/openapi.js';
import { httpCode } from '../common/problem.js';
import { contentDispositionFilename } from './content-sniff.js';
import { DOCUMENT_KINDS, documentKindSchema } from './dto.js';
import { DocumentsService } from './documents.service.js';
import {
  documentDownloadContent,
  listDocumentsResponse,
  removeDocumentResponse,
  uploadDocumentBody,
  uploadDocumentResponse,
} from './openapi.js';

/** Private attachments: uploads validated by magic bytes, downloads always authorized. */
@ApiTags('Documents')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId', version: '1' })
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('assets/:assetId/documents')
  @ApiOperation({ operationId: 'uploadDocument', description: 'Requires documents:write.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: uploadDocumentBody })
  @ApiCreatedResponse({ schema: uploadDocumentResponse })
  @RequirePermissions('documents:write')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB cap
    }),
  )
  async upload(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('assetId') assetId: string,
    @Body('kind') kind: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file || file.size === 0) {
      throw httpCode(
        HttpStatus.BAD_REQUEST,
        'A non-empty file is required (multipart field "file")',
        'FILE_REQUIRED',
      );
    }
    const parsedKind = documentKindSchema.safeParse(kind);
    if (!parsedKind.success) {
      throw httpCode(
        HttpStatus.BAD_REQUEST,
        `Invalid kind. Allowed: ${DOCUMENT_KINDS.join(', ')}`,
        'VALIDATION_FAILED',
      );
    }
    return this.documentsService.upload(ctx, user.id, assetId, file, parsedKind.data);
  }

  @Get('assets/:assetId/documents')
  @ApiOperation({ operationId: 'listAssetDocuments', description: 'Requires documents:read.' })
  @ApiOkResponse({ schema: listDocumentsResponse })
  @RequirePermissions('documents:read')
  async listForAsset(@CurrentWorkspace() ctx: WorkspaceContext, @Param('assetId') assetId: string) {
    return { documents: await this.documentsService.listForAsset(ctx, assetId) };
  }

  @Get('documents/:documentId/download')
  @ApiOperation({ operationId: 'downloadDocument', description: 'Requires documents:read.' })
  @ApiOkResponse({
    description: 'Private attachment with a content type detected at upload.',
    headers: {
      'Content-Disposition': { schema: { type: 'string' } },
      'Content-Length': { schema: { type: 'integer', minimum: 0 } },
      'Cache-Control': { schema: { type: 'string' } },
    },
    content: documentDownloadContent,
  })
  @RequirePermissions('documents:read')
  async download(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const doc = await this.documentsService.downloadInfo(ctx, documentId);
    const { ascii, encoded } = contentDispositionFilename(doc.originalName);
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Length', String(doc.size));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
    this.documentsService.downloadStream(doc.objectKey).pipe(res);
  }

  @Delete('documents/:documentId')
  @ApiOperation({ operationId: 'removeDocument', description: 'Requires documents:write.' })
  @ApiOkResponse({ schema: removeDocumentResponse })
  @RequirePermissions('documents:write')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('documentId') documentId: string,
  ) {
    return this.documentsService.remove(ctx, user.id, documentId);
  }
}
