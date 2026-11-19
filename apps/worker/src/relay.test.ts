import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as schema from '@assetnest/db/schema';
import type { Database } from '@assetnest/db';
import { drainOnce, type QueueLike } from './relay.js';
import { deliverNotificationLog } from './consumer.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../packages/db/migrations');

let client: PGlite;
let db: Database;

class FakeQueue implements QueueLike {
  readonly jobs: Array<{ name: string; data: unknown; opts?: unknown }> = [];
  failNext = false;

  async add(name: string, data: unknown, opts?: { jobId?: string }): Promise<{ id: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('queue unavailable');
    }
    this.jobs.push({ name, data, opts });
    return { id: String((data as { eventId?: string }).eventId ?? 'job') };
  }
}

async function freshFixture() {
  const workspaceId = crypto.randomUUID();
  await db.execute(
    sql`insert into workspaces (id, name, mode, slug) values (${workspaceId}, 'Worker Test WS', 'office', ${`ws-${workspaceId.slice(0, 8)}`})`,
  );
  return workspaceId;
}

async function insertOutboxEvent(workspaceId: string, kind = 'asset.assigned') {
  const id = crypto.randomUUID();
  await db.execute(
    sql`insert into outbox_events (id, workspace_id, kind, aggregate_id, payload_json)
        values (${id}, ${workspaceId}, ${kind}, ${crypto.randomUUID()}, ${JSON.stringify({ schemaVersion: 1 })}::jsonb)`,
  );
  return id;
}

beforeEach(async () => {
  if (!client) {
    client = new PGlite();
    const pgliteDb = drizzle(client, { schema });
    await migrate(pgliteDb, { migrationsFolder });
    db = pgliteDb as unknown as Database;
  }
  await db.execute(sql`truncate outbox_events`);
  await db.execute(sql`truncate notification_deliveries`);
});

afterAll(async () => {
  await client?.close();
});

describe('outbox relay (drainOnce)', () => {
  it('publishes unpublished events and marks them published', async () => {
    const workspaceId = await freshFixture();
    const eventId = await insertOutboxEvent(workspaceId);
    const queue = new FakeQueue();

    const result = await drainOnce(db, queue);
    expect(result.published).toBe(1);
    expect(result.failed).toBe(0);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]!.opts).toMatchObject({ jobId: eventId });

    const row = await db.execute<{ published_at: Date | null }>(
      sql`select published_at from outbox_events where id = ${eventId}`,
    );
    expect(row.rows[0]?.published_at).not.toBeNull();

    // Second drain is a no-op — event is already published.
    const again = await drainOnce(db, queue);
    expect(again.published).toBe(0);
    expect(queue.jobs).toHaveLength(1);
  });

  it('records attempts and last_error when the queue is down, without publishing', async () => {
    const workspaceId = await freshFixture();
    const eventId = await insertOutboxEvent(workspaceId);
    const queue = new FakeQueue();
    queue.failNext = true;

    const result = await drainOnce(db, queue, { maxAttempts: 8 });
    expect(result.failed).toBe(1);
    expect(result.published).toBe(0);

    const row = await db.execute<{ attempts: number; last_error: string | null; published_at: Date | null }>(
      sql`select attempts, last_error, published_at from outbox_events where id = ${eventId}`,
    );
    expect(row.rows[0]?.attempts).toBe(1);
    expect(row.rows[0]?.last_error).toContain('queue unavailable');
    expect(row.rows[0]?.published_at).toBeNull();
  });

  it('stops attempting after maxAttempts (dead-letter behaviour)', async () => {
    const workspaceId = await freshFixture();
    const eventId = await insertOutboxEvent(workspaceId);
    await db.execute(sql`update outbox_events set attempts = 8 where id = ${eventId}`);
    const queue = new FakeQueue();

    const result = await drainOnce(db, queue, { maxAttempts: 8 });
    expect(result.published).toBe(0);
    expect(queue.jobs).toHaveLength(0);
  });
});

describe('notification delivery (deliverNotificationLog)', () => {
  it('inserts a delivery once and reports skipped on retry (idempotent)', async () => {
    const workspaceId = await freshFixture();
    const eventId = await insertOutboxEvent(workspaceId);
    const event = {
      id: eventId,
      workspaceId,
      kind: 'asset.assigned',
      aggregateId: crypto.randomUUID(),
      payloadJson: { schemaVersion: 1 },
    };

    const first = await deliverNotificationLog(db, event);
    expect(first.outcome).toBe('sent');

    const second = await deliverNotificationLog(db, event);
    expect(second.outcome).toBe('skipped');

    const rows = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from notification_deliveries where event_key = ${eventId}`,
    );
    expect(Number(rows.rows[0]!.count)).toBe(1);
  });
});
