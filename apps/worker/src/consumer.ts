import { sql } from 'drizzle-orm';
import type { Database } from '@assetnest/db';

export interface OutboxEventLike {
  id: string;
  workspaceId: string;
  kind: string;
  aggregateId: string;
  payloadJson: Record<string, unknown>;
}

export type DeliveryOutcome = 'sent' | 'skipped';

/**
 * Idempotent log-channel delivery — the default sink until email (P2-05) and
 * webhooks (P4) land. The unique key (event_key, recipient, channel) means a
 * retried job can never record or send the same delivery twice; the first
 * writer wins and every other caller observes 'skipped'.
 *
 * Recipient resolution: custodians get the event attributed to their address;
 * everything else lands on the workspace activity stream.
 */
export async function deliverNotificationLog(
  db: Database,
  event: OutboxEventLike,
): Promise<{ outcome: DeliveryOutcome }> {
  const recipient =
    typeof event.payloadJson['custodianEmail'] === 'string'
      ? (event.payloadJson['custodianEmail'] as string)
      : `workspace:${event.workspaceId}`;

  const result = await db.execute<{ id: string }>(
    sql`insert into notification_deliveries
          (workspace_id, event_key, recipient, channel, status, attempts, sent_at)
        values (${event.workspaceId}, ${event.id}, ${recipient}, 'log', 'sent', 1, now())
        on conflict (event_key, recipient, channel) do nothing
        returning id`,
  );
  return { outcome: result.rows.length > 0 ? 'sent' : 'skipped' };
}
