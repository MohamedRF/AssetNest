import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { workspaces, auditLog } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { auditRetentionCutoff, type ExportPolicy } from '@assetnest/domain';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { parseExportPolicy, type AuditRetentionInput, type ExportPolicyInput } from './dto.js';

export interface WorkspacePolicies {
  /** null = retain indefinitely. */
  auditRetentionDays: number | null;
  exportPolicy: ExportPolicy;
}

export interface AuditPruneResult {
  /** null when retention is indefinite (nothing to prune). */
  cutoff: string | null;
  deleted: number;
}

/**
 * Workspace-scoped retention and export policy. Every operation is keyed on
 * `ctx.workspaceId`; no method can read or mutate another tenant's policy.
 */
@Injectable()
export class PoliciesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get(ctx: WorkspaceContext): Promise<WorkspacePolicies> {
    const [row] = await this.db
      .select({
        auditRetentionDays: workspaces.auditRetentionDays,
        exportPolicyJson: workspaces.exportPolicyJson,
      })
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId))
      .limit(1);
    if (!row) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
    }
    return {
      auditRetentionDays: row.auditRetentionDays ?? null,
      exportPolicy: parseExportPolicy(row.exportPolicyJson),
    };
  }

  /** Export policy only — used by ExportsService on every generate/list/download. */
  async getExportPolicy(ctx: WorkspaceContext): Promise<ExportPolicy> {
    const [row] = await this.db
      .select({ exportPolicyJson: workspaces.exportPolicyJson })
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId))
      .limit(1);
    if (!row) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
    }
    return parseExportPolicy(row.exportPolicyJson);
  }

  async setAuditRetention(
    ctx: WorkspaceContext,
    actorId: string,
    input: AuditRetentionInput,
  ): Promise<WorkspacePolicies> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(workspaces)
        .set({ auditRetentionDays: input.retentionDays })
        .where(eq(workspaces.id, ctx.workspaceId))
        .returning({ id: workspaces.id });
      if (!updated) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
      }
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'audit.retention_updated',
        resource: 'workspace',
        resourceId: ctx.workspaceId,
        metadata: { retentionDays: input.retentionDays },
      });
    });
    return this.get(ctx);
  }

  async setExportPolicy(
    ctx: WorkspaceContext,
    actorId: string,
    input: ExportPolicyInput,
  ): Promise<WorkspacePolicies> {
    const policy: ExportPolicy = { enabled: input.enabled, maxAgeDays: input.maxAgeDays };
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(workspaces)
        .set({ exportPolicyJson: policy })
        .where(eq(workspaces.id, ctx.workspaceId))
        .returning({ id: workspaces.id });
      if (!updated) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
      }
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'export.policy_updated',
        resource: 'workspace',
        resourceId: ctx.workspaceId,
        metadata: { ...policy },
      });
    });
    return this.get(ctx);
  }

  /**
   * Delete audit rows for THIS workspace older than its retention cutoff.
   * `NULL` retention is a no-op. The delete and its own audit row share one
   * transaction, so a prune is never applied without an audit record.
   * `now` is injectable for deterministic boundary tests.
   */
  async pruneAuditLog(
    ctx: WorkspaceContext,
    actorId: string,
    now: Date = new Date(),
  ): Promise<AuditPruneResult> {
    return this.db.transaction(async (tx) => {
      const [workspace] = await tx
        .select({ auditRetentionDays: workspaces.auditRetentionDays })
        .from(workspaces)
        .where(eq(workspaces.id, ctx.workspaceId))
        .for('update');
      if (!workspace) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
      }
      const { auditRetentionDays } = workspace;
      const cutoff = auditRetentionCutoff(auditRetentionDays, now);
      if (!cutoff) return { cutoff: null, deleted: 0 };
      const deletedRows = await tx
        .delete(auditLog)
        .where(and(eq(auditLog.workspaceId, ctx.workspaceId), lt(auditLog.occurredAt, cutoff)))
        .returning({ id: auditLog.id });
      const deleted = deletedRows.length;
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'audit.retention_pruned',
        resource: 'audit_log',
        metadata: { cutoff: cutoff.toISOString(), deleted, retentionDays: auditRetentionDays },
      });
      return { cutoff: cutoff.toISOString(), deleted };
    });
  }
}
