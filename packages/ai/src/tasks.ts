import { ASSET_STATUSES } from '@assetnest/domain';
import { z } from 'zod';
import type { Capability, ModelCapabilities } from './provider.js';

export const aiTaskSchema = z.enum([
  'invoice_extraction',
  'image_tagging',
  'natural_language_search',
  'maintenance_assistant',
  'asset_chat',
]);
export type AITask = z.infer<typeof aiTaskSchema>;

const question = z.string().trim().min(1).max(2_000);
export const aiTaskRequestSchema = z.discriminatedUnion('task', [
  z.strictObject({ task: z.literal('invoice_extraction'), documentId: z.uuid() }),
  z.strictObject({ task: z.literal('image_tagging'), documentId: z.uuid() }),
  z.strictObject({ task: z.literal('natural_language_search'), question }),
  z.strictObject({ task: z.literal('maintenance_assistant'), assetId: z.uuid(), question }),
  z.strictObject({ task: z.literal('asset_chat'), question }),
]);
export type AITaskRequest = z.infer<typeof aiTaskRequestSchema>;

export const taskCapabilities = {
  invoice_extraction: ['text', 'structured_output'],
  image_tagging: ['vision', 'image_input', 'structured_output'],
  natural_language_search: ['text', 'structured_output'],
  maintenance_assistant: ['text'],
  asset_chat: ['text'],
} as const satisfies Record<AITask, readonly Capability[]>;

export function canRunTask(task: AITask, capabilities: ModelCapabilities): boolean {
  return taskCapabilities[task].every((feature) => capabilities.features[feature] === 'supported');
}

const confidence = z.number().min(0).max(1);
const shortText = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(6_000);

export const invoiceDraftSchema = z.strictObject({
  vendor: shortText.nullable(),
  invoiceNo: shortText.nullable(),
  purchaseDate: z.iso.date().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  items: z
    .array(
      z.strictObject({
        name: shortText,
        model: shortText.nullable(),
        serialNumber: shortText.nullable(),
        price: z
          .string()
          .regex(/^\d{1,16}(\.\d{1,2})?$/)
          .nullable(),
        warrantyEndsOn: z.iso.date().nullable(),
        confidence,
        evidence: z.string().trim().min(1).max(500).nullable(),
      }),
    )
    .max(100),
});

export const photoDraftSchema = z.strictObject({
  category: shortText.nullable(),
  model: shortText.nullable(),
  visibleSerial: z.strictObject({ value: shortText, evidence: shortText }).nullable(),
  confidence,
});

const assetFilter = z.discriminatedUnion('field', [
  z.strictObject({ field: z.literal('search'), operator: z.literal('contains'), value: shortText }),
  z.strictObject({
    field: z.literal('status'),
    operator: z.literal('equals'),
    value: z.enum(ASSET_STATUSES),
  }),
  z.strictObject({
    field: z.literal('condition'),
    operator: z.literal('equals'),
    value: z.enum(['new', 'good', 'fair', 'poor', 'damaged', 'unknown']),
  }),
]);

/** A flat AND list over the existing inventory filters. No executable expressions. */
export const assetFilterSchema = z.strictObject({
  filters: z
    .array(assetFilter)
    .max(3)
    .refine(
      (filters) => new Set(filters.map(({ field }) => field)).size === filters.length,
      'Each field can appear only once',
    ),
});

export const taskOutputSchemas = {
  invoice_extraction: invoiceDraftSchema,
  image_tagging: photoDraftSchema,
  natural_language_search: assetFilterSchema,
  maintenance_assistant: z.strictObject({ answer: note }),
  asset_chat: z.strictObject({ answer: note }),
} as const satisfies Record<AITask, z.ZodType>;

export type TaskOutput<T extends AITask> = z.output<(typeof taskOutputSchemas)[T]>;
