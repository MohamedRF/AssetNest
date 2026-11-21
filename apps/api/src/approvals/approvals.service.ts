import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { approvalDecisions, approvalRequests, assets, workflowRules, workspaces } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import {
  canSelfApprove,
  isApprovalQuorumMet,
  type ApprovalDecision,
  type ApprovalStatus,
  type WorkflowAction,
  type WorkflowRule,
} from '@assetnest/domain';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type { CreateApprovalRequestInput, DecideApprovalInput, WorkflowRuleInput } from './dto.js';

type ApprovalExecutor = Pick<Database, 'select' | 'update'>;

export interface ApprovalRequestView {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestedBy: string | null;
  status: ApprovalStatus;
  requiredApprovals: number;
  approverRoles: string[];
  selfApproval: boolean;
  context: Record<string, unknown>;
  createdAt: Date;
  decidedAt: Date | null;
  executedAt: Date | null;
  decisions: Array<{
    actorId: string | null;
    decision: ApprovalDecision;
    note: string | null;
    createdAt: Date;
  }>;
}

function toStatus(value: string): ApprovalStatus {
  return value as ApprovalStatus;
}

function toDecision(value: string): ApprovalDecision {
  return value as ApprovalDecision;
}

@Injectable()
export class ApprovalsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async lockWorkspace(executor: ApprovalExecutor, workspaceId: string): Promise<void> {
    await executor
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');
  }

  private requirePolicyAdmin(ctx: WorkspaceContext): void {
    if (ctx.role !== 'owner' && ctx.role !== 'admin') {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Only an owner or admin can change approval workflows',
        'INSUFFICIENT_SCOPE',
      );
    }
  }

  async listRules(ctx: WorkspaceContext): Promise<WorkflowRule[]> {
    const rows = await this.db
      .select({
        action: workflowRules.action,
        requiredApprovals: workflowRules.requiredApprovals,
        approverRoles: workflowRules.approverRoles,
        selfApproval: workflowRules.selfApproval,
      })
      .from(workflowRules)
      .where(eq(workflowRules.workspaceId, ctx.workspaceId))
      .orderBy(asc(workflowRules.action));
    return rows.map((row) => ({
      action: row.action as WorkflowAction,
      requiredApprovals: row.requiredApprovals,
      approverRoles: row.approverRoles as WorkflowRule['approverRoles'],
      selfApproval: row.selfApproval,
    }));
  }

  async setRules(
    ctx: WorkspaceContext,
    actorId: string,
    rules: WorkflowRuleInput[],
  ): Promise<WorkflowRule[]> {
    this.requirePolicyAdmin(ctx);
    await this.db.transaction(async (tx) => {
      await this.lockWorkspace(tx, ctx.workspaceId);
      await tx.delete(workflowRules).where(eq(workflowRules.workspaceId, ctx.workspaceId));
      if (rules.length > 0) {
        await tx.insert(workflowRules).values(
          rules.map((rule) => ({
            workspaceId: ctx.workspaceId,
            action: rule.action,
            requiredApprovals: rule.requiredApprovals,
            approverRoles: rule.approverRoles,
            selfApproval: rule.selfApproval,
          })),
        );
      }
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'approval.rules_updated',
        resource: 'workflow_rule',
        metadata: { count: rules.length, actions: rules.map((rule) => rule.action) },
      });
    });
    return this.listRules(ctx);
  }

  async listRequests(
    ctx: WorkspaceContext,
    status?: ApprovalStatus,
    resourceId?: string,
  ): Promise<ApprovalRequestView[]> {
    const rows = await this.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.workspaceId, ctx.workspaceId),
          status ? eq(approvalRequests.status, status) : undefined,
          resourceId ? eq(approvalRequests.resourceId, resourceId) : undefined,
        ),
      )
      .orderBy(desc(approvalRequests.createdAt))
      .limit(50);
    return this.views(rows);
  }

  async getRequest(ctx: WorkspaceContext, requestId: string): Promise<ApprovalRequestView> {
    const [row] = await this.db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!row) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Approval request not found', 'APPROVAL_NOT_FOUND');
    }
    const [view] = await this.views([row]);
    return view!;
  }

  private async views(rows: (typeof approvalRequests.$inferSelect)[]): Promise<ApprovalRequestView[]> {
    if (rows.length === 0) return [];
    const decisions = await this.db
      .select({
        requestId: approvalDecisions.requestId,
        actorId: approvalDecisions.actorId,
        decision: approvalDecisions.decision,
        note: approvalDecisions.note,
        createdAt: approvalDecisions.createdAt,
      })
      .from(approvalDecisions)
      .where(
        inArray(
          approvalDecisions.requestId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(approvalDecisions.createdAt));
    const decisionsByRequest = new Map<string, ApprovalRequestView['decisions']>();
    for (const { requestId, decision, ...details } of decisions) {
      const group = decisionsByRequest.get(requestId) ?? [];
      group.push({ ...details, decision: toDecision(decision) });
      decisionsByRequest.set(requestId, group);
    }
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      requestedBy: row.requestedBy,
      status: toStatus(row.status),
      requiredApprovals: row.requiredApprovals,
      approverRoles: row.approverRoles,
      selfApproval: row.selfApproval,
      context: (row.contextJson ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
      executedAt: row.executedAt,
      decisions: decisionsByRequest.get(row.id) ?? [],
    }));
  }

  async createRequest(ctx: WorkspaceContext, actorId: string, input: CreateApprovalRequestInput) {
    const requestId = await this.db.transaction(async (tx) => {
      await this.lockWorkspace(tx, ctx.workspaceId);
      const [asset] = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, input.resourceId),
            eq(assets.workspaceId, ctx.workspaceId),
            isNull(assets.deletedAt),
          ),
        )
        .limit(1);
      if (!asset) throw httpCode(HttpStatus.NOT_FOUND, 'Asset not found', 'ASSET_NOT_FOUND');
      const [rule] = await tx
        .select()
        .from(workflowRules)
        .where(and(eq(workflowRules.workspaceId, ctx.workspaceId), eq(workflowRules.action, input.action)))
        .limit(1);
      if (!rule) {
        throw httpCode(
          HttpStatus.BAD_REQUEST,
          `No approval workflow is configured for '${input.action}'`,
          'NO_APPROVAL_WORKFLOW',
        );
      }
      const [existing] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.workspaceId, ctx.workspaceId),
            eq(approvalRequests.action, input.action),
            eq(approvalRequests.resourceType, input.resourceType),
            eq(approvalRequests.resourceId, input.resourceId),
            inArray(approvalRequests.status, ['pending', 'approved']),
          ),
        )
        .limit(1);
      if (existing) {
        throw httpCode(
          HttpStatus.CONFLICT,
          'An active approval request already exists',
          'APPROVAL_ALREADY_REQUESTED',
        );
      }
      const [created] = await tx
        .insert(approvalRequests)
        .values({
          workspaceId: ctx.workspaceId,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          requestedBy: actorId,
          status: 'pending',
          requiredApprovals: rule.requiredApprovals,
          approverRoles: rule.approverRoles,
          selfApproval: rule.selfApproval,
          contextJson: input.context,
        })
        .returning({ id: approvalRequests.id });
      if (!created) {
        throw httpCode(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'Could not create the approval request',
          'APPROVAL_FAILED',
        );
      }
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'approval.requested',
        resource: 'approval_request',
        resourceId: created.id,
        metadata: {
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
        },
      });
      return created.id;
    });
    return this.getRequest(ctx, requestId);
  }

  async decide(ctx: WorkspaceContext, actorId: string, requestId: string, input: DecideApprovalInput) {
    if (ctx.role === 'automation') {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'API tokens cannot decide approvals; a human approver must act',
        'APPROVAL_HUMAN_REQUIRED',
      );
    }
    await this.db.transaction(async (tx) => {
      // Lock the request so two concurrent decisions cannot both miss the quorum.
      const [locked] = await tx
        .select()
        .from(approvalRequests)
        .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.workspaceId, ctx.workspaceId)))
        .for('update');
      if (!locked) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Approval request not found', 'APPROVAL_NOT_FOUND');
      }
      if (locked.status !== 'pending') {
        throw httpCode(
          HttpStatus.CONFLICT,
          'This approval request is no longer pending',
          'APPROVAL_NOT_PENDING',
        );
      }
      if (!locked.approverRoles.includes(ctx.role)) {
        throw httpCode(
          HttpStatus.FORBIDDEN,
          'Your role is not an eligible approver for this request',
          'APPROVAL_FORBIDDEN',
        );
      }
      if (!canSelfApprove(locked.selfApproval, locked.requestedBy ?? '', actorId)) {
        throw httpCode(
          HttpStatus.FORBIDDEN,
          'You cannot approve your own request under this workflow',
          'SELF_APPROVAL_FORBIDDEN',
        );
      }

      const [decision] = await tx
        .insert(approvalDecisions)
        .values({
          requestId,
          actorId,
          decision: input.decision,
          note: input.note ?? null,
        })
        .onConflictDoNothing({ target: [approvalDecisions.requestId, approvalDecisions.actorId] })
        .returning({ id: approvalDecisions.id });
      if (!decision) {
        throw httpCode(
          HttpStatus.CONFLICT,
          'You have already decided this request',
          'APPROVAL_ALREADY_DECIDED',
        );
      }

      const decisions = await tx
        .select({ decision: approvalDecisions.decision })
        .from(approvalDecisions)
        .where(eq(approvalDecisions.requestId, requestId));
      const approvals = decisions.filter((row) => row.decision === 'approved').length;
      const rejections = decisions.filter((row) => row.decision === 'rejected').length;
      const nextStatus: ApprovalStatus =
        rejections > 0
          ? 'rejected'
          : isApprovalQuorumMet(approvals, locked.requiredApprovals)
            ? 'approved'
            : 'pending';

      await tx
        .update(approvalRequests)
        .set({
          status: nextStatus,
          updatedAt: new Date(),
          decidedAt: nextStatus === 'pending' ? null : new Date(),
        })
        .where(eq(approvalRequests.id, requestId));

      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'approval.decided',
        resource: 'approval_request',
        resourceId: requestId,
        metadata: {
          decision: input.decision,
          status: nextStatus,
          approvals,
          required: locked.requiredApprovals,
        },
      });
    });
    return this.getRequest(ctx, requestId);
  }

  async cancel(ctx: WorkspaceContext, actorId: string, requestId: string) {
    const request = await this.getRequest(ctx, requestId);
    if (request.status !== 'pending') {
      throw httpCode(HttpStatus.CONFLICT, 'Only a pending request can be cancelled', 'APPROVAL_NOT_PENDING');
    }
    const isRequester = request.requestedBy === actorId;
    const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';
    if (!isRequester && !isAdmin) {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Only the requester or a workspace owner/admin can cancel a request',
        'INSUFFICIENT_SCOPE',
      );
    }
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(approvalRequests)
        .set({ status: 'cancelled', updatedAt: new Date(), decidedAt: new Date() })
        .where(
          and(
            eq(approvalRequests.id, requestId),
            eq(approvalRequests.workspaceId, ctx.workspaceId),
            eq(approvalRequests.status, 'pending'),
          ),
        )
        .returning({ id: approvalRequests.id });
      if (!updated) {
        throw httpCode(
          HttpStatus.CONFLICT,
          'Only a pending request can be cancelled',
          'APPROVAL_NOT_PENDING',
        );
      }
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'approval.cancelled',
        resource: 'approval_request',
        resourceId: requestId,
      });
    });
    return this.getRequest(ctx, requestId);
  }

  /**
   * Returns the id of an approved, not-yet-executed request for this action and
   * resource, or `null` when no workflow rule exists for the action. Throws
   * `409 APPROVAL_REQUIRED` when a rule exists but no approved request does.
   */
  async assertApproved(
    executor: ApprovalExecutor,
    ctx: WorkspaceContext,
    action: WorkflowAction,
    resourceType: string,
    resourceId: string | null,
  ): Promise<string | null> {
    await this.lockWorkspace(executor, ctx.workspaceId);
    const [rule] = await executor
      .select({ id: workflowRules.id })
      .from(workflowRules)
      .where(and(eq(workflowRules.workspaceId, ctx.workspaceId), eq(workflowRules.action, action)))
      .limit(1);
    if (!rule) return null;

    const [request] = await executor
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.workspaceId, ctx.workspaceId),
          eq(approvalRequests.action, action),
          eq(approvalRequests.resourceType, resourceType),
          resourceId === null
            ? isNull(approvalRequests.resourceId)
            : eq(approvalRequests.resourceId, resourceId),
          eq(approvalRequests.status, 'approved'),
        ),
      )
      .limit(1);
    if (!request) {
      throw httpCode(
        HttpStatus.CONFLICT,
        `This action requires an approved request for '${action}'`,
        'APPROVAL_REQUIRED',
      );
    }
    return request.id;
  }

  /** Mark an approved request as executed (call inside the action's transaction). */
  async consume(executor: ApprovalExecutor, requestId: string): Promise<void> {
    const [request] = await executor
      .update(approvalRequests)
      .set({ status: 'executed', executedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, 'approved')))
      .returning({ id: approvalRequests.id });
    if (!request) {
      throw httpCode(HttpStatus.CONFLICT, 'An approved request is required', 'APPROVAL_REQUIRED');
    }
  }
}
