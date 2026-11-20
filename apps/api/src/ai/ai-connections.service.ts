import { HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { AIProviderError, type ProviderKind, type validateProviderEndpoint } from '@assetnest/ai';
import type { AppConfig } from '@assetnest/config';
import { aiConnections, encryptSecret, type Database } from '@assetnest/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode, isUniqueViolation } from '../common/problem.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import type { CreateAiConnectionInput, UpdateAiConnectionInput } from './dto.js';

export const AI_ENDPOINT_VALIDATOR = Symbol('AI_ENDPOINT_VALIDATOR');

const publicFields = {
  id: aiConnections.id,
  kind: aiConnections.kind,
  name: aiConnections.name,
  endpoint: aiConnections.endpoint,
  enabled: aiConnections.enabled,
  hasCredential: sql<boolean>`${aiConnections.encryptedCredential} is not null`,
  createdAt: aiConnections.createdAt,
  updatedAt: aiConnections.updatedAt,
};

function scopedConnection(workspaceId: string, connectionId: string) {
  return and(eq(aiConnections.workspaceId, workspaceId), eq(aiConnections.id, connectionId));
}

function notFound() {
  return httpCode(HttpStatus.NOT_FOUND, 'AI connection not found', 'AI_CONNECTION_NOT_FOUND');
}

function nativeProvider(kind: ProviderKind) {
  return kind !== 'openai_compatible' && kind !== 'ollama';
}

function isForeignKeyViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if ('code' in current && current.code === '23503') return true;
    current = current.cause;
  }
  return false;
}

@Injectable()
export class AiConnectionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_ENDPOINT_VALIDATOR) private readonly validateEndpoint: typeof validateProviderEndpoint,
  ) {}

  list(ctx: WorkspaceContext) {
    return this.withSafeStorageErrors(async () =>
      this.db
        .select(publicFields)
        .from(aiConnections)
        .where(eq(aiConnections.workspaceId, ctx.workspaceId))
        .orderBy(asc(aiConnections.name)),
    );
  }

  async create(ctx: WorkspaceContext, actorId: string | null, input: CreateAiConnectionInput) {
    const endpoint = await this.endpoint(input.kind, input.endpoint ?? null);
    const credential = this.credentialFields(input.credential ?? null);

    return this.withSafeStorageErrors(() =>
      this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(aiConnections)
          .values({
            workspaceId: ctx.workspaceId,
            kind: input.kind,
            name: input.name,
            enabled: input.enabled,
            endpoint,
            ...credential,
          })
          .returning(publicFields);
        if (!created) throw new Error('AI connection insert returned no row');

        await writeAuditLog(tx, {
          workspaceId: ctx.workspaceId,
          actorId,
          action: 'ai_connection.created',
          resource: 'ai_connection',
          resourceId: created.id,
          metadata: { kind: created.kind },
        });
        return created;
      }),
    );
  }

  async update(
    ctx: WorkspaceContext,
    actorId: string | null,
    connectionId: string,
    input: UpdateAiConnectionInput,
  ) {
    const scoped = scopedConnection(ctx.workspaceId, connectionId);
    let endpoint: string | null | undefined;
    if (input.endpoint !== undefined) {
      // Read the immutable kind and validate DNS before opening a transaction.
      const [connection] = await this.withSafeStorageErrors(async () =>
        this.db.select({ kind: aiConnections.kind }).from(aiConnections).where(scoped).limit(1),
      );
      if (!connection) throw notFound();
      endpoint = await this.endpoint(connection.kind, input.endpoint);
    }

    return this.withSafeStorageErrors(() =>
      this.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            kind: aiConnections.kind,
            endpoint: aiConnections.endpoint,
            credentialMode: aiConnections.credentialMode,
          })
          .from(aiConnections)
          .where(scoped)
          .for('update');
        if (!current) throw notFound();
        if (input.credential === null && nativeProvider(current.kind)) {
          throw httpCode(
            HttpStatus.BAD_REQUEST,
            'Native providers require an API key',
            'AI_CREDENTIAL_REQUIRED',
          );
        }
        if (
          endpoint !== undefined &&
          endpoint !== current.endpoint &&
          current.credentialMode === 'api_key' &&
          input.credential === undefined
        ) {
          throw httpCode(
            HttpStatus.BAD_REQUEST,
            'Replace or remove the saved API key when changing an endpoint',
            'AI_CREDENTIAL_REPLACEMENT_REQUIRED',
          );
        }

        const [updated] = await tx
          .update(aiConnections)
          .set({
            name: input.name,
            enabled: input.enabled,
            endpoint,
            ...(input.credential !== undefined ? this.credentialFields(input.credential) : {}),
            // Model verification binds to this value. Always advance by at
            // least one millisecond because API timestamps serialize to ms.
            updatedAt: sql`greatest(clock_timestamp(), ${aiConnections.updatedAt} + interval '1 millisecond')`,
          })
          .where(scoped)
          .returning(publicFields);
        if (!updated) throw notFound();

        await writeAuditLog(tx, {
          workspaceId: ctx.workspaceId,
          actorId,
          action: 'ai_connection.updated',
          resource: 'ai_connection',
          resourceId: connectionId,
          metadata: { fields: Object.keys(input) },
        });
        return updated;
      }),
    );
  }

  async remove(ctx: WorkspaceContext, actorId: string | null, connectionId: string): Promise<void> {
    await this.withSafeStorageErrors(async () => {
      try {
        await this.db.transaction(async (tx) => {
          const [removed] = await tx
            .delete(aiConnections)
            .where(scopedConnection(ctx.workspaceId, connectionId))
            .returning({ id: aiConnections.id });
          if (!removed) throw notFound();

          await writeAuditLog(tx, {
            workspaceId: ctx.workspaceId,
            actorId,
            action: 'ai_connection.deleted',
            resource: 'ai_connection',
            resourceId: removed.id,
          });
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw httpCode(
            HttpStatus.CONFLICT,
            'Clear or reassign task routes before deleting this connection',
            'AI_CONNECTION_IN_USE',
          );
        }
        throw error;
      }
    });
  }

  private async endpoint(kind: ProviderKind, raw: string | null): Promise<string | null> {
    try {
      const accepted = await this.validateEndpoint(
        kind,
        raw,
        this.config.AI_PRIVATE_ORIGINS,
        AbortSignal.timeout(3000),
      );
      return accepted?.href ?? null;
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw httpCode(HttpStatus.BAD_REQUEST, error.message, 'AI_ENDPOINT_REJECTED');
      }
      throw new InternalServerErrorException('AI endpoint validation failed', { cause: error });
    }
  }

  private credentialFields(credential: string | null) {
    return credential === null
      ? { credentialMode: 'none' as const, encryptedCredential: null }
      : {
          credentialMode: 'api_key' as const,
          encryptedCredential: encryptSecret(credential, this.config.ENCRYPTION_KEY),
        };
  }

  private async withSafeStorageErrors<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isUniqueViolation(error)) {
        throw httpCode(
          HttpStatus.CONFLICT,
          'An AI connection already has this name',
          'AI_CONNECTION_NAME_EXISTS',
        );
      }
      // Drizzle errors can include bound parameters. Keep the cause off the
      // exception message and stack serialized by ProblemDetailsFilter.
      throw new InternalServerErrorException('AI connection storage failed', { cause: error });
    }
  }
}
