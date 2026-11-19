import { sql } from 'drizzle-orm';
import type { Database } from '@assetnest/db';
import type { AppConfig } from '@assetnest/config';
import type { EmailTransport, MailMessage } from './email.js';
import { renderOutboxEvent, type OutboxEventLike } from './templates.js';

export interface DeliverySummary {
  log: 'sent' | 'skipped';
  emailSent: number;
  emailSkipped: number;
  emailFailed: number;
}

/**
 * Preference-aware delivery. 'log' channel always records to the workspace
 * activity stream. 'email' goes to every ACTIVE member whose preference for
 * (channel=email, event=<kind>) is enabled — or absent (opt-out model).
 * Every delivery is idempotent on (event_key, recipient, channel).
 */
export async function deliverOutboxEvent(
  db: Database,
  event: OutboxEventLike,
  transport: EmailTransport,
  config: AppConfig,
): Promise<DeliverySummary> {
  // ─── log channel: always on, deduplicated
  const logResult = await db.execute(
    sql`insert into notification_deliveries
          (workspace_id, event_key, recipient, channel, status, attempts, sent_at)
        values (${event.workspaceId}, ${event.id}, ${`workspace:${event.workspaceId}`}, 'log', 'sent', 1, now())
        on conflict (event_key, recipient, channel) do nothing
        returning id`,
  );

  // ─── email channel: resolve recipients with preferences
  const members = await db.execute<{ email: string; member_id: string }>(
    sql`select u.email as email, m.id as member_id
        from memberships m
        join users u on u.id = m.user_id
        where m.workspace_id = ${event.workspaceId} and m.status = 'active' and u.status = 'active'`,
  );

  const prefs = await db.execute<{ member_id: string; enabled: boolean }>(
    sql`select member_id, enabled from notification_preferences
        where workspace_id = ${event.workspaceId} and channel = 'email' and event = ${event.kind}`,
  );
  const prefByMember = new Map(prefs.rows.map((row) => [row.member_id, row.enabled]));

  let emailSent = 0;
  let emailSkipped = 0;
  let emailFailed = 0;

  for (const member of members.rows) {
    const enabled = prefByMember.get(member.member_id) ?? true; // opt-out model
    if (!enabled) {
      const skipped = await db.execute(
        sql`insert into notification_deliveries
              (workspace_id, event_key, recipient, channel, status, attempts)
            values (${event.workspaceId}, ${event.id}, ${member.email}, 'email', 'skipped', 0)
            on conflict (event_key, recipient, channel) do nothing
            returning id`,
      );
      if (skipped.rows.length > 0) emailSkipped += 1;
      continue;
    }

    // Claim the delivery first; only the claiming worker performs the send.
    // A 'sent' or fresh 'pending' row is never re-claimed; a failed or stale
    // (>5 min) pending row may be re-claimed for a bounded retry.
    const claimed = await db.execute(
      sql`insert into notification_deliveries
            (workspace_id, event_key, recipient, channel, status, attempts)
          values (${event.workspaceId}, ${event.id}, ${member.email}, 'email', 'pending', 0)
          on conflict (event_key, recipient, channel) do update
            set status = 'pending'
            where notification_deliveries.status = 'failed'
              or (notification_deliveries.status = 'pending'
                  and notification_deliveries.created_at < now() - interval '5 minutes')
          returning id`,
    );
    if (claimed.rows.length === 0) {
      emailSkipped += 1; // already delivered (or pending elsewhere) — never re-send
      continue;
    }

    const message: MailMessage = { ...renderOutboxEvent(event, config), to: member.email };
    try {
      await transport.send(message);
      await db.execute(
        sql`update notification_deliveries
            set status = 'sent', attempts = attempts + 1, sent_at = now(), last_error = null
            where (event_key, recipient, channel) = (${event.id}, ${member.email}, 'email')`,
      );
      emailSent += 1;
    } catch (error) {
      const messageText = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await db.execute(
        sql`update notification_deliveries
            set status = 'failed', attempts = attempts + 1, last_error = ${messageText}
            where (event_key, recipient, channel) = (${event.id}, ${member.email}, 'email')`,
      );
      emailFailed += 1;
    }
  }

  return {
    log: logResult.rows.length > 0 ? 'sent' : 'skipped',
    emailSent,
    emailSkipped,
    emailFailed,
  };
}

/** Back-compat single-channel helper used by the log-only smoke path. */
export async function deliverNotificationLog(
  db: Database,
  event: OutboxEventLike,
): Promise<{ outcome: 'sent' | 'skipped' }> {
  const result = await db.execute(
    sql`insert into notification_deliveries
          (workspace_id, event_key, recipient, channel, status, attempts, sent_at)
        values (${event.workspaceId}, ${event.id}, ${`workspace:${event.workspaceId}`}, 'log', 'sent', 1, now())
        on conflict (event_key, recipient, channel) do nothing
        returning id`,
  );
  return { outcome: result.rows.length > 0 ? 'sent' : 'skipped' };
}
