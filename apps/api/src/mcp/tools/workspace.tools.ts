import { Injectable, Inject } from '@nestjs/common';
import { Tool, type McpContext } from '@nestjs/mcp';
import { z } from 'zod';
import { DATABASE } from '../../common/tokens.js';
import type { Database } from '@assetnest/db';
import { WorkspacesService } from '../../workspaces/workspaces.service.js';
import { changeRoleSchema, createInviteSchema, updateWorkspaceSchema } from '../../workspaces/dto.js';
import { AssetsService } from '../../assets/assets.service.js';
import { WarrantiesService } from '../../warranties/warranties.service.js';
import { MaintenanceService } from '../../maintenance/maintenance.service.js';
import { McpRateLimiter } from '../rate-limiter.service.js';
import { automationIdentity, auditMcpInvocation, invoke } from '../tool-support.js';

@Injectable()
export class WorkspaceMcpTools {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly assets: AssetsService,
    private readonly warranties: WarrantiesService,
    private readonly maintenance: MaintenanceService,
    @Inject(DATABASE) private readonly db: Database,
    private readonly rateLimiter: McpRateLimiter,
  ) {}

  // ─── workspace ─────────────────────────────────────────────────────────

  @Tool({
    name: 'workspace_get',
    description:
      'Get the current workspace (id, name, slug, mode, settings, member count, and the automation role).',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  })
  async workspaceGet(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.workspaces.get(id.wsCtx));
  }

  @Tool({
    name: 'workspace_update',
    description: 'Update workspace name, mode (home|office) or settings object.',
    inputSchema: updateWorkspaceSchema,
    scopes: ['workspace:manage'],
    annotations: { readOnlyHint: false },
  })
  async workspaceUpdate(input: z.infer<typeof updateWorkspaceSchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.workspaces.update(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'workspace_update');
    }
    return result;
  }

  @Tool({
    name: 'workspace_summary',
    description:
      'Operational summary of the workspace: total assets (live), warranties expiring within 90 days, enabled maintenance plans, recent activity count. Ideal first call for a daily briefing.',
    inputSchema: z.object({}),
    scopes: ['reports:read'],
    annotations: { readOnlyHint: true },
  })
  async workspaceSummary(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(async () => {
      const assets = await this.assets.list(id.wsCtx, {
        page: 1,
        pageSize: 1,
        sort: 'createdAt',
        order: 'desc',
      });
      const expiring = await this.warranties.list(id.wsCtx, { expiringDays: 90 });
      const plans = await this.maintenance.listPlans(id.wsCtx);
      const activity = ctx.authInfo?.scopes.includes('audit:read')
        ? await this.workspaces.listAuditLog(id.wsCtx, 8, 0)
        : null;
      const expiringCount = Array.isArray(expiring) ? expiring.length : 0;
      return {
        workspaceId: id.wsCtx.workspaceId,
        assets: { total: (assets as { total?: number }).total ?? null },
        warrantiesExpiring90d: expiringCount,
        maintenancePlans: Array.isArray(plans) ? plans.length : 0,
        recentActivity: activity?.length ?? null,
      };
    });
  }

  @Tool({
    name: 'workspace_audit_log',
    description: 'List the workspace audit log (most recent first). limit defaults to 25, max 100.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    scopes: ['audit:read'],
    annotations: { readOnlyHint: true },
  })
  async auditLog(input: { limit?: number; offset?: number }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.workspaces.listAuditLog(id.wsCtx, input.limit ?? 25, input.offset ?? 0));
  }

  // ─── members & invites ─────────────────────────────────────────────────

  @Tool({
    name: 'members_list',
    description:
      'List workspace members (userId, membershipId, role, status, displayName, email). Needed for custody assignments.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  })
  async membersList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.workspaces.listMembers(id.wsCtx));
  }

  @Tool({
    name: 'members_change_role',
    description:
      'Change a member’s role. roleKey ∈ owner|admin|manager|member|auditor. Granting owner transfers workspace ownership (owner-only rule is enforced server-side).',
    inputSchema: changeRoleSchema.extend({ userId: z.uuid() }),
    scopes: ['workspace:manage'],
    annotations: { readOnlyHint: false, destructiveHint: true },
  })
  async membersChangeRole(input: z.infer<typeof changeRoleSchema> & { userId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { userId, ...body } = input;
    const result = await invoke(() => this.workspaces.changeRole(id.wsCtx, id.actorId ?? '', userId, body));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'members_change_role');
    }
    return result;
  }

  @Tool({
    name: 'members_remove',
    description: 'Remove a member from the workspace (custody history is preserved).',
    inputSchema: z.object({ userId: z.uuid() }),
    scopes: ['workspace:manage'],
    annotations: { readOnlyHint: false, destructiveHint: true },
  })
  async membersRemove(input: { userId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.workspaces.removeMember(id.wsCtx, id.actorId ?? '', input.userId));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'members_remove');
    }
    return result;
  }

  @Tool({
    name: 'invites_list',
    description:
      'List pending and past invites (never includes tokens or links — those exist only at creation time).',
    inputSchema: z.object({}),
    scopes: ['workspace:manage'],
    annotations: { readOnlyHint: true },
  })
  async invitesList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.workspaces.listInvites(id.wsCtx));
  }

  @Tool({
    name: 'invites_create',
    description:
      'Create a single-use invite link for a teammate. roleKey ∈ admin|manager|member|auditor (owner is never grantable via invite). Returns the accept URL — deliver it over a trusted channel; it is shown once.',
    inputSchema: createInviteSchema,
    scopes: ['workspace:manage'],
    annotations: { readOnlyHint: false },
  })
  async invitesCreate(input: z.infer<typeof createInviteSchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.workspaces.createInvite(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'invites_create');
    }
    return result;
  }

  @Tool({
    name: 'invites_revoke',
    description: 'Revoke a pending invite.',
    inputSchema: z.object({ inviteId: z.uuid() }),
    scopes: ['workspace:manage'],
    annotations: { readOnlyHint: false, destructiveHint: true },
  })
  async invitesRevoke(input: { inviteId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() =>
      this.workspaces.revokeInvite(id.wsCtx, id.actorId ?? '', input.inviteId),
    );
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'invites_revoke');
    }
    return result;
  }
}
