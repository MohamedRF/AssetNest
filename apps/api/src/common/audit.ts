import { randomUUID } from 'node:crypto';
import { auditLog } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { CorrelationContext } from './correlation.middleware.js';

export interface AuditEntry {
  workspaceId: string;
  actorId: string | null;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only workspace audit trail. Never put secrets, tokens or document
 * contents into `metadata` — it is stored in plain text and shown on the
 * audit-log screen.
 */
/** Structural subset — satisfied by both Database and a transaction handle. */
type AuditDb = Pick<Database, 'insert'>;

export async function writeAuditLog(db: AuditDb, entry: AuditEntry): Promise<void> {
  const correlationId = CorrelationContext.getRequestId() ?? randomUUID();
  await db.insert(auditLog).values({
    workspaceId: entry.workspaceId,
    actorId: entry.actorId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    metadataJson: { ...entry.metadata, correlationId },
  });
}
