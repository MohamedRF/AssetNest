import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import { WEBHOOK_EVENT_KINDS } from './dto.js';

const webhook = z.object({
  id: z.uuid(),
  url: z.url(),
  description: z.string().nullable(),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_KINDS)),
  active: z.boolean(),
});
const listedWebhook = webhook.extend({ createdAt: z.iso.datetime() });
const acknowledged = z.object({ ok: z.literal(true) });

export const createWebhookResponse = openApiSchema(
  listedWebhook.extend({
    secret: z.string().describe('The signing secret. It is returned once when the webhook is created.'),
  }),
);
export const listWebhooksResponse = openApiSchema(z.object({ webhooks: z.array(listedWebhook) }));
export const updateWebhookResponse = openApiSchema(webhook);
export const removeWebhookResponse = openApiSchema(acknowledged);
export const testWebhookResponse = openApiSchema(acknowledged.extend({ message: z.string() }));
export const retryWebhookDeliveriesResponse = openApiSchema(
  acknowledged.extend({ enqueued: z.int().nonnegative() }),
);
export const listWebhookDeliveriesResponse = openApiSchema(
  z.object({
    deliveries: z.array(
      z.object({
        id: z.uuid(),
        eventId: z.uuid(),
        kind: z.string(),
        attempt: z.int(),
        responseCode: z.int().nullable(),
        status: z.enum(['pending', 'delivered', 'failed']),
        error: z.string().nullable(),
        createdAt: z.iso.datetime(),
        deliveredAt: z.iso.datetime().nullable(),
      }),
    ),
  }),
);
