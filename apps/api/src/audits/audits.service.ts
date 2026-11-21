import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { assets, locations, auditItems, auditSessions } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { writeOutboxEvent } from '../common/outbox.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type { CreateAuditInput, VerifyItemInput, CloseAuditInput } from './dto.js';

export type Observation = 'unobserved' | 'present' | 'missing' | 'moved' | 'extra';

@Injectable()
export class AuditsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(ctx: WorkspaceContext) {
    return this.db
      .select({
        id: auditSessions.id,
        label: auditSessions.label,
        status: auditSessions.status,
        scopeJson: auditSessions.scopeJson,
        openedAt: auditSessions.openedAt,
        closedAt: auditSessions.closedAt,
      })
      .from(auditSessions)
      .where(eq(auditSessions.workspaceId, ctx.workspaceId))
      .orderBy(desc(auditSessions.openedAt));
  }

  /** Opens a session and pre-creates one audit_item per in-scope active asset (snapshot at open time). */
  async create(ctx: WorkspaceContext, actorId: string, input: CreateAuditInput) {
    const scopeFilters = [eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)];
    if (input.scope.locationId) {
      scopeFilters.push(eq(assets.locationId, input.scope.locationId));
    }
    if (input.scope.categoryId) {
      scopeFilters.push(eq(assets.categoryId, input.scope.categoryId));
    }

    const created = await this.db.transaction(async (tx) => {
      const scopeJson = Object.fromEntries(
        Object.entries(input.scope).filter(([, value]) => value !== undefined),
      );
      const [session] = await tx
        .insert(auditSessions)
        .values({
          workspaceId: ctx.workspaceId,
          label: input.label,
          scopeJson,
          status: 'open',
          openedBy: actorId,
        })
        .returning();
      if (!session) {
        throw new Error('audit session insert returned no row');
      }
      const inScope = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(...scopeFilters));
      if (inScope.length > 0) {
        await tx.insert(auditItems).values(
          inScope.map((asset) => ({
            workspaceId: ctx.workspaceId,
            auditId: session.id,
            assetId: asset.id,
          })),
        );
      }
      await writeOutboxEvent(tx, {
        workspaceId: ctx.workspaceId,
        kind: 'audit.opened',
        aggregateId: session.id,
        payload: { label: input.label, assetCount: inScope.length },
      });
      return session;
    });

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'audit.opened',
      resource: 'audit_session',
      resourceId: created.id,
      metadata: { label: created.label, scope: created.scopeJson },
    });
    return this.get(ctx, created.id);
  }

  async get(ctx: WorkspaceContext, auditId: string) {
    const [session] = await this.db
      .select()
      .from(auditSessions)
      .where(and(eq(auditSessions.id, auditId), eq(auditSessions.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!session) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Audit session not found', 'AUDIT_NOT_FOUND');
    }
    const items = await this.db
      .select({
        id: auditItems.id,
        assetId: auditItems.assetId,
        assetTag: assets.assetTag,
        displayName: assets.displayName,
        observation: auditItems.observation,
        observedLocationId: auditItems.observedLocationId,
        observedAt: auditItems.observedAt,
        notes: auditItems.notes,
      })
      .from(auditItems)
      .innerJoin(assets, eq(assets.id, auditItems.assetId))
      .where(and(eq(auditItems.workspaceId, ctx.workspaceId), eq(auditItems.auditId, auditId)))
      .orderBy(asc(auditItems.observation), asc(assets.assetTag));

    const counts = { total: items.length, unobserved: 0, present: 0, missing: 0, moved: 0, extra: 0 };
    for (const item of items) {
      counts[item.observation as Observation] += 1;
    }
    return { ...session, items, counts };
  }

  async verify(ctx: WorkspaceContext, actorId: string, auditId: string, input: VerifyItemInput) {
    // Lock the audit session row for the whole verify so it is serialized
    // against close(): once a close commits (flipping status to 'closed'), a
    // concurrent or subsequent verify sees the closed session and is rejected —
    // a closed audit can never accept a late observation.
    return this.db.transaction(async (tx) => {
      const [session] = await tx
        .select({ status: auditSessions.status })
        .from(auditSessions)
        .where(and(eq(auditSessions.id, auditId), eq(auditSessions.workspaceId, ctx.workspaceId)))
        .limit(1)
        .for('update');
      if (!session) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Audit session not found', 'AUDIT_NOT_FOUND');
      }
      if (session.status === 'closed') {
        throw httpCode(
          HttpStatus.CONFLICT,
          'Audit session is closed and can no longer be modified',
          'AUDIT_CLOSED',
        );
      }

      // The item must belong to this audit; the asset must exist in the workspace.
      const [item] = await tx
        .select({ id: auditItems.id, observation: auditItems.observation })
        .from(auditItems)
        .where(and(eq(auditItems.auditId, auditId), eq(auditItems.assetId, input.assetId)))
        .limit(1);
      if (!item) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Asset is not part of this audit scope', 'AUDIT_ITEM_NOT_FOUND');
      }
      if (input.observedLocationId) {
        const [location] = await tx
          .select({ id: locations.id })
          .from(locations)
          .where(and(eq(locations.id, input.observedLocationId), eq(locations.workspaceId, ctx.workspaceId)))
          .limit(1);
        if (!location) {
          throw httpCode(HttpStatus.NOT_FOUND, 'Location not found in this workspace', 'LOCATION_NOT_FOUND');
        }
      }

      const [updated] = await tx
        .update(auditItems)
        .set({
          observation: input.observation,
          observedLocationId: input.observedLocationId ?? null,
          observedBy: actorId,
          observedAt: new Date(),
          notes: input.notes ?? null,
        })
        .where(eq(auditItems.id, item.id))
        .returning();
      // Immutable resolution history = the audit log trail (never rewritten).
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'audit.item_verified',
        resource: 'audit_item',
        resourceId: item.id,
        metadata: { auditId, assetId: input.assetId, from: item.observation, to: input.observation },
      });
      return updated;
    });
  }

  async close(ctx: WorkspaceContext, actorId: string, auditId: string, input: CloseAuditInput) {
    return this.db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(auditSessions)
        .where(and(eq(auditSessions.id, auditId), eq(auditSessions.workspaceId, ctx.workspaceId)))
        .limit(1)
        .for('update');
      if (!session) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Audit session not found', 'AUDIT_NOT_FOUND');
      }
      if (session.status === 'closed') {
        throw httpCode(HttpStatus.CONFLICT, 'Audit session is already closed', 'AUDIT_CLOSED');
      }
      const [closed] = await tx
        .update(auditSessions)
        .set({ status: 'closed', closedBy: actorId, closedAt: new Date() })
        .where(eq(auditSessions.id, auditId))
        .returning();

      const items = await tx
        .select({ observation: auditItems.observation })
        .from(auditItems)
        .where(eq(auditItems.auditId, auditId));
      const summary = { total: items.length, unobserved: 0, present: 0, missing: 0, moved: 0, extra: 0 };
      for (const item of items) {
        summary[item.observation as Observation] += 1;
      }

      await writeOutboxEvent(tx, {
        workspaceId: ctx.workspaceId,
        kind: 'audit.closed',
        aggregateId: auditId,
        payload: { label: session.label, ...summary },
      });
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'audit.closed',
        resource: 'audit_session',
        resourceId: auditId,
        metadata: { summary, notes: input.notes ?? null },
      });
      return closed;
    });
  }
}
