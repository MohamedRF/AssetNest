import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { toString as qrToString } from 'qrcode';
import { assets } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';

/**
 * Opaque asset QR payload. Contains ONLY the asset's UUID — no serials,
 * invoice data or personal information. Resolution happens in-app after an
 * authorization check, never in an unauthenticated public context.
 */
export const QR_PAYLOAD_PREFIX = 'assetnest://asset/';

@Injectable()
export class QrService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async svgFor(ctx: WorkspaceContext, assetId: string): Promise<string> {
    const [asset] = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)))
      .limit(1);
    if (!asset) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Asset not found', 'ASSET_NOT_FOUND');
    }
    const payload = `${QR_PAYLOAD_PREFIX}${asset.id}`;
    return qrToString(payload, {
      type: 'svg',
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    });
  }
}
