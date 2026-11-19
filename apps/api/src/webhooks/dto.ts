import { z } from 'zod';

export const WEBHOOK_EVENT_KINDS = [
  'asset.created',
  'asset.updated',
  'asset.assigned',
  'asset.returned',
  'asset.transferred',
  'asset.status_changed',
  'asset.archived',
  'audit.opened',
  'audit.closed',
  'maintenance.record_created',
  'warranty.created',
] as const;

export const createWebhookSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_KINDS)).min(1, 'Choose at least one event').max(20),
  description: z.string().trim().max(200).optional(),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({
    url: z.string().trim().min(1).max(2048).optional(),
    eventTypes: z.array(z.enum(WEBHOOK_EVENT_KINDS)).min(1).max(20).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided');
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
