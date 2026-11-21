import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  unverifiedCapabilities,
  type AIProviderRegistry,
  type ModelCapabilities,
  type createProviderTransport,
} from '@assetnest/ai';
import type { AppConfig } from '@assetnest/config';
import { aiConnections, aiModels, decryptSecret, type Database } from '@assetnest/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode, isUniqueViolation } from '../common/problem.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import {
  AI_PROVIDER_REGISTRY,
  AI_PROVIDER_TRANSPORT,
  providerTestFailure,
} from './ai-connection-diagnostics.service.js';
import { verifyModelCapabilities } from './ai-model-probe.js';
import type { CreateAiModelInput, TestAiModelInput } from './ai-settings.dto.js';

const publicModelFields = {
  id: aiModels.id,
  connectionId: aiModels.connectionId,
  modelId: aiModels.modelId,
  label: aiModels.label,
  capabilities: aiModels.capabilities,
  verifiedAt: aiModels.verifiedAt,
  verifiedConnectionUpdatedAt: aiModels.verifiedConnectionUpdatedAt,
  createdAt: aiModels.createdAt,
  updatedAt: aiModels.updatedAt,
};

function scopedModel(workspaceId: string, modelId: string) {
  return and(eq(aiModels.workspaceId, workspaceId), eq(aiModels.id, modelId));
}

@Injectable()
export class AiModelsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_PROVIDER_REGISTRY) private readonly registry: Pick<AIProviderRegistry, 'connect'>,
    @Inject(AI_PROVIDER_TRANSPORT) private readonly transport: typeof createProviderTransport,
  ) {}

  list(ctx: WorkspaceContext) {
    return this.db
      .select(publicModelFields)
      .from(aiModels)
      .where(eq(aiModels.workspaceId, ctx.workspaceId))
      .orderBy(asc(aiModels.label), asc(aiModels.id));
  }

  async create(ctx: WorkspaceContext, actorId: string | null, input: CreateAiModelInput) {
    try {
      return await this.db.transaction(async (tx) => {
        const [connection] = await tx
          .select({ id: aiConnections.id })
          .from(aiConnections)
          .where(
            and(eq(aiConnections.workspaceId, ctx.workspaceId), eq(aiConnections.id, input.connectionId)),
          )
          .for('share');
        if (!connection) {
          throw httpCode(HttpStatus.NOT_FOUND, 'AI connection not found', 'AI_CONNECTION_NOT_FOUND');
        }
        const [created] = await tx
          .insert(aiModels)
          .values({ ...input, workspaceId: ctx.workspaceId, capabilities: unverifiedCapabilities() })
          .returning(publicModelFields);
        if (!created) throw new Error('AI model insert returned no row');
        await writeAuditLog(tx, {
          workspaceId: ctx.workspaceId,
          actorId,
          action: 'ai_model.created',
          resource: 'ai_model',
          resourceId: created.id,
          metadata: { connectionId: input.connectionId },
        });
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw httpCode(HttpStatus.CONFLICT, 'This connection already has the model', 'AI_MODEL_EXISTS');
      }
      throw error;
    }
  }

  async test(ctx: WorkspaceContext, actorId: string, modelId: string, input: TestAiModelInput) {
    if (ctx.role !== 'owner' && ctx.role !== 'admin') {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Testing a model requires an administrator session',
        'AI_MODEL_TEST_SESSION_REQUIRED',
      );
    }
    const scoped = scopedModel(ctx.workspaceId, modelId);
    const [snapshot] = await this.db
      .select({
        modelId: aiModels.modelId,
        modelUpdatedAt: aiModels.updatedAt,
        connectionUpdatedAt: aiConnections.updatedAt,
        kind: aiConnections.kind,
        endpoint: aiConnections.endpoint,
        credential: aiConnections.encryptedCredential,
        enabled: aiConnections.enabled,
      })
      .from(aiModels)
      .innerJoin(
        aiConnections,
        and(eq(aiConnections.workspaceId, aiModels.workspaceId), eq(aiConnections.id, aiModels.connectionId)),
      )
      .where(scoped)
      .limit(1);
    if (!snapshot) throw httpCode(HttpStatus.NOT_FOUND, 'AI model not found', 'AI_MODEL_NOT_FOUND');
    if (!snapshot.enabled) {
      throw httpCode(
        HttpStatus.CONFLICT,
        'Enable the AI connection before testing its model',
        'AI_CONNECTION_DISABLED',
      );
    }

    let capabilities: ModelCapabilities;
    try {
      const credential = snapshot.credential
        ? decryptSecret(snapshot.credential, this.config.ENCRYPTION_KEY)
        : null;
      const transport = this.transport(
        snapshot.kind,
        snapshot.endpoint,
        credential,
        this.config.AI_PRIVATE_ORIGINS,
      );
      const adapter = this.registry.connect(snapshot.kind, transport);
      capabilities = await verifyModelCapabilities(
        adapter,
        snapshot.modelId,
        AbortSignal.timeout(20_000),
        input.probeImage,
      );
    } catch (error) {
      const { code, exception } = providerTestFailure(error);
      await writeAuditLog(this.db, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'ai_model.tested',
        resource: 'ai_model',
        resourceId: modelId,
        metadata: { code },
      });
      throw exception;
    }

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          modelUpdatedAt: aiModels.updatedAt,
          connectionUpdatedAt: aiConnections.updatedAt,
        })
        .from(aiModels)
        .innerJoin(
          aiConnections,
          and(
            eq(aiConnections.workspaceId, aiModels.workspaceId),
            eq(aiConnections.id, aiModels.connectionId),
          ),
        )
        .where(scoped)
        .for('update');
      if (
        !current ||
        current.modelUpdatedAt.getTime() !== snapshot.modelUpdatedAt.getTime() ||
        current.connectionUpdatedAt.getTime() !== snapshot.connectionUpdatedAt.getTime()
      ) {
        throw httpCode(
          HttpStatus.CONFLICT,
          'The model or connection changed during the test',
          'AI_MODEL_TEST_STALE',
        );
      }

      const [updated] = await tx
        .update(aiModels)
        .set({
          capabilities,
          verifiedAt: new Date(),
          verifiedConnectionUpdatedAt: current.connectionUpdatedAt,
          updatedAt: sql`greatest(clock_timestamp(), ${aiModels.updatedAt} + interval '1 millisecond')`,
        })
        .where(scoped)
        .returning(publicModelFields);
      if (!updated) throw new Error('AI model test update returned no row');
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'ai_model.tested',
        resource: 'ai_model',
        resourceId: modelId,
        metadata: {
          supported: Object.entries(capabilities.features)
            .filter(([, status]) => status === 'supported')
            .map(([feature]) => feature),
        },
      });
      return updated;
    });
  }
}
