import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { canRunTask, capabilitySchema, type AITask } from '@assetnest/ai';
import { aiConnections, aiModels, aiTaskRoutes, type Database } from '@assetnest/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import { DATABASE } from '../common/tokens.js';
import type { UpsertAiRouteInput } from './ai-settings.dto.js';

const routeFields = {
  task: aiTaskRoutes.task,
  modelId: aiTaskRoutes.modelId,
  fallbackModelId: aiTaskRoutes.fallbackModelId,
  timeoutMs: aiTaskRoutes.timeoutMs,
  maxOutputTokens: aiTaskRoutes.maxOutputTokens,
  dailyTokenBudget: aiTaskRoutes.dailyTokenBudget,
  allowProviderData: aiTaskRoutes.allowProviderData,
  createdAt: aiTaskRoutes.createdAt,
  updatedAt: aiTaskRoutes.updatedAt,
};

@Injectable()
export class AiRoutesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(ctx: WorkspaceContext) {
    return this.db
      .select(routeFields)
      .from(aiTaskRoutes)
      .where(eq(aiTaskRoutes.workspaceId, ctx.workspaceId))
      .orderBy(asc(aiTaskRoutes.task));
  }

  upsert(ctx: WorkspaceContext, actorId: string | null, task: AITask, input: UpsertAiRouteInput) {
    const modelIds = input.fallbackModelId ? [input.modelId, input.fallbackModelId] : [input.modelId];
    return this.db.transaction(async (tx) => {
      const models = await tx
        .select({
          capabilities: aiModels.capabilities,
          verifiedAt: aiModels.verifiedAt,
          verifiedConnectionUpdatedAt: aiModels.verifiedConnectionUpdatedAt,
          connectionUpdatedAt: aiConnections.updatedAt,
          enabled: aiConnections.enabled,
        })
        .from(aiModels)
        .innerJoin(
          aiConnections,
          and(
            eq(aiConnections.workspaceId, aiModels.workspaceId),
            eq(aiConnections.id, aiModels.connectionId),
          ),
        )
        .where(and(eq(aiModels.workspaceId, ctx.workspaceId), inArray(aiModels.id, modelIds)))
        .orderBy(asc(aiModels.id))
        .for('share');
      if (models.length !== modelIds.length) {
        throw httpCode(HttpStatus.NOT_FOUND, 'AI model not found', 'AI_MODEL_NOT_FOUND');
      }

      for (const model of models) {
        const capabilities = capabilitySchema.safeParse(model.capabilities);
        if (
          !model.enabled ||
          !model.verifiedAt ||
          model.verifiedConnectionUpdatedAt?.getTime() !== model.connectionUpdatedAt.getTime() ||
          !capabilities.success ||
          !canRunTask(task, capabilities.data)
        ) {
          throw httpCode(
            HttpStatus.CONFLICT,
            'Use enabled models with current verification for the required capabilities',
            'AI_MODEL_CAPABILITIES_REQUIRED',
          );
        }
      }

      const [route] = await tx
        .insert(aiTaskRoutes)
        .values({ ...input, task, workspaceId: ctx.workspaceId })
        .onConflictDoUpdate({
          target: [aiTaskRoutes.workspaceId, aiTaskRoutes.task],
          set: { ...input, updatedAt: new Date() },
        })
        .returning(routeFields);
      if (!route) throw new Error('AI route upsert returned no row');
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'ai_route.updated',
        resource: 'ai_task_route',
        metadata: { task, modelId: input.modelId, fallbackModelId: input.fallbackModelId },
      });
      return route;
    });
  }

  async remove(ctx: WorkspaceContext, actorId: string | null, task: AITask): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(aiTaskRoutes)
        .where(and(eq(aiTaskRoutes.workspaceId, ctx.workspaceId), eq(aiTaskRoutes.task, task)))
        .returning({ task: aiTaskRoutes.task });
      if (!removed) return;
      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'ai_route.deleted',
        resource: 'ai_task_route',
        metadata: { task },
      });
    });
  }
}
