import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { assets, warranties } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type { CreateWarrantyInput, ListWarrantiesQuery, UpdateWarrantyInput } from './dto.js';

@Injectable()
export class WarrantiesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(ctx: WorkspaceContext, query: ListWarrantiesQuery) {
    const filters = [eq(warranties.workspaceId, ctx.workspaceId)];
    if (query.expiringDays !== undefined) {
      const horizon = new Date();
      horizon.setUTCDate(horizon.getUTCDate() + query.expiringDays);
      filters.push(lte(warranties.expiresOn, horizon.toISOString().slice(0, 10)));
    }
    const rows = await this.db
      .select({
        id: warranties.id,
        assetId: warranties.assetId,
        assetTag: assets.assetTag,
        assetName: assets.displayName,
        provider: warranties.provider,
        startsOn: warranties.startsOn,
        expiresOn: warranties.expiresOn,
        details: warranties.details,
      })
      .from(warranties)
      .innerJoin(assets, eq(assets.id, warranties.assetId))
      .where(and(...filters))
      .orderBy(asc(warranties.expiresOn));
    return rows.map((row) => ({ ...row, derivedStatus: deriveWarrantyState(row.expiresOn) }));
  }

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

  async create(ctx: WorkspaceContext, actorId: string, input: CreateWarrantyInput) {
    await this.ensureAsset(ctx, input.assetId);
    const [created] = await this.db
      .insert(warranties)
      .values({
        workspaceId: ctx.workspaceId,
        assetId: input.assetId,
        provider: input.provider,
        startsOn: input.startsOn,
        expiresOn: input.expiresOn,
        details: input.details,
      })
      .returning();
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'warranty.created',
      resource: 'warranty',
      resourceId: created!.id,
      metadata: { assetId: input.assetId, expiresOn: input.expiresOn },
    });
    return created!;
  }

  async update(ctx: WorkspaceContext, actorId: string, warrantyId: string, input: UpdateWarrantyInput) {
    const [current] = await this.db
      .select()
      .from(warranties)
      .where(and(eq(warranties.id, warrantyId), eq(warranties.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!current) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Warranty not found', 'WARRANTY_NOT_FOUND');
    }
    const nextStarts = input.startsOn ?? current.startsOn;
    const nextExpires = input.expiresOn ?? current.expiresOn;
    if (nextExpires < nextStarts) {
      throw httpCode(HttpStatus.BAD_REQUEST, 'expiresOn must be on or after startsOn', 'VALIDATION_FAILED');
    }
    const [updated] = await this.db
      .update(warranties)
      .set({
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        startsOn: nextStarts,
        expiresOn: nextExpires,
        ...(input.details !== undefined ? { details: input.details } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(warranties.id, warrantyId), eq(warranties.workspaceId, ctx.workspaceId)))
      .returning();
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'warranty.updated',
      resource: 'warranty',
      resourceId: updated!.id,
      metadata: { fields: Object.keys(input) },
    });
    return updated!;
  }
}

/** Derived, never persisted: expired → expired; 90 days → soon; else active. */
export function deriveWarrantyState(expiresOn: string): 'expired' | 'expiring_90' | 'expiring_30' | 'active' {
  const today = new Date().toISOString().slice(0, 10);
  if (expiresOn < today) return 'expired';
  const in30 = new Date();
  in30.setUTCDate(in30.getUTCDate() + 30);
  if (expiresOn <= in30.toISOString().slice(0, 10)) return 'expiring_30';
  const in90 = new Date();
  in90.setUTCDate(in90.getUTCDate() + 90);
  if (expiresOn <= in90.toISOString().slice(0, 10)) return 'expiring_90';
  return 'active';
}
