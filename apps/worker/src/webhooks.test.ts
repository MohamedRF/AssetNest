import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '@assetnest/db/schema';
import type { Database } from '@assetnest/db';
import { seedRoles, encryptSecret } from '@assetnest/db';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { deliverWebhooks, signBody } from './webhooks.js';
import type { OutboxEventLike } from './templates.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../packages/db/migrations');

let client: PGlite;
let db: Database;
let receiver: Server;
let receiverPort = 0;
const received: Array<{ method: string; headers: IncomingMessage['headers']; body: string }> = [];
let receiverBehavior: 'ok' | 'fail' = 'ok';

const ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
const SECRET = 'test-webhook-secret-32-bytes-long-aaaaaaaa';

const testConfig: AppConfig = loadConfig({
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'https://assets.example.com',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-webhooks-test',
  SESSION_SECRET: 'test-secret-that-is-long-enough-to-be-safe-0000',
  ENCRYPTION_KEY,
  MAIL_TRANSPORT: 'log',
  WEBHOOKS_ALLOW_PRIVATE: 'true', // tests use a local receiver — explicitly allowed
});

const strictConfig: AppConfig = loadConfig({
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'https://assets.example.com',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-webhooks-test',
  SESSION_SECRET: 'test-secret-that-is-long-enough-to-be-safe-0000',
  ENCRYPTION_KEY,
  MAIL_TRANSPORT: 'log',
  WEBHOOKS_ALLOW_PRIVATE: 'false', // default: private destinations must be rejected
});

async function freshWorkspace(): Promise<string> {
  const workspaceId = crypto.randomUUID();
  await db.execute(
    sql`insert into workspaces (id, name, mode, slug) values (${workspaceId}, 'Webhook WS', 'office', ${`wh-${workspaceId.slice(0, 8)}`})`,
  );
  return workspaceId;
}

async function insertSubscription(workspaceId: string, url: string, eventTypes: string[]): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute(
    sql`insert into webhook_subscriptions (id, workspace_id, url, secret_ciphertext, event_types, active)
        values (${id}, ${workspaceId}, ${url}, ${encryptSecret(SECRET, ENCRYPTION_KEY)}, ${JSON.stringify(eventTypes)}::jsonb, true)`,
  );
  return id;
}

beforeAll(async () => {
  client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder });
  db = pgliteDb as unknown as Database;

  receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ method: req.method ?? 'GET', headers: req.headers, body });
      if (receiverBehavior === 'fail') {
        res.writeHead(500).end('boom');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
  });
  await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', done));
  receiverPort = (receiver.address() as { port: number }).port;
}, 90_000);

afterAll(async () => {
  await new Promise<void>((done) => receiver.close(() => done()));
  await client?.close();
});

beforeEach(async () => {
  received.length = 0;
  receiverBehavior = 'ok';
  // NB: cascade wipe also clears roles (roles.workspace_id → workspaces), so re-seed after.
  await db.execute(
    sql`truncate webhook_deliveries, webhook_subscriptions, outbox_events, memberships, users, workspaces cascade`,
  );
  await seedRoles(db);
});

describe('signed outbound webhooks (real HTTP receiver)', () => {
  it('delivers a signed payload and records a delivered delivery', async () => {
    const workspaceId = await freshWorkspace();
    const url = `http://127.0.0.1:${receiverPort}/hook`;
    const subscriptionId = await insertSubscription(workspaceId, url, ['asset.created']);

    const event: OutboxEventLike = {
      id: crypto.randomUUID(),
      workspaceId,
      kind: 'asset.created',
      aggregateId: crypto.randomUUID(),
      payloadJson: { assetTag: 'WH-0001', occurredAt: '2026-11-19T10:00:00.000Z' },
    };

    const summary = await deliverWebhooks(db, event, testConfig);
    expect(summary).toEqual({ delivered: 1, skipped: 0, failed: 0 });

    expect(received).toHaveLength(1);
    const request = received[0]!;
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers['x-assetnest-event']).toBe('asset.created');
    expect(request.headers['x-assetnest-delivery']).toBe(event.id);

    const signature = String(request.headers['x-assetnest-signature']);
    const match = signature.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    expect(match).not.toBeNull();
    const [, timestamp, digest] = match!;
    expect(digest).toBe(signBody(SECRET, Number(timestamp), request.body));

    const payload = JSON.parse(request.body) as Record<string, unknown>;
    expect(payload['kind']).toBe('asset.created');
    expect((payload['payload'] as Record<string, unknown>)['assetTag']).toBe('WH-0001');

    const rows = await db.execute<{ status: string; response_code: number | null }>(
      sql`select status, response_code from webhook_deliveries where subscription_id = ${subscriptionId}`,
    );
    expect(rows.rows[0]).toMatchObject({ status: 'delivered', response_code: 200 });
  });

  it('dedupes re-deliveries of the same event (delivered rows are terminal)', async () => {
    const workspaceId = await freshWorkspace();
    const url = `http://127.0.0.1:${receiverPort}/hook`;
    await insertSubscription(workspaceId, url, ['asset.created']);

    const event: OutboxEventLike = {
      id: crypto.randomUUID(),
      workspaceId,
      kind: 'asset.created',
      aggregateId: crypto.randomUUID(),
      payloadJson: { occurredAt: '2026-11-19T10:00:00.000Z' },
    };

    await deliverWebhooks(db, event, testConfig);
    const again = await deliverWebhooks(db, event, testConfig);
    expect(again).toEqual({ delivered: 0, skipped: 1, failed: 0 });
    expect(received).toHaveLength(1); // only one actual HTTP call ever happened
  });

  it('throws for transient 5xx failures so BullMQ retries, and records the attempt', async () => {
    const workspaceId = await freshWorkspace();
    const url = `http://127.0.0.1:${receiverPort}/hook`;
    receiverBehavior = 'fail';
    const subscriptionId = await insertSubscription(workspaceId, url, ['asset.created']);

    const event: OutboxEventLike = {
      id: crypto.randomUUID(),
      workspaceId,
      kind: 'asset.created',
      aggregateId: crypto.randomUUID(),
      payloadJson: { occurredAt: '2026-11-19T10:00:00.000Z' },
    };

    await expect(deliverWebhooks(db, event, testConfig)).rejects.toThrow(
      /Transient webhook delivery failure/,
    );

    const rows = await db.execute<{ status: string; response_code: number | null; attempt: number }>(
      sql`select status, response_code, attempt from webhook_deliveries where subscription_id = ${subscriptionId}`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ status: 'failed', response_code: 500, attempt: 1 });
  });

  it('blocks private destinations when the deployment does not opt in (SSRF policy)', async () => {
    const workspaceId = await freshWorkspace();
    const url = `http://127.0.0.1:${receiverPort}/hook`;
    const subscriptionId = await insertSubscription(workspaceId, url, ['asset.created']);

    const event: OutboxEventLike = {
      id: crypto.randomUUID(),
      workspaceId,
      kind: 'asset.created',
      aggregateId: crypto.randomUUID(),
      payloadJson: { occurredAt: '2026-11-19T10:00:00.000Z' },
    };

    // Does not throw (permanent failure) but records it and never touches the network.
    const summary = await deliverWebhooks(db, event, strictConfig);
    expect(summary.delivered).toBe(0);
    expect(summary.failed).toBe(1);
    expect(received).toHaveLength(0);

    const rows = await db.execute<{ status: string; error: string | null }>(
      sql`select status, error from webhook_deliveries where subscription_id = ${subscriptionId}`,
    );
    expect(rows.rows[0]?.status).toBe('failed');
    expect(rows.rows[0]?.error).toMatch(/private|not allowed/i);
  });

  it('delivers webhook.test only to the targeted subscription even if not subscribed', async () => {
    const workspaceId = await freshWorkspace();
    const url = `http://127.0.0.1:${receiverPort}/hook`;
    const subscriptionId = await insertSubscription(workspaceId, url, ['audit.closed']);

    const event: OutboxEventLike = {
      id: crypto.randomUUID(),
      workspaceId,
      kind: 'webhook.test',
      aggregateId: subscriptionId,
      payloadJson: { targetSubscriptionId: subscriptionId, message: 'Test delivery from AssetNest' },
    };

    const summary = await deliverWebhooks(db, event, testConfig);
    expect(summary.delivered).toBe(1);
    expect(received).toHaveLength(1);
    expect(String(received[0]!.headers['x-assetnest-event'])).toBe('webhook.test');
  });
});
