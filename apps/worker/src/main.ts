import { loadConfig } from '@assetnest/config';
import { createDatabase } from '@assetnest/db';
import { drainOnce } from './relay.js';
import { deliverOutboxEvent } from './consumer.js';
import { deliverWebhooks } from './webhooks.js';
import { createEmailTransport } from './email.js';

/**
 * @assetnest/worker — outbox relay + async delivery consumer.
 *
 * Without REDIS_URL: exits 0 with an explicit notice. The API still writes
 * transactional outbox rows — enabling Redis later drains the backlog.
 * With REDIS_URL: polls outbox → BullMQ queue 'assetnest-outbox', and a
 * concurrency-limited consumer performs idempotent log-channel deliveries.
 */
const config = loadConfig();

if (!config.REDIS_URL) {
  console.warn('[worker] REDIS_URL not set — outbox relay and notification dispatch are disabled.');
  console.warn('[worker] The API keeps writing transactional outbox rows; set REDIS_URL to drain them.');
  process.exit(0);
}

const REDIS_URL = config.REDIS_URL;
const db = createDatabase(config.DATABASE_URL, { max: 2 });

function parseRedisUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
} {
  const parsed = new URL(url);
  const dbIndex = parsed.pathname.replace(/^\//, '');
  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    db: dbIndex ? Number.parseInt(dbIndex, 10) : 0,
  };
}

const connection = parseRedisUrl(REDIS_URL);
const { Queue, Worker } = await import('bullmq');
const emailTransport = createEmailTransport(config);

const queue = new Queue('assetnest-outbox', {
  connection,
  defaultJobOptions: { removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } },
});

const consumer = new Worker(
  'assetnest-outbox',
  async (job) => {
    const { eventId, workspaceId, kind, aggregateId, ...payload } = job.data as {
      eventId: string;
      workspaceId: string;
      kind: string;
      aggregateId: string;
    } & Record<string, unknown>;
    const event = { id: eventId, workspaceId, kind, aggregateId, payloadJson: payload };
    // Targeted deliveries (test pings, per-subscription retries) skip log/email.
    const webhookOnly = typeof payload.targetSubscriptionId === 'string';
    // Email/log delivery and webhook delivery are independent. A transient email
    // failure must still reach the queue's retry mechanism, but it must not stop
    // webhooks from being attempted this pass. Run both, then rethrow the email
    // failure so BullMQ retries (already-sent recipients and delivered webhooks
    // are deduped, so a retry only re-attempts what actually failed).
    let deliveryError: unknown;
    if (!webhookOnly) {
      try {
        await deliverOutboxEvent(db, event, emailTransport, config);
      } catch (error) {
        deliveryError = error;
      }
    }
    await deliverWebhooks(db, event, config);
    if (deliveryError) {
      throw deliveryError;
    }
  },
  { connection, concurrency: 5 },
);

let stopping = false;
let draining = false;

// Heartbeat for orchestrators (compose healthchecks, logs) — no metrics yet (Phase 6).
const heartbeat = setInterval(() => {
  console.warn(`[worker] heartbeat ${new Date().toISOString()}`);
}, 30_000);

const poll = setInterval(async () => {
  if (stopping || draining) return;
  draining = true;
  try {
    const result = await drainOnce(db, queue);
    if (result.published > 0 || result.failed > 0) {
      console.warn(`[worker] drained: published=${result.published} failed=${result.failed}`);
    }
  } catch (error) {
    console.error('[worker] relay iteration failed:', error instanceof Error ? error.message : error);
  } finally {
    draining = false;
  }
}, 1_000);

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.warn(`[worker] ${signal} received — draining and stopping`);
  clearInterval(heartbeat);
  clearInterval(poll);
  await consumer.close();
  await queue.close();
  await db.$client.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.warn('[worker] outbox relay and delivery consumer started (queue: assetnest-outbox)');
