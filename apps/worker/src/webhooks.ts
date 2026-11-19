import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isPrivateHostLiteral, validateWebhookUrl } from '@assetnest/contracts';
import { webhookSubscriptions, webhookDeliveries, decryptSecret } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import type { AppConfig } from '@assetnest/config';
import type { OutboxEventLike } from './templates.js';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_DELIVERY_ATTEMPTS = 5;

export interface WebhookDeliverySummary {
  delivered: number;
  skipped: number;
  failed: number;
}

/**
 * HMAC-SHA256 signature over `t=<unix>.<raw-body>` with the subscription's
 * secret. Receivers verify with the shared secret issued at creation time.
 * No secret ever transits the wire — only the digest.
 */
export function signBody(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
}

interface TargetSubscription {
  id: string;
  url: string;
  secretCiphertext: string;
}

async function resolveTargets(db: Database, event: OutboxEventLike): Promise<TargetSubscription[]> {
  // Explicit target (test pings, per-subscription redeliveries) bypass event-type matching.
  const targetSubscriptionId =
    typeof event.payloadJson['targetSubscriptionId'] === 'string'
      ? (event.payloadJson['targetSubscriptionId'] as string)
      : undefined;

  const rows = await db
    .select({
      id: webhookSubscriptions.id,
      url: webhookSubscriptions.url,
      secretCiphertext: webhookSubscriptions.secretCiphertext,
      eventTypes: webhookSubscriptions.eventTypes,
    })
    .from(webhookSubscriptions)
    .where(
      targetSubscriptionId
        ? and(eq(webhookSubscriptions.id, targetSubscriptionId), isNull(webhookSubscriptions.deletedAt))
        : and(
            eq(webhookSubscriptions.workspaceId, event.workspaceId),
            eq(webhookSubscriptions.active, true),
            isNull(webhookSubscriptions.deletedAt),
          ),
    );

  if (targetSubscriptionId) {
    return rows;
  }
  // Otherwise deliver when the subscription listens for the event kind (or '*').
  return rows.filter((row) => {
    const types = Array.isArray(row.eventTypes) ? (row.eventTypes as string[]) : [];
    return types.includes('*') || types.includes(event.kind);
  });
}

async function assertDeliveryAllowed(url: string, allowPrivate: boolean): Promise<void> {
  const policy = validateWebhookUrl(url, { allowPrivate });
  if (!policy.ok) {
    throw new PermanentDeliveryError(policy.reason ?? 'Destination rejected by policy');
  }
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) !== 0) return; // literal IP already policy-checked
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new PermanentDeliveryError('Destination hostname does not resolve at delivery time');
  }
  for (const { address } of addresses) {
    if (isPrivateHostLiteral(address)) {
      throw new PermanentDeliveryError('Destination resolves to a private address at delivery time');
    }
  }
}

/** Permanent failures: record the outcome, never retry. */
class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

async function priorAttemptCount(db: Database, eventId: string, subscriptionId: string): Promise<number> {
  const rows = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from webhook_deliveries where event_id = ${eventId} and subscription_id = ${subscriptionId}`,
  );
  return Number(rows.rows[0]?.count ?? '0');
}

async function alreadyDelivered(db: Database, eventId: string, subscriptionId: string): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(
    sql`select id from webhook_deliveries where event_id = ${eventId} and subscription_id = ${subscriptionId} and status = 'delivered' limit 1`,
  );
  return rows.rows.length > 0;
}

export async function deliverWebhooks(
  db: Database,
  event: OutboxEventLike,
  config: AppConfig,
): Promise<WebhookDeliverySummary> {
  const targets = await resolveTargets(db, event);
  let delivered = 0;
  let skipped = 0;
  let failed = 0;

  let transientFailures = 0;

  for (const subscription of targets) {
    if (await alreadyDelivered(db, event.id, subscription.id)) {
      skipped += 1;
      continue;
    }
    const attempt = (await priorAttemptCount(db, event.id, subscription.id)) + 1;

    // Build the signed envelope. occurredAt comes from the event payload if present.
    const body = JSON.stringify({
      id: event.id,
      kind: event.kind,
      occurredAt:
        typeof event.payloadJson['occurredAt'] === 'string'
          ? event.payloadJson['occurredAt']
          : new Date().toISOString(),
      workspaceId: event.workspaceId,
      resourceId: event.aggregateId,
      payload: event.payloadJson,
    });
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const signature = signBody(
      decryptSecret(subscription.secretCiphertext, config.ENCRYPTION_KEY),
      timestampSeconds,
      body,
    );

    let status: 'delivered' | 'failed' = 'failed';
    let responseCode: number | null = null;
    let errorMessage: string | null = null;
    let permanent = false;

    try {
      await assertDeliveryAllowed(subscription.url, config.WEBHOOKS_ALLOW_PRIVATE === true);
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AssetNest-Webhooks/0.1',
          'X-Assetnest-Event': event.kind,
          'X-Assetnest-Delivery': event.id,
          'X-Assetnest-Signature': `t=${timestampSeconds},v1=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'manual', // do not follow redirects — they can hop into private space
      });
      responseCode = response.status;
      if (response.status >= 200 && response.status < 300) {
        status = 'delivered';
      } else if (response.status < 500 && response.status !== 429) {
        // 4xx: the receiver rejected the payload — retrying will not help.
        permanent = true;
        errorMessage = `Receiver returned HTTP ${response.status}`;
      } else {
        errorMessage = `Receiver returned HTTP ${response.status}`;
      }
    } catch (error) {
      if (error instanceof PermanentDeliveryError) {
        permanent = true;
        errorMessage = error.message;
      } else {
        errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      }
    }

    await db.insert(webhookDeliveries).values({
      workspaceId: event.workspaceId,
      subscriptionId: subscription.id,
      eventId: event.id,
      kind: event.kind,
      attempt,
      responseCode,
      status,
      error: errorMessage,
      deliveredAt: status === 'delivered' ? new Date() : null,
    });

    if (status === 'delivered') {
      delivered += 1;
    } else {
      failed += 1;
      const canRetry = !permanent && attempt < MAX_DELIVERY_ATTEMPTS;
      if (canRetry) {
        transientFailures += 1;
      }
      // Permanent failure or attempts exhausted — recorded; no further retry.
    }
  }

  if (transientFailures > 0) {
    // BullMQ retries with exponential backoff; already-delivered subscriptions
    // dedupe on the next pass via alreadyDelivered().
    throw new Error(
      `Transient webhook delivery failure for ${transientFailures} subscription(s) of event ${event.id}`,
    );
  }

  return { delivered, skipped, failed };
}
