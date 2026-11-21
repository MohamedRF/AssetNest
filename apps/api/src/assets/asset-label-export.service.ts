import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { assetCustomValues, assetModels, assets, assetTags, categories, locations } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/session-auth.guard.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import { DATABASE } from '../common/tokens.js';
import { PoliciesService } from '../policies/policies.service.js';

@Injectable()
export class AssetLabelExportService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PoliciesService) private readonly policies: PoliciesService,
  ) {}

  async getDetails(ctx: WorkspaceContext, auth: AuthContext, assetIds: string[]) {
    const policy = await this.policies.getExportPolicy(ctx);
    if (!policy.enabled) {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Exports are disabled by this workspace’s export policy',
        'EXPORT_DISABLED',
      );
    }

    const rows = await this.db
      .select({
        id: assets.id,
        assetTag: assets.assetTag,
        displayName: assets.displayName,
        serialNumber: assets.serialNumber,
        status: assets.status,
        condition: assets.condition,
        purchasedAt: assets.purchasedAt,
        amount: assets.amount,
        currency: assets.currency,
        notes: assets.notes,
        createdAt: assets.createdAt,
        updatedAt: assets.updatedAt,
        categoryName: categories.name,
        locationName: locations.name,
        maker: assetModels.maker,
        modelName: assetModels.modelName,
        tags: sql<string[]>`coalesce((
          select jsonb_agg(${assetTags.tag} order by ${assetTags.tag})
          from ${assetTags}
          where ${assetTags.workspaceId} = ${assets.workspaceId} and ${assetTags.assetId} = ${assets.id}
        ), '[]'::jsonb)`,
        customValues: sql<Record<string, unknown>>`coalesce((
          select jsonb_object_agg(${assetCustomValues.fieldKey}, ${assetCustomValues.jsonValue})
          from ${assetCustomValues}
          where ${assetCustomValues.workspaceId} = ${assets.workspaceId}
            and ${assetCustomValues.assetId} = ${assets.id}
        ), '{}'::jsonb)`,
      })
      .from(assets)
      .leftJoin(
        categories,
        and(eq(categories.workspaceId, assets.workspaceId), eq(categories.id, assets.categoryId)),
      )
      .leftJoin(
        locations,
        and(eq(locations.workspaceId, assets.workspaceId), eq(locations.id, assets.locationId)),
      )
      .leftJoin(
        assetModels,
        and(eq(assetModels.workspaceId, assets.workspaceId), eq(assetModels.id, assets.modelId)),
      )
      .where(
        and(eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt), inArray(assets.id, assetIds)),
      );

    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = assetIds.map((id) => {
      const item = byId.get(id);
      if (!item) throw httpCode(HttpStatus.NOT_FOUND, 'One or more assets were not found', 'ASSET_NOT_FOUND');
      return item;
    });

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId: auth.user.id === 'unattributed' ? null : auth.user.id,
      action: 'asset.labels_exported',
      resource: 'asset',
      metadata: {
        count: items.length,
        ...(auth.authType === 'api_token' ? { apiTokenId: auth.sessionId.slice('token:'.length) } : {}),
      },
    });
    return { items };
  }
}
