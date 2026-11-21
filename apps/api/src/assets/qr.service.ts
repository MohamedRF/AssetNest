import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { toString as qrToString } from 'qrcode';
import { assets } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import type { AppConfig } from '@assetnest/config';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';

/**
 * Legacy opaque payload. Link labels point to the configured web origin.
 * Both resolve through the authenticated asset view.
 */
export const QR_PAYLOAD_PREFIX = 'assetnest://asset/';

@Injectable()
export class QrService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async svgFor(ctx: WorkspaceContext, assetId: string, format?: 'link'): Promise<string> {
    const [asset] = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)))
      .limit(1);
    if (!asset) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Asset not found', 'ASSET_NOT_FOUND');
    }
    const payload =
      format === 'link'
        ? new URL(`/asset-qr/${ctx.workspaceId}/${asset.id}`, this.config.PUBLIC_APP_URL).href
        : `${QR_PAYLOAD_PREFIX}${asset.id}`;
    return qrToString(payload, {
      type: 'svg',
      margin: 4,
      width: 220,
      errorCorrectionLevel: 'M',
    });
  }
}
