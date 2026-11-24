import { z } from 'zod';

/**
 * AG-UI (Agent User Interaction Protocol) event contracts.
 *
 * This is a minimal, faithful subset of the official protocol event schema
 * (https://docs.ag-ui.com/concepts/events, mirrored from
 * `@ag-ui/core` `EventType`) covering exactly the events the AssetNest asset
 * chat pilot emits over server-sent events:
 *
 *   RUN_STARTED → (STEP_STARTED → STEP_FINISHED)* →
 *     TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT* → TEXT_MESSAGE_END → RUN_FINISHED
 *   …or, on failure, a terminal RUN_ERROR.
 *
 * The `type` discriminator uses the protocol's UPPER_SNAKE_CASE wire values.
 * Kept here (the shared, framework-free wire-contract package) so the NestJS
 * API produces and the web client validates the same schema.
 */

const baseEventShape = {
  /** When the event was created (ms since the Unix epoch), if the producer sets it. */
  timestamp: z.number().optional(),
  /** Extra, application-defined information attached to the event. */
  metadata: z.record(z.string(), z.unknown()).optional(),
};

/** Who a streamed text message is from. Defaults to the assistant per the protocol. */
export const agUiTextRoleSchema = z.enum(['developer', 'system', 'assistant', 'user']);

export const runStartedEventSchema = z.object({
  type: z.literal('RUN_STARTED'),
  ...baseEventShape,
  /** Stable conversation identifier. Server-derived; never trusted from the client. */
  threadId: z.string().min(1),
  /** Unique identifier for this run. */
  runId: z.string().min(1),
});
export type RunStartedEvent = z.infer<typeof runStartedEventSchema>;

export const stepStartedEventSchema = z.object({
  type: z.literal('STEP_STARTED'),
  ...baseEventShape,
  /** Identifies the step; the matching STEP_FINISHED carries the same name. */
  stepName: z.string().min(1),
});
export type StepStartedEvent = z.infer<typeof stepStartedEventSchema>;

export const stepFinishedEventSchema = z.object({
  type: z.literal('STEP_FINISHED'),
  ...baseEventShape,
  /** The step being closed. */
  stepName: z.string().min(1),
});
export type StepFinishedEvent = z.infer<typeof stepFinishedEventSchema>;

export const textMessageStartEventSchema = z.object({
  type: z.literal('TEXT_MESSAGE_START'),
  ...baseEventShape,
  /** Identifies the message this stream builds. */
  messageId: z.string().min(1),
  role: agUiTextRoleSchema.default('assistant'),
});
export type TextMessageStartEvent = z.infer<typeof textMessageStartEventSchema>;

export const textMessageContentEventSchema = z.object({
  type: z.literal('TEXT_MESSAGE_CONTENT'),
  ...baseEventShape,
  messageId: z.string().min(1),
  /** The non-empty fragment to append. */
  delta: z.string().min(1),
});
export type TextMessageContentEvent = z.infer<typeof textMessageContentEventSchema>;

export const textMessageEndEventSchema = z.object({
  type: z.literal('TEXT_MESSAGE_END'),
  ...baseEventShape,
  /** The message being closed. */
  messageId: z.string().min(1),
});
export type TextMessageEndEvent = z.infer<typeof textMessageEndEventSchema>;

export const runFinishedEventSchema = z.object({
  type: z.literal('RUN_FINISHED'),
  ...baseEventShape,
  /** The conversation this run belongs to. */
  threadId: z.string().min(1),
  /** The run being closed. */
  runId: z.string().min(1),
});
export type RunFinishedEvent = z.infer<typeof runFinishedEventSchema>;

export const runErrorEventSchema = z.object({
  type: z.literal('RUN_ERROR'),
  ...baseEventShape,
  /** A safe, human-readable message. Never contains provider internals or secrets. */
  message: z.string(),
  /** Optional stable machine-readable error code. */
  code: z.string().optional(),
});
export type RunErrorEvent = z.infer<typeof runErrorEventSchema>;

/** Discriminated union of every event the asset chat pilot emits. */
export const agUiEventSchema = z.discriminatedUnion('type', [
  runStartedEventSchema,
  stepStartedEventSchema,
  stepFinishedEventSchema,
  textMessageStartEventSchema,
  textMessageContentEventSchema,
  textMessageEndEventSchema,
  runFinishedEventSchema,
  runErrorEventSchema,
]);
export type AgUiEvent = z.infer<typeof agUiEventSchema>;

/** The AG-UI event `type` wire values. */
export type AgUiEventType = AgUiEvent['type'];
