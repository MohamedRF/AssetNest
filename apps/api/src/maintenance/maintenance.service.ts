import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { assets, maintenancePlans, maintenanceRecords, vendors } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type {
  Cadence,
  CreatePlanInput,
  CreateRecordInput,
  ListRecordsQuery,
  UpdatePlanInput,
} from './dto.js';

const CADENCE_MONTHS: Record<Cadence, number | null> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
  once: null,
};

function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

function dueState(
  nextDueAt: string,
  enabled: boolean,
): 'disabled' | 'overdue' | 'due_7' | 'due_30' | 'scheduled' {
  if (!enabled) return 'disabled';
  const today = new Date().toISOString().slice(0, 10);
  if (nextDueAt < today) return 'overdue';
  const in7 = new Date();
  in7.setUTCDate(in7.getUTCDate() + 7);
  if (nextDueAt <= in7.toISOString().slice(0, 10)) return 'due_7';
  const in30 = new Date();
  in30.setUTCDate(in30.getUTCDate() + 30);
  if (nextDueAt <= in30.toISOString().slice(0, 10)) return 'due_30';
  return 'scheduled';
}

@Injectable()
export class MaintenanceService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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

  async listPlans(ctx: WorkspaceContext) {
    const rows = await this.db
      .select({
        id: maintenancePlans.id,
        assetId: maintenancePlans.assetId,
        assetTag: assets.assetTag,
        assetName: assets.displayName,
        title: maintenancePlans.title,
        cadence: maintenancePlans.cadence,
        nextDueAt: maintenancePlans.nextDueAt,
        enabled: maintenancePlans.enabled,
      })
      .from(maintenancePlans)
      .innerJoin(assets, eq(assets.id, maintenancePlans.assetId))
      .where(eq(maintenancePlans.workspaceId, ctx.workspaceId))
      .orderBy(asc(maintenancePlans.nextDueAt));
    return rows.map((row) => ({
      ...row,
      dueState: dueState(row.nextDueAt, row.enabled),
    }));
  }

  async createPlan(ctx: WorkspaceContext, actorId: string, input: CreatePlanInput) {
    await this.ensureAsset(ctx, input.assetId);
    const [created] = await this.db
      .insert(maintenancePlans)
      .values({
        workspaceId: ctx.workspaceId,
        assetId: input.assetId,
        title: input.title,
        cadence: input.cadence,
        nextDueAt: input.nextDueAt,
        enabled: input.enabled,
      })
      .returning();
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'maintenance.plan_created',
      resource: 'maintenance_plan',
      resourceId: created!.id,
      metadata: { cadence: input.cadence },
    });
    return created!;
  }

  async updatePlan(ctx: WorkspaceContext, actorId: string, planId: string, input: UpdatePlanInput) {
    const [current] = await this.db
      .select()
      .from(maintenancePlans)
      .where(and(eq(maintenancePlans.id, planId), eq(maintenancePlans.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!current) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Maintenance plan not found', 'PLAN_NOT_FOUND');
    }
    const [updated] = await this.db
      .update(maintenancePlans)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(maintenancePlans.id, planId), eq(maintenancePlans.workspaceId, ctx.workspaceId)))
      .returning();
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'maintenance.plan_updated',
      resource: 'maintenance_plan',
      resourceId: updated!.id,
      metadata: { fields: Object.keys(input) },
    });
    return updated!;
  }

  async listRecords(ctx: WorkspaceContext, query: ListRecordsQuery) {
    const filters = [eq(maintenanceRecords.workspaceId, ctx.workspaceId)];
    if (query.assetId) {
      filters.push(eq(maintenanceRecords.assetId, query.assetId));
    }
    return this.db
      .select({
        id: maintenanceRecords.id,
        assetId: maintenanceRecords.assetId,
        assetTag: assets.assetTag,
        planId: maintenanceRecords.planId,
        performedAt: maintenanceRecords.performedAt,
        vendorId: maintenanceRecords.vendorId,
        vendorName: vendors.name,
        cost: maintenanceRecords.cost,
        currency: maintenanceRecords.currency,
        notes: maintenanceRecords.notes,
        createdAt: maintenanceRecords.createdAt,
      })
      .from(maintenanceRecords)
      .innerJoin(assets, eq(assets.id, maintenanceRecords.assetId))
      .leftJoin(vendors, eq(vendors.id, maintenanceRecords.vendorId))
      .where(and(...filters))
      .orderBy(desc(maintenanceRecords.performedAt))
      .limit(100);
  }

  async createRecord(ctx: WorkspaceContext, actorId: string, input: CreateRecordInput) {
    await this.ensureAsset(ctx, input.assetId);

    let plan: typeof maintenancePlans.$inferSelect | undefined;
    if (input.planId) {
      const rows = await this.db
        .select()
        .from(maintenancePlans)
        .where(and(eq(maintenancePlans.id, input.planId), eq(maintenancePlans.workspaceId, ctx.workspaceId)))
        .limit(1);
      plan = rows[0];
      if (!plan) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Maintenance plan not found', 'PLAN_NOT_FOUND');
      }
      if (plan.assetId !== input.assetId) {
        throw httpCode(HttpStatus.BAD_REQUEST, 'Plan belongs to a different asset', 'PLAN_ASSET_MISMATCH');
      }
    }
    if (input.vendorId) {
      const [vendor] = await this.db
        .select({ id: vendors.id })
        .from(vendors)
        .where(and(eq(vendors.id, input.vendorId), eq(vendors.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!vendor) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Vendor not found', 'VENDOR_NOT_FOUND');
      }
    }

    const created = await this.db.transaction(async (tx) => {
      const [record] = await tx
        .insert(maintenanceRecords)
        .values({
          workspaceId: ctx.workspaceId,
          assetId: input.assetId,
          planId: input.planId ?? null,
          performedAt: input.performedAt,
          vendorId: input.vendorId ?? null,
          cost: input.cost ?? null,
          currency: input.currency ?? null,
          notes: input.notes ?? null,
          createdById: actorId,
        })
        .returning();
      // Log service: advance the plan schedule from the PERFORMED date.
      if (plan) {
        const months = CADENCE_MONTHS[plan.cadence as Cadence];
        if (months === null) {
          // One-shot plan: disable it.
          await tx
            .update(maintenancePlans)
            .set({ enabled: false, updatedAt: new Date() })
            .where(eq(maintenancePlans.id, plan.id));
        } else {
          await tx
            .update(maintenancePlans)
            .set({ nextDueAt: addMonths(input.performedAt, months), updatedAt: new Date() })
            .where(eq(maintenancePlans.id, plan.id));
        }
      }
      return record!;
    });

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'maintenance.record_created',
      resource: 'maintenance_record',
      resourceId: created.id,
      metadata: { assetId: input.assetId, planId: input.planId ?? null, cost: input.cost ?? null },
    });
    return created;
  }
}
