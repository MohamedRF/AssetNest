import { sql } from 'drizzle-orm';
import type { Database } from '@assetnest/db';

export interface QueueLike {
  add(
    name: string,
    data: unknown,
    opts?: { jobId?: string; attempts?: number; backoff?: { type: 'exponential'; delay: number } },
  ): Promise<unknown>;
}

export interface RelayOptions {
  batchSize?: number;
  maxAttempts?: number;
}

export interface RelayResult {
  published: number;
  failed: number;
}

interface OutboxRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  kind: string;
  aggregate_id: string;
  payload_json: Record<string, unknown>;
  schema_version: number;
  attempts: number;
}

/**
 * Transactional outbox relay. Polls unpublished rows with SELECT ... FOR UPDATE
 * SKIP LOCKED, hands each to the queue, stamps published_at in the same
 * transaction. BullMQ jobId = event id, so a re-publish after a crash is
 * deduplicated rather than delivered twice.
 */
export async function drainOnce(
  db: Database,
  queue: QueueLike,
  opts: RelayOptions = {},
): Promise<RelayResult> {
  const batchSize = opts.batchSize ?? 25;
  const maxAttempts = opts.maxAttempts ?? 8;

  return db.transaction(async (tx) => {
    const result = await tx.execute<OutboxRow>(
      sql`select id, workspace_id, kind, aggregate_id, payload_json, schema_version, attempts
          from outbox_events
          where published_at is null and attempts < ${maxAttempts}
          order by occurred_at
          limit ${batchSize}
          for update skip locked`,
    );

    let published = 0;
    let failed = 0;
    for (const row of result.rows) {
      try {
        await queue.add(
          row.kind,
          {
            eventId: row.id,
            workspaceId: row.workspace_id,
            aggregateId: row.aggregate_id,
            ...row.payload_json,
          },
          { jobId: row.id, attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
        );
        await tx.execute(
          sql`update outbox_events set published_at = now(), locked_at = null where id = ${row.id}`,
        );
        published += 1;
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
        await tx.execute(
          sql`update outbox_events set attempts = attempts + 1, last_error = ${message}, locked_at = now() where id = ${row.id}`,
        );
        failed += 1;
      }
    }
    return { published, failed };
  });
}
