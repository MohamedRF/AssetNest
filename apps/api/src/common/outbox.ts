import type { Database } from '@assetnest/db';
import { outboxEvents } from '@assetnest/db';

export interface OutboxEntry {
  workspaceId: string;
  kind: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Transactional outbox — must be called INSIDE the same transaction that
 * mutates aggregate state, so the event and the change commit or roll back
 * together. Payloads are minimal (opaque ids + schemaVersion); webhook/email
 * consumers fetch details from the read side if they need them.
 */
export async function writeOutboxEvent(tx: Tx, entry: OutboxEntry): Promise<void> {
  await tx.insert(outboxEvents).values({
    workspaceId: entry.workspaceId,
    kind: entry.kind,
    aggregateId: entry.aggregateId,
    payloadJson: { ...entry.payload, schemaVersion: 1 },
    schemaVersion: 1,
  });
}
