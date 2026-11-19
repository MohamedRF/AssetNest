import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as schema from '@assetnest/db/schema';
import type { Database } from '@assetnest/db';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles } from '@assetnest/db';
import type { EmailTransport, MailMessage } from './email.js';
import { deliverOutboxEvent } from './consumer.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../packages/db/migrations');

let client: PGlite;
let db: Database;

class RecordingTransport implements EmailTransport {
  readonly kind = 'recording';
  readonly messages: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const testConfig: AppConfig = loadConfig({
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'https://assets.example.com',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-worker-test',
  SESSION_SECRET: 'test-secret-that-is-long-enough-to-be-safe-0000',
  ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
  MAIL_TRANSPORT: 'log',
});

async function seedWorkspaceWithMembers() {
  const workspaceId = crypto.randomUUID();
  await db.execute(
    sql`insert into workspaces (id, name, mode, slug) values (${workspaceId}, 'Mail WS', 'office', ${`mail-${workspaceId.slice(0, 8)}`})`,
  );
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await db.execute(
    sql`insert into users (id, email, display_name, password_hash)
        values (${ownerId}, 'owner@mail.test', 'Owner', 'hash'), (${memberId}, 'member@mail.test', 'Member', 'hash')`,
  );
  await db.execute(
    sql`insert into memberships (workspace_id, user_id, role_key, status)
        values (${workspaceId}, ${ownerId}, 'owner', 'active'), (${workspaceId}, ${memberId}, 'member', 'active')`,
  );
  const membershipRows = await db.execute<{ id: string; user_id: string; role_key: string }>(
    sql`select id, user_id, role_key from memberships where workspace_id = ${workspaceId}`,
  );
  const membershipByUser = new Map(membershipRows.rows.map((row) => [row.user_id, row.id]));
  return {
    workspaceId,
    ownerId,
    memberId,
    ownerMembershipId: membershipByUser.get(ownerId)!,
    memberMembershipId: membershipByUser.get(memberId)!,
  };
}

async function insertOutboxEvent(workspaceId: string, kind: string) {
  const id = crypto.randomUUID();
  await db.execute(
    sql`insert into outbox_events (id, workspace_id, kind, aggregate_id, payload_json)
        values (${id}, ${workspaceId}, ${kind}, ${crypto.randomUUID()}, ${JSON.stringify({ assetTag: 'MAIL-0001', schemaVersion: 1 })}::jsonb)`,
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
  await db.execute(
    sql`truncate notification_deliveries, notification_preferences, outbox_events, memberships, users, workspaces cascade`,
  );
  await seedRoles(db);
});

afterAll(async () => {
  await client?.close();
});

describe('preference-aware email delivery', () => {
  it('sends to all active members and records sent deliveries', async () => {
    const { workspaceId } = await seedWorkspaceWithMembers();
    const eventId = await insertOutboxEvent(workspaceId, 'asset.created');
    const transport = new RecordingTransport();

    const summary = await deliverOutboxEvent(
      db,
      {
        id: eventId,
        workspaceId,
        kind: 'asset.created',
        aggregateId: crypto.randomUUID(),
        payloadJson: { assetTag: 'MAIL-0001', schemaVersion: 1 },
      },
      transport,
      testConfig,
    );

    expect(summary.emailSent).toBe(2);
    expect(summary.log).toBe('sent');
    expect(transport.messages.map((m) => m.to).sort()).toEqual(['member@mail.test', 'owner@mail.test']);
    expect(transport.messages[0]!.subject).toContain('MAIL-0001');

    const rows = await db.execute<{ status: string }>(
      sql`select status from notification_deliveries where event_key = ${eventId} and channel = 'email'`,
    );
    expect(rows.rows.map((r) => r.status).sort()).toEqual(['sent', 'sent']);
  });

  it('honors email opt-out via notification_preferences (opt-out model)', async () => {
    const { workspaceId, memberMembershipId } = await seedWorkspaceWithMembers();
    await db.execute(
      sql`insert into notification_preferences (workspace_id, member_id, channel, event, enabled)
          values (${workspaceId}, ${memberMembershipId}, 'email', 'asset.created', false)`,
    );
    const eventId = await insertOutboxEvent(workspaceId, 'asset.created');
    const transport = new RecordingTransport();

    const summary = await deliverOutboxEvent(
      db,
      {
        id: eventId,
        workspaceId,
        kind: 'asset.created',
        aggregateId: crypto.randomUUID(),
        payloadJson: { assetTag: 'MAIL-0001', schemaVersion: 1 },
      },
      transport,
      testConfig,
    );

    expect(summary.emailSent).toBe(1);
    expect(summary.emailSkipped).toBe(1);
    expect(transport.messages.map((m) => m.to)).toEqual(['owner@mail.test']);

    const skipped = await db.execute<{ status: string }>(
      sql`select status from notification_deliveries where event_key = ${eventId} and recipient = 'member@mail.test' and channel = 'email'`,
    );
    expect(skipped.rows[0]?.status).toBe('skipped');
  });

  it('never re-sends on retry — claimed rows are final', async () => {
    const { workspaceId } = await seedWorkspaceWithMembers();
    const eventId = await insertOutboxEvent(workspaceId, 'asset.assigned');
    const transport = new RecordingTransport();
    const event = {
      id: eventId,
      workspaceId,
      kind: 'asset.assigned',
      aggregateId: crypto.randomUUID(),
      payloadJson: { assetTag: 'MAIL-0001', schemaVersion: 1 },
    };

    await deliverOutboxEvent(db, event, transport, testConfig);
    expect(transport.messages).toHaveLength(2);

    const second = await deliverOutboxEvent(db, event, transport, testConfig);
    expect(second.emailSent).toBe(0);
    expect(second.emailSkipped).toBe(2);
    expect(transport.messages).toHaveLength(2); // no duplicates on the wire
  });
});
