import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  AIProviderError,
  aiProviderRegistry,
  canRunTask,
  capabilitySchema,
  createProviderTransport,
  taskOutputSchemas,
  type AIProviderAdapter,
  type AITask,
  type GenerateRequest,
  type ProviderErrorCode,
  type ProviderKind,
  type TaskOutput,
  type TokenUsage,
} from '@assetnest/ai';
import type { AppConfig } from '@assetnest/config';
import {
  aiConnections,
  aiJobs,
  aiModels,
  aiTaskRoutes,
  decryptSecret,
  workspaces,
  type Database,
} from '@assetnest/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';

interface TaskInput {
  system: string;
  prompt: string;
  images?: GenerateRequest['images'];
  sourceDocumentId?: string;
}

interface RunInput extends TaskInput {
  context: WorkspaceContext;
  actorId: string;
  consent: boolean;
}

const transientErrors = new Set<ProviderErrorCode>(['unavailable', 'timeout', 'rate_limited']);
const perImageReservation = 16_384;

type AdapterFactory = (
  kind: ProviderKind,
  endpoint: string | null,
  credential: string | null,
  privateOrigins: readonly string[],
) => AIProviderAdapter;

export const AI_TASK_ADAPTER = Symbol('AI_TASK_ADAPTER');
export const providerForTask: AdapterFactory = (kind, endpoint, credential, privateOrigins) =>
  aiProviderRegistry.connect(kind, createProviderTransport(kind, endpoint, credential, privateOrigins));

@Injectable()
export class AiTaskExecutor {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_TASK_ADAPTER) private readonly connectAdapter: AdapterFactory,
  ) {}

  async run<T extends AITask>(task: T, input: RunInput): Promise<{ jobId: string; draft: TaskOutput<T> }> {
    if (input.context.role === 'automation') {
      throw httpCode(HttpStatus.FORBIDDEN, 'A workspace session is required', 'AI_SESSION_REQUIRED');
    }
    if (!input.consent)
      throw httpCode(HttpStatus.FORBIDDEN, 'Confirm provider processing first', 'AI_CONSENT_REQUIRED');
    const workspaceId = input.context.workspaceId;
    const [route] = await this.db
      .select({
        modelId: aiTaskRoutes.modelId,
        fallbackModelId: aiTaskRoutes.fallbackModelId,
        timeoutMs: aiTaskRoutes.timeoutMs,
        maxOutputTokens: aiTaskRoutes.maxOutputTokens,
        dailyTokenBudget: aiTaskRoutes.dailyTokenBudget,
        allowProviderData: aiTaskRoutes.allowProviderData,
      })
      .from(aiTaskRoutes)
      .where(and(eq(aiTaskRoutes.workspaceId, workspaceId), eq(aiTaskRoutes.task, task)))
      .limit(1);
    if (!route)
      throw httpCode(HttpStatus.CONFLICT, 'Configure a provider route for this task', 'AI_ROUTE_MISSING');
    if (!route.allowProviderData) {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Provider processing is disabled for this task',
        'AI_PROCESSING_DISABLED',
      );
    }
    const schema: z.ZodType = taskOutputSchemas[task];
    const { $schema: schemaDialect, ...wireSchema } = z.toJSONSchema(schema, { target: 'draft-07' });
    void schemaDialect;
    const signal = AbortSignal.timeout(route.timeoutMs);
    // UTF-8 bytes and a fixed image allowance are conservative reservation estimates.
    // Provider-reported usage wins when it exceeds the estimate.
    const reservedTokens =
      Buffer.byteLength(input.prompt) +
      Buffer.byteLength(input.system) +
      route.maxOutputTokens +
      (input.images?.length ?? 0) * perImageReservation;

    for (const modelId of [route.modelId, route.fallbackModelId].filter((id): id is string => id !== null)) {
      const model = await this.loadModel(workspaceId, modelId, task);
      const jobId = await this.reserve(task, input, model, reservedTokens, route.dailyTokenBudget);
      const started = Date.now();
      let usage: TokenUsage | null = null;
      let draft: TaskOutput<T>;
      try {
        const credential = model.encryptedCredential
          ? decryptSecret(model.encryptedCredential, this.config.ENCRYPTION_KEY)
          : null;
        const adapter = this.connectAdapter(
          model.kind,
          model.endpoint,
          credential,
          this.config.AI_PRIVATE_ORIGINS,
        );
        const result = await adapter.generate({
          model: model.providerModelId,
          system: input.system,
          prompt: input.prompt,
          images: input.images,
          structuredOutput: { name: task, schema: wireSchema },
          maxOutputTokens: route.maxOutputTokens,
          signal,
        });
        usage = result.usage;
        try {
          draft = schema.parse(JSON.parse(result.text)) as TaskOutput<T>;
        } catch {
          throw new AIProviderError('invalid_response');
        }
      } catch (error) {
        const code = error instanceof AIProviderError ? error.code : 'unavailable';
        await this.finish(workspaceId, jobId, Date.now() - started, usage, { code });
        if (
          modelId === route.modelId &&
          route.fallbackModelId &&
          transientErrors.has(code) &&
          !signal.aborted
        ) {
          continue;
        }
        const status = code === 'timeout' ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY;
        throw httpCode(
          status,
          'The configured AI provider could not complete this request',
          `AI_PROVIDER_${code.toUpperCase()}`,
        );
      }
      await this.finish(workspaceId, jobId, Date.now() - started, usage, {
        draft: input.sourceDocumentId ? draft : null,
      });
      return { jobId, draft };
    }
    throw httpCode(
      HttpStatus.CONFLICT,
      'Configure an available provider model for this task',
      'AI_MODEL_UNAVAILABLE',
    );
  }

  private async loadModel(workspaceId: string, modelId: string, task: AITask) {
    const [model] = await this.db
      .select({
        id: aiModels.id,
        providerModelId: aiModels.modelId,
        capabilities: aiModels.capabilities,
        verifiedAt: aiModels.verifiedAt,
        verifiedConnectionUpdatedAt: aiModels.verifiedConnectionUpdatedAt,
        kind: aiConnections.kind,
        endpoint: aiConnections.endpoint,
        encryptedCredential: aiConnections.encryptedCredential,
        connectionUpdatedAt: aiConnections.updatedAt,
      })
      .from(aiModels)
      .innerJoin(
        aiConnections,
        and(eq(aiModels.connectionId, aiConnections.id), eq(aiModels.workspaceId, aiConnections.workspaceId)),
      )
      .where(
        and(eq(aiModels.id, modelId), eq(aiModels.workspaceId, workspaceId), eq(aiConnections.enabled, true)),
      )
      .limit(1);
    const checked = capabilitySchema.safeParse(model?.capabilities);
    if (
      !model?.verifiedAt ||
      !model.verifiedConnectionUpdatedAt ||
      model.verifiedConnectionUpdatedAt.getTime() !== model.connectionUpdatedAt.getTime() ||
      !checked.success ||
      !canRunTask(task, checked.data)
    ) {
      throw httpCode(
        HttpStatus.CONFLICT,
        'Verify a model with the capabilities this task requires',
        'AI_MODEL_UNAVAILABLE',
      );
    }
    return model;
  }

  private async reserve(
    task: AITask,
    input: RunInput,
    model: { id: string; kind: ProviderKind; providerModelId: string },
    reservedTokens: number,
    budget: number,
  ): Promise<string> {
    const workspaceId = input.context.workspaceId;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return this.db.transaction(async (tx) => {
      // Serialize workspace reservations so concurrent requests cannot overspend the route budget.
      await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .for('update');
      const [usage] = await tx
        .select({
          used: sql<number>`coalesce(sum(greatest(${aiJobs.reservedTokens}, coalesce(${aiJobs.inputTokens}, 0) + coalesce(${aiJobs.outputTokens}, 0))), 0)`.mapWith(
            Number,
          ),
        })
        .from(aiJobs)
        .where(and(eq(aiJobs.workspaceId, workspaceId), eq(aiJobs.task, task), gte(aiJobs.createdAt, today)));
      if ((usage?.used ?? 0) + reservedTokens > budget) {
        throw httpCode(
          HttpStatus.TOO_MANY_REQUESTS,
          'Daily AI budget reached for this task',
          'AI_BUDGET_EXCEEDED',
        );
      }
      const [job] = await tx
        .insert(aiJobs)
        .values({
          workspaceId,
          actorId: input.actorId,
          task,
          modelId: model.id,
          providerKind: model.kind,
          providerModelId: model.providerModelId,
          status: 'running',
          reservedTokens,
          sourceDocumentId: input.sourceDocumentId,
        })
        .returning({ id: aiJobs.id });
      if (!job) throw new Error('AI job reservation returned no ID');
      await writeAuditLog(tx, {
        workspaceId,
        actorId: input.actorId,
        action: 'ai.task_requested',
        resource: 'ai_job',
        resourceId: job.id,
        metadata: { task, provider: model.kind },
      });
      return job.id;
    });
  }

  private async finish(
    workspaceId: string,
    jobId: string,
    durationMs: number,
    usage: TokenUsage | null,
    outcome: { draft: unknown } | { code: ProviderErrorCode },
  ) {
    const failed = 'code' in outcome;
    await this.db
      .update(aiJobs)
      .set({
        status: failed ? 'failed' : 'succeeded',
        errorCode: failed ? outcome.code : null,
        output: failed ? null : outcome.draft,
        durationMs,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        finishedAt: new Date(),
      })
      .where(and(eq(aiJobs.workspaceId, workspaceId), eq(aiJobs.id, jobId), eq(aiJobs.status, 'running')));
  }
}
