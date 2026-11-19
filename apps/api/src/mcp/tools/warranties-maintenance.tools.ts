import { Injectable, Inject } from '@nestjs/common';
import { Tool, type McpContext } from '@nestjs/mcp';
import { z } from 'zod';
import { DATABASE } from '../../common/tokens.js';
import type { Database } from '@assetnest/db';
import { WarrantiesService } from '../../warranties/warranties.service.js';
import {
  createWarrantySchema,
  listWarrantiesQuerySchema,
  updateWarrantySchema,
} from '../../warranties/dto.js';
import { MaintenanceService } from '../../maintenance/maintenance.service.js';
import {
  createPlanSchema,
  createRecordSchema,
  listRecordsQuerySchema,
  updatePlanSchema,
} from '../../maintenance/dto.js';
import { McpRateLimiter } from '../rate-limiter.service.js';
import { automationIdentity, auditMcpInvocation, invoke } from '../tool-support.js';

@Injectable()
export class WarrantiesMaintenanceMcpTools {
  constructor(
    private readonly warranties: WarrantiesService,
    private readonly maintenance: MaintenanceService,
    @Inject(DATABASE) private readonly db: Database,
    private readonly rateLimiter: McpRateLimiter,
  ) {}

  // ─── warranties ───────────────────────────────────────────────────────

  @Tool({
    name: 'warranties_list',
    description:
      'List warranties. With expiringDays, only those expiring within that window (or already expired). Warranty state is derived from dates at read time.',
    inputSchema: listWarrantiesQuerySchema,
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async warrantiesList(input: { expiringDays?: number }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.warranties.list(id.wsCtx, listWarrantiesQuerySchema.parse(input)));
  }

  @Tool({
    name: 'warranties_create',
    description: 'Register a warranty for an asset. Dates are ISO YYYY-MM-DD; expiresOn must be ≥ startsOn.',
    inputSchema: createWarrantySchema,
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async warrantiesCreate(input: z.infer<typeof createWarrantySchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.warranties.create(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'warranties_create');
    }
    return result;
  }

  @Tool({
    name: 'warranties_update',
    description: 'Update a warranty (provider, startsOn, expiresOn, details).',
    inputSchema: updateWarrantySchema.extend({ warrantyId: z.uuid() }),
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async warrantiesUpdate(
    input: z.infer<typeof updateWarrantySchema> & { warrantyId: string },
    ctx: McpContext,
  ) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { warrantyId, ...patch } = input;
    const result = await invoke(() => this.warranties.update(id.wsCtx, id.actorId ?? '', warrantyId, patch));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'warranties_update');
    }
    return result;
  }

  // ─── maintenance plans ────────────────────────────────────────────────

  @Tool({
    name: 'maintenance_plans_list',
    description: 'List preventive maintenance plans (cadence, next due date, enabled flag).',
    inputSchema: z.object({}),
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async plansList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.maintenance.listPlans(id.wsCtx));
  }

  @Tool({
    name: 'maintenance_plans_create',
    description:
      'Create a preventive maintenance plan for an asset. cadence ∈ monthly|quarterly|semiannual|yearly|once. nextDueAt is ISO YYYY-MM-DD.',
    inputSchema: createPlanSchema,
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async plansCreate(input: z.infer<typeof createPlanSchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.maintenance.createPlan(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'maintenance_plans_create');
    }
    return result;
  }

  @Tool({
    name: 'maintenance_plans_update',
    description: 'Update a plan’s title, cadence, nextDueAt or enabled flag.',
    inputSchema: updatePlanSchema.extend({ planId: z.uuid() }),
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async plansUpdate(input: z.infer<typeof updatePlanSchema> & { planId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { planId, ...patch } = input;
    const result = await invoke(() => this.maintenance.updatePlan(id.wsCtx, id.actorId ?? '', planId, patch));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'maintenance_plans_update');
    }
    return result;
  }

  // ─── maintenance records ───────────────────────────────────────────────

  @Tool({
    name: 'maintenance_records_list',
    description: 'List performed maintenance records, optionally filtered by asset.',
    inputSchema: listRecordsQuerySchema,
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async recordsList(input: { assetId?: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.maintenance.listRecords(id.wsCtx, listRecordsQuerySchema.parse(input)));
  }

  @Tool({
    name: 'maintenance_records_create',
    description:
      'Log a completed maintenance service. When planId is provided and the plan has a recurring cadence, the plan’s nextDueAt advances automatically. cost is a string with ≤2 decimals.',
    inputSchema: createRecordSchema,
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async recordsCreate(input: z.infer<typeof createRecordSchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.maintenance.createRecord(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'maintenance_records_create');
    }
    return result;
  }
}
