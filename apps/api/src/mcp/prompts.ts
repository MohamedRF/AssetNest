import { Injectable } from '@nestjs/common';
import { Prompt, type McpContext } from '@nestjs/mcp';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { AssetsService } from '../assets/assets.service.js';
import { WarrantiesService } from '../warranties/warranties.service.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { automationIdentity } from './tool-support.js';

/**
 * Templated prompts with live workspace context baked in — the model gets
 * grounded facts, not placeholders.
 */
@Injectable()
export class AssetNestMcpPrompts {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly assets: AssetsService,
    private readonly warranties: WarrantiesService,
    private readonly maintenance: MaintenanceService,
  ) {}

  @Prompt({
    name: 'inventory_review',
    description: 'Prepare an inventory hygiene review for this workspace (assets, gaps, next actions).',
  })
  async inventoryReview(_args: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    const assets = await this.assets.list(id.wsCtx, {
      page: 1,
      pageSize: 1,
      sort: 'createdAt',
      order: 'desc',
    });
    const workspace = await this.workspaces.get(id.wsCtx);
    return [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `You are reviewing the asset inventory of workspace "${workspace.name}" (mode: ${workspace.mode}).\n` +
            `It contains ${assets.total} registered assets.\n\n` +
            `Produce an inventory hygiene review:\n` +
            `1. What should be checked first (ask me for asset lists via the assets_* tools).\n` +
            `2. Likely data gaps (missing tags, unchecked-out items, stale warranties) — verify with the warranties_* and custody_* tools.\n` +
            `3. A prioritized cleanup plan. Do not mutate anything until I explicitly approve.`,
        },
      },
    ];
  }

  @Prompt({
    name: 'warranty_review',
    description: 'Review warranties expiring within 60 days and draft renewal actions.',
  })
  async warrantyReview(_args: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    const expiring = (await this.warranties.list(id.wsCtx, { expiringDays: 60 })) as Array<{
      assetId: string;
      provider: string;
      expiresOn: string;
      derivedStatus?: string;
    }>;
    const lines =
      expiring.length === 0
        ? 'No warranties expire within 60 days.'
        : expiring
            .map(
              (w) =>
                `- asset ${w.assetId}: ${w.provider} expires ${w.expiresOn} (${w.derivedStatus ?? 'unknown'})`,
            )
            .join('\n');
    return [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `Review these warranties expiring within 60 days:\n${lines}\n\n` +
            `For each: recommend renew / replace / accept-risk, and draft a short vendor message if renewal is sensible. ` +
            `Do not send anything; produce a review document only.`,
        },
      },
    ];
  }

  @Prompt({
    name: 'maintenance_review',
    description: 'Review preventive maintenance plans and propose a next service schedule.',
  })
  async maintenanceReview(_args: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    const plans = (await this.maintenance.listPlans(id.wsCtx)) as Array<{
      assetId: string;
      title: string;
      cadence: string;
      nextDueAt: string;
      enabled: boolean;
    }>;
    const lines =
      plans.length === 0
        ? 'No maintenance plans yet.'
        : plans
            .map(
              (p) =>
                `- [${p.enabled ? 'on' : 'off'}] ${p.title} (asset ${p.assetId}, ${p.cadence}, due ${p.nextDueAt})`,
            )
            .join('\n');
    return [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `Current maintenance plans:\n${lines}\n\n` +
            `Propose the next 90 days of service work: which are due soonest, what is likely overdue, and any plans that should be disabled. ` +
            `Read assets_get for each asset before making claims about condition. Do not create plans until I approve.`,
        },
      },
    ];
  }

  @Prompt({
    name: 'audit_brief',
    description: 'Summarize recent audit-log activity into a concise operational brief.',
  })
  async auditBrief(_args: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    const entries = (await this.workspaces.listAuditLog(id.wsCtx, 20, 0)) as Array<{
      action: string;
      resource: string;
      occurredAt: Date | string;
    }>;
    const lines = entries.map((e) => `- ${e.action} on ${e.resource} at ${String(e.occurredAt)}`).join('\n');
    return [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `Recent workspace activity (audit log, newest first):\n${lines || '(empty)'}\n\n` +
            `Write a 5-line operational brief: what changed, what looks unusual, and what deserves follow-up. Flag anything destructive (archives, removals, role changes) explicitly.`,
        },
      },
    ];
  }
}
