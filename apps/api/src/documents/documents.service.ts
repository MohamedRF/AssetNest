import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { assets, documents } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import { LocalStorage, sha256Hex } from './storage.js';
import { declaredMatchesSniffed, sniffMime } from './content-sniff.js';
import type { DocumentKind } from './dto.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';

export interface UploadedFileInput {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LocalStorage) private readonly storage: LocalStorage,
  ) {}

  private async ensureAsset(ctx: WorkspaceContext, assetId: string) {
    const [asset] = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)))
      .limit(1);
    if (!asset) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Asset not found', 'ASSET_NOT_FOUND');
    }
    return asset;
  }

  async upload(
    ctx: WorkspaceContext,
    actorId: string,
    assetId: string,
    file: UploadedFileInput,
    kind: DocumentKind,
  ) {
    await this.ensureAsset(ctx, assetId);

    const sniffed = sniffMime(file.buffer);
    if (!sniffed || !declaredMatchesSniffed(file.mimetype, sniffed)) {
      throw httpCode(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        `File content does not match an allowed type (detected: ${sniffed ?? 'unknown'}). Allowed: PDF, PNG, JPEG, WebP, plain text.`,
        'UNSUPPORTED_FILE_TYPE',
      );
    }

    const objectKey = this.storage.buildObjectKey(ctx.workspaceId, assetId, sniffed);
    const checksum = sha256Hex(file.buffer);
    await this.storage.put(objectKey, file.buffer);

    const [created] = await this.db
      .insert(documents)
      .values({
        workspaceId: ctx.workspaceId,
        assetId,
        kind,
        originalName: file.originalname.slice(0, 255),
        objectKey,
        mime: sniffed,
        size: file.size,
        checksum,
        uploadedBy: actorId,
      })
      .returning({
        id: documents.id,
        assetId: documents.assetId,
        kind: documents.kind,
        originalName: documents.originalName,
        mime: documents.mime,
        size: documents.size,
        checksum: documents.checksum,
        uploadedBy: documents.uploadedBy,
        createdAt: documents.createdAt,
      });
    if (!created) {
      // Roll back the blob to avoid orphans.
      await this.storage.remove(objectKey);
      throw httpCode(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not record the document', 'DOCUMENT_FAILED');
    }

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'document.uploaded',
      resource: 'document',
      resourceId: created.id,
      metadata: { assetId, kind, size: created.size, mime: created.mime },
    });
    return created;
  }

  async listForAsset(ctx: WorkspaceContext, assetId: string) {
    await this.ensureAsset(ctx, assetId);
    return this.db
      .select({
        id: documents.id,
        assetId: documents.assetId,
        kind: documents.kind,
        originalName: documents.originalName,
        mime: documents.mime,
        size: documents.size,
        checksum: documents.checksum,
        uploadedBy: documents.uploadedBy,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.workspaceId, ctx.workspaceId),
          eq(documents.assetId, assetId),
          isNull(documents.deletedAt),
        ),
      )
      .orderBy(asc(documents.createdAt));
  }

  private async findScoped(ctx: WorkspaceContext, documentId: string) {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.workspaceId, ctx.workspaceId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Document not found', 'DOCUMENT_NOT_FOUND');
    }
    return row;
  }

  async downloadInfo(ctx: WorkspaceContext, documentId: string) {
    const row = await this.findScoped(ctx, documentId);
    return row;
  }

  downloadStream(objectKey: string) {
    return this.storage.stream(objectKey);
  }

  async remove(ctx: WorkspaceContext, actorId: string, documentId: string) {
    const row = await this.findScoped(ctx, documentId);
    await this.db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, row.id));
    // Blob stays until a GC sweep — restoring is possible in the soft-delete window.
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'document.deleted',
      resource: 'document',
      resourceId: row.id,
      metadata: { assetId: row.assetId, kind: row.kind },
    });
    return { ok: true };
  }
}
