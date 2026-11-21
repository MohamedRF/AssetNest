import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  assets,
  assetEvents,
  assetTags,
  assetCustomValues,
  locations,
  categories,
  memberships,
} from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { canTransition, type AssetStatus, type WorkflowAction } from '@assetnest/domain';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { writeOutboxEvent } from '../common/outbox.js';
import { httpCode, isUniqueViolation } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import type { CreateAssetInput, ListAssetsQuery, StatusTransitionInput, UpdateAssetInput } from './dto.js';

type AssetRow = typeof assets.$inferSelect;

export interface AssetHistoryEntry {
  id: string;
  action: string;
  actorId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  occurredAt: Date;
  correlationId: string;
}

function isNotFound(): never {
  throw httpCode(HttpStatus.NOT_FOUND, 'Asset not found', 'ASSET_NOT_FOUND');
}

function assetTagExists(assetTag: string) {
  return httpCode(
    HttpStatus.CONFLICT,
    `Asset tag '${assetTag}' already exists in this workspace`,
    'ASSET_TAG_EXISTS',
  );
}

@Injectable()
export class AssetsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly approvals: ApprovalsService,
  ) {}

  async get(ctx: WorkspaceContext, assetId: string) {
    const rows = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)))
      .limit(1);
    const asset = rows[0] ?? isNotFound();
    const tags = await this.db
      .select({ tag: assetTags.tag })
      .from(assetTags)
      .where(and(eq(assetTags.workspaceId, ctx.workspaceId), eq(assetTags.assetId, assetId)));
    const customValues = await this.db
      .select()
      .from(assetCustomValues)
      .where(and(eq(assetCustomValues.workspaceId, ctx.workspaceId), eq(assetCustomValues.assetId, assetId)));
    return { ...asset, tags: tags.map((t) => t.tag), customValues: this.toCustomValuesMap(customValues) };
  }

  private toCustomValuesMap(rows: Array<typeof assetCustomValues.$inferSelect>) {
    const map: Record<string, unknown> = {};
    for (const row of rows) {
      map[row.fieldKey] = row.jsonValue;
    }
    return map;
  }

  async list(ctx: WorkspaceContext, query: ListAssetsQuery) {
    const filters = [eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)];
    if (query.status) filters.push(eq(assets.status, query.status));
    if (query.condition) filters.push(eq(assets.condition, query.condition));
    if (query.categoryId) filters.push(eq(assets.categoryId, query.categoryId));
    if (query.locationId) filters.push(eq(assets.locationId, query.locationId));
    if (query.q) {
      const pattern = `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      filters.push(
        or(
          ilike(assets.displayName, pattern),
          ilike(assets.serialNumber, pattern),
          ilike(assets.assetTag, pattern),
          ilike(assets.notes, pattern),
        )!,
      );
    }
    const where = and(...filters);

    const sortColumns = {
      createdAt: assets.createdAt,
      updatedAt: assets.updatedAt,
      displayName: assets.displayName,
      assetTag: assets.assetTag,
      status: assets.status,
    } as const;
    const sortColumn = sortColumns[query.sort];
    const orderBy = query.order === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const [totalRow] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(assets)
      .where(where);
    const total = totalRow?.value ?? 0;
    const items = await this.db
      .select()
      .from(assets)
      .where(where)
      .orderBy(orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  private async referenceCheck(
    ctx: WorkspaceContext,
    input: CreateAssetInput | UpdateAssetInput,
  ): Promise<void> {
    if ('categoryId' in input && input.categoryId) {
      const [row] = await this.db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, input.categoryId), eq(categories.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!row)
        throw httpCode(HttpStatus.BAD_REQUEST, 'Category not found in this workspace', 'CATEGORY_NOT_FOUND');
    }
    if ('locationId' in input && input.locationId) {
      const [row] = await this.db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.id, input.locationId), eq(locations.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!row)
        throw httpCode(HttpStatus.BAD_REQUEST, 'Location not found in this workspace', 'LOCATION_NOT_FOUND');
    }
    if ('custodianMembershipId' in input && input.custodianMembershipId) {
      const [row] = await this.db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, input.custodianMembershipId),
            eq(memberships.workspaceId, ctx.workspaceId),
            eq(memberships.status, 'active'),
          ),
        )
        .limit(1);
      if (!row) {
        throw httpCode(
          HttpStatus.BAD_REQUEST,
          'Custodian is not an active member of this workspace',
          'CUSTODIAN_NOT_MEMBER',
        );
      }
    }
  }

  async create(ctx: WorkspaceContext, actorId: string, input: CreateAssetInput) {
    await this.referenceCheck(ctx, input);
    const { tags, customValues, ...fields } = input;

    try {
      const created = await this.db.transaction(async (tx) => {
        const [asset] = await tx
          .insert(assets)
          .values({
            workspaceId: ctx.workspaceId,
            assetTag: fields.assetTag,
            displayName: fields.displayName,
            serialNumber: fields.serialNumber,
            categoryId: fields.categoryId ?? null,
            modelId: fields.modelId ?? null,
            locationId: fields.locationId ?? null,
            custodianMembershipId: fields.custodianMembershipId ?? null,
            status: fields.status,
            condition: fields.condition,
            purchasedAt: fields.purchasedAt,
            amount: fields.amount,
            currency: fields.currency,
            notes: fields.notes,
          })
          .returning();
        if (!asset) {
          throw new Error('asset insert returned no row');
        }
        if (tags && tags.length > 0) {
          await tx
            .insert(assetTags)
            .values(tags.map((tag) => ({ workspaceId: ctx.workspaceId, assetId: asset.id, tag })))
            .onConflictDoNothing();
        }
        if (customValues) {
          const entries = Object.entries(customValues);
          if (entries.length > 0) {
            await tx.insert(assetCustomValues).values(
              entries.map(([fieldKey, jsonValue]) => ({
                workspaceId: ctx.workspaceId,
                assetId: asset.id,
                fieldKey,
                jsonValue: jsonValue as object,
              })),
            );
          }
        }
        await tx.insert(assetEvents).values({
          workspaceId: ctx.workspaceId,
          assetId: asset.id,
          actorId,
          action: 'asset.created',
          afterJson: this.publicAsset(asset),
        });
        await writeOutboxEvent(tx, {
          workspaceId: ctx.workspaceId,
          kind: 'asset.created',
          aggregateId: asset.id,
          payload: { assetTag: asset.assetTag, displayName: asset.displayName, status: asset.status },
        });
        return asset;
      });

      await writeAuditLog(this.db, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'asset.created',
        resource: 'asset',
        resourceId: created.id,
        metadata: { assetTag: created.assetTag },
      });
      return this.get(ctx, created.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw assetTagExists(fields.assetTag);
      }
      throw error;
    }
  }

  /** Optimistic compare-and-swap: only one writer wins on a given version. */
  async update(ctx: WorkspaceContext, actorId: string, assetId: string, input: UpdateAssetInput) {
    await this.referenceCheck(ctx, input);
    const { tags, customValues, expectedVersion, ...fields } = input;

    const [current] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)))
      .limit(1);
    if (!current) {
      isNotFound();
    }

    const changes = Object.entries(fields).filter(([key, value]) => {
      if (value === undefined) return false;
      const before = (current as unknown as Record<string, unknown>)[key] ?? null;
      return before !== value;
    });

    const result = await this.db.transaction(async (tx) => {
      // CAS on version: 0 rows → someone else wrote first.
      const [updated] = await tx
        .update(assets)
        .set({
          ...definedFields(fields),
          version: sql`${assets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.workspaceId, ctx.workspaceId),
            eq(assets.version, expectedVersion),
            isNull(assets.deletedAt),
          ),
        )
        .returning()
        .catch((error: unknown) => {
          if (fields.assetTag !== undefined && isUniqueViolation(error)) {
            throw assetTagExists(fields.assetTag);
          }
          throw error;
        });
      if (!updated) {
        return null;
      }

      if (tags !== undefined) {
        await tx
          .delete(assetTags)
          .where(and(eq(assetTags.workspaceId, ctx.workspaceId), eq(assetTags.assetId, assetId)));
        if (tags.length > 0) {
          await tx
            .insert(assetTags)
            .values(tags.map((tag) => ({ workspaceId: ctx.workspaceId, assetId, tag })))
            .onConflictDoNothing();
        }
      }
      if (customValues !== undefined) {
        await tx
          .delete(assetCustomValues)
          .where(
            and(eq(assetCustomValues.workspaceId, ctx.workspaceId), eq(assetCustomValues.assetId, assetId)),
          );
        const entries = Object.entries(customValues);
        if (entries.length > 0) {
          await tx.insert(assetCustomValues).values(
            entries.map(([fieldKey, jsonValue]) => ({
              workspaceId: ctx.workspaceId,
              assetId,
              fieldKey,
              jsonValue: jsonValue as object,
            })),
          );
        }
      }

      await tx.insert(assetEvents).values({
        workspaceId: ctx.workspaceId,
        assetId,
        actorId,
        action: 'asset.updated',
        beforeJson: this.publicAsset(current),
        afterJson: this.publicAsset(updated),
      });
      await writeOutboxEvent(tx, {
        workspaceId: ctx.workspaceId,
        kind: 'asset.updated',
        aggregateId: assetId,
        payload: { fields: changes.map(([key]) => key) },
      });
      return updated;
    });

    if (!result) {
      const [fresh] = await this.db
        .select({ version: assets.version })
        .from(assets)
        .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId)))
        .limit(1);
      throw httpCode(
        HttpStatus.CONFLICT,
        `Asset was modified elsewhere (your version ${expectedVersion}, current version ${fresh?.version ?? 'unknown'}). Reload and retry.`,
        'ASSET_VERSION_CONFLICT',
      );
    }

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'asset.updated',
      resource: 'asset',
      resourceId: assetId,
      metadata: { fields: changes.map(([key]) => key) },
    });
    return this.get(ctx, assetId);
  }

  async archive(ctx: WorkspaceContext, actorId: string, assetId: string) {
    await this.db.transaction(async (tx) => {
      const [asset] = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)))
        .limit(1);
      if (!asset) {
        isNotFound();
      }
      if (asset.status === 'archived') {
        throw httpCode(HttpStatus.CONFLICT, 'Asset is already archived', 'ASSET_ALREADY_ARCHIVED');
      }
      const [row] = await tx
        .update(assets)
        .set({ status: 'archived', version: sql`${assets.version} + 1`, updatedAt: new Date() })
        .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId)))
        .returning();
      await tx.insert(assetEvents).values({
        workspaceId: ctx.workspaceId,
        assetId,
        actorId,
        action: 'asset.archived',
        beforeJson: { status: asset.status },
        afterJson: { status: 'archived' },
      });
      await writeOutboxEvent(tx, {
        workspaceId: ctx.workspaceId,
        kind: 'asset.archived',
        aggregateId: assetId,
        payload: { assetTag: asset.assetTag },
      });
      return [row!];
    });
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'asset.archived',
      resource: 'asset',
      resourceId: assetId,
    });
    return this.get(ctx, assetId);
  }

  async transitionStatus(
    ctx: WorkspaceContext,
    actorId: string,
    assetId: string,
    input: StatusTransitionInput,
  ) {
    const [current] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)))
      .limit(1);
    if (!current) {
      isNotFound();
    }
    const from = current.status as AssetStatus;
    if (!canTransition(from, input.to)) {
      throw httpCode(
        HttpStatus.CONFLICT,
        `Cannot transition asset from '${from}' to '${input.to}'`,
        'INVALID_TRANSITION',
      );
    }

    // Configurable approval workflow (P6-02): disposal/retirement can be placed
    // behind an approved request. No rule = no approval required (default).
    const approvalAction: WorkflowAction | null =
      input.to === 'disposed' ? 'asset.dispose' : input.to === 'retired' ? 'asset.retire' : null;
    await this.db.transaction(async (tx) => {
      const approvalRequestId = approvalAction
        ? await this.approvals.assertApproved(tx, ctx, approvalAction, 'asset', assetId)
        : null;
      const [row] = await tx
        .update(assets)
        .set({ status: input.to, version: sql`${assets.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.workspaceId, ctx.workspaceId),
            eq(assets.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!row) {
        throw httpCode(
          HttpStatus.CONFLICT,
          `Asset was modified elsewhere (your version ${input.expectedVersion}). Reload and retry.`,
          'ASSET_VERSION_CONFLICT',
        );
      }
      await tx.insert(assetEvents).values({
        workspaceId: ctx.workspaceId,
        assetId,
        actorId,
        action: 'asset.status_changed',
        beforeJson: { status: from },
        afterJson: { status: input.to },
      });
      await writeOutboxEvent(tx, {
        workspaceId: ctx.workspaceId,
        kind: 'asset.status_changed',
        aggregateId: assetId,
        payload: { from, to: input.to },
      });
      // Consume the approval in the same transaction as the state change so a
      // granted approval cannot be replayed for a second disposal.
      if (approvalRequestId) {
        await this.approvals.consume(tx, approvalRequestId);
      }
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'asset.status_changed',
        resource: 'asset',
        resourceId: assetId,
        metadata: { from, to: input.to },
      });
    });
    return this.get(ctx, assetId);
  }

  async history(ctx: WorkspaceContext, assetId: string): Promise<AssetHistoryEntry[]> {
    // Tenancy check first — 404 for assets outside the workspace.
    const rows = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (rows.length === 0) {
      isNotFound();
    }
    return this.db
      .select({
        id: assetEvents.id,
        action: assetEvents.action,
        actorId: assetEvents.actorId,
        beforeJson: assetEvents.beforeJson,
        afterJson: assetEvents.afterJson,
        occurredAt: assetEvents.occurredAt,
        correlationId: assetEvents.correlationId,
      })
      .from(assetEvents)
      .where(and(eq(assetEvents.workspaceId, ctx.workspaceId), eq(assetEvents.assetId, assetId)))
      .orderBy(desc(assetEvents.occurredAt))
      .limit(100);
  }

  private publicAsset(asset: AssetRow) {
    const {
      // Asset rows are not secret, but omit internal bookkeeping noise from events.
      createdAt,
      updatedAt,
      deletedAt,
      ...rest
    } = asset;
    void createdAt;
    void updatedAt;
    void deletedAt;
    return rest;
  }
}

function definedFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out = {} as Partial<T>;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
