import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { webhookSubscriptions, webhookDeliveries, outboxEvents } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import type { AppConfig } from '@assetnest/config';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { writeOutboxEvent } from '../common/outbox.js';
import { httpCode } from '../common/problem.js';
import { validateWebhookUrl } from '@assetnest/contracts';
import { encryptSecret } from '@assetnest/db';
import { assertHostResolvesPublicly } from './ssrf-dns.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type { CreateWebhookInput, UpdateWebhookInput } from './dto.js';

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async checkUrl(url: string) {
    const policy = validateWebhookUrl(url, { allowPrivate: this.config.WEBHOOKS_ALLOW_PRIVATE });
    if (!policy.ok) {
      throw httpCode(
        HttpStatus.BAD_REQUEST,
        policy.reason ?? 'Invalid destination URL',
        'WEBHOOK_URL_REJECTED',
      );
    }
    const hostname = new URL(url).hostname;
    await assertHostResolvesPublicly(hostname, this.config.WEBHOOKS_ALLOW_PRIVATE === true);
  }

  async create(ctx: WorkspaceContext, actorId: string, input: CreateWebhookInput) {
    await this.checkUrl(input.url);
    const secret = randomBytes(32).toString('base64url');
    const [created] = await this.db
      .insert(webhookSubscriptions)
      .values({
        workspaceId: ctx.workspaceId,
        url: input.url,
        description: input.description,
        secretCiphertext: encryptSecret(secret, this.config.ENCRYPTION_KEY),
        eventTypes: input.eventTypes,
        active: true,
        createdBy: actorId,
      })
      .returning({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        description: webhookSubscriptions.description,
        eventTypes: webhookSubscriptions.eventTypes,
        active: webhookSubscriptions.active,
        createdAt: webhookSubscriptions.createdAt,
      });
    if (!created) {
      throw httpCode(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not create webhook', 'WEBHOOK_FAILED');
    }

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'webhook.created',
      resource: 'webhook_subscription',
      resourceId: created.id,
      metadata: { url: created.url, eventTypes: input.eventTypes },
    });

    // Secret shown exactly once — it is never returned again by any endpoint.
    return { ...created, secret };
  }

  async list(ctx: WorkspaceContext) {
    return this.db
      .select({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        description: webhookSubscriptions.description,
        eventTypes: webhookSubscriptions.eventTypes,
        active: webhookSubscriptions.active,
        createdAt: webhookSubscriptions.createdAt,
      })
      .from(webhookSubscriptions)
      .where(
        and(eq(webhookSubscriptions.workspaceId, ctx.workspaceId), isNull(webhookSubscriptions.deletedAt)),
      )
      .orderBy(desc(webhookSubscriptions.createdAt));
  }

  private async findScoped(ctx: WorkspaceContext, webhookId: string) {
    const [row] = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(
        and(eq(webhookSubscriptions.id, webhookId), eq(webhookSubscriptions.workspaceId, ctx.workspaceId)),
      )
      .limit(1);
    if (!row || row.deletedAt) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Webhook subscription not found', 'WEBHOOK_NOT_FOUND');
    }
    return row;
  }

  async update(ctx: WorkspaceContext, actorId: string, webhookId: string, input: UpdateWebhookInput) {
    const current = await this.findScoped(ctx, webhookId);
    if (input.url !== undefined && input.url !== current.url) {
      await this.checkUrl(input.url);
    }
    const [updated] = await this.db
      .update(webhookSubscriptions)
      .set({
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.eventTypes !== undefined ? { eventTypes: input.eventTypes } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(webhookSubscriptions.id, webhookId))
      .returning({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        description: webhookSubscriptions.description,
        eventTypes: webhookSubscriptions.eventTypes,
        active: webhookSubscriptions.active,
      });

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'webhook.updated',
      resource: 'webhook_subscription',
      resourceId: webhookId,
      metadata: { fields: Object.keys(input) },
    });
    return updated!;
  }

  async remove(ctx: WorkspaceContext, actorId: string, webhookId: string) {
    await this.findScoped(ctx, webhookId);
    await this.db
      .update(webhookSubscriptions)
      .set({ deletedAt: new Date(), active: false })
      .where(eq(webhookSubscriptions.id, webhookId));
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'webhook.deleted',
      resource: 'webhook_subscription',
      resourceId: webhookId,
    });
    return { ok: true };
  }

  /** Enqueues a signed test delivery for exactly this subscription. */
  async test(ctx: WorkspaceContext, actorId: string, webhookId: string) {
    await this.findScoped(ctx, webhookId);
    await this.db.transaction(async (tx) => {
      await writeOutboxEvent(tx, {
        workspaceId: ctx.workspaceId,
        kind: 'webhook.test',
        aggregateId: webhookId,
        payload: {
          subscriptionId: webhookId,
          targetSubscriptionId: webhookId,
          requestedBy: actorId,
          message: 'Test delivery from AssetNest',
        },
      });
    });
    return { ok: true, message: 'Test delivery enqueued' };
  }

  /** Re-enqueues the ORIGINAL outbox events that failed on this subscription. */
  async retryFailed(ctx: WorkspaceContext, actorId: string, webhookId: string) {
    await this.findScoped(ctx, webhookId);
    // The worker dedupes by (event_id, subscription_id) at delivery time, so
    // replaying is safe. Cap at 50 events per retry action.
    const failed = await this.db
      .select({ eventId: webhookDeliveries.eventId })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.subscriptionId, webhookId), eq(webhookDeliveries.status, 'failed')))
      .limit(50);
    const eventIds = [...new Set(failed.map((row) => row.eventId))];
    if (eventIds.length === 0) {
      return { ok: true, enqueued: 0 };
    }
    // Load the original events so the replay carries the real payload, kind
    // and aggregate id — not a stub.
    const events = await this.db
      .select({
        id: outboxEvents.id,
        kind: outboxEvents.kind,
        aggregateId: outboxEvents.aggregateId,
        payloadJson: outboxEvents.payloadJson,
      })
      .from(outboxEvents)
      .where(inArray(outboxEvents.id, eventIds));
    let enqueued = 0;
    for (const event of events) {
      const original = (event.payloadJson ?? {}) as Record<string, unknown>;
      await this.db.transaction(async (tx) => {
        await writeOutboxEvent(tx, {
          workspaceId: ctx.workspaceId,
          kind: event.kind,
          aggregateId: event.aggregateId,
          payload: {
            ...original,
            redeliveryOf: event.id,
            targetSubscriptionId: webhookId,
            requestedBy: actorId,
          },
        });
      });
      enqueued += 1;
    }
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'webhook.retry_failed',
      resource: 'webhook_subscription',
      resourceId: webhookId,
      metadata: { enqueued },
    });
    return { ok: true, enqueued };
  }

  async deliveries(ctx: WorkspaceContext, webhookId: string, limit = 50) {
    await this.findScoped(ctx, webhookId);
    return this.db
      .select({
        id: webhookDeliveries.id,
        eventId: webhookDeliveries.eventId,
        kind: webhookDeliveries.kind,
        attempt: webhookDeliveries.attempt,
        responseCode: webhookDeliveries.responseCode,
        status: webhookDeliveries.status,
        error: webhookDeliveries.error,
        createdAt: webhookDeliveries.createdAt,
        deliveredAt: webhookDeliveries.deliveredAt,
      })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.subscriptionId, webhookId),
          eq(webhookDeliveries.workspaceId, ctx.workspaceId),
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  }
}
