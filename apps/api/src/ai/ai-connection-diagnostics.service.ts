import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  AIProviderError,
  type AIProviderRegistry,
  type ModelInfo,
  type ProviderErrorCode,
  type createProviderTransport,
} from '@assetnest/ai';
import type { AppConfig } from '@assetnest/config';
import { aiConnections, decryptSecret, type Database } from '@assetnest/db';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';

export const AI_PROVIDER_REGISTRY = Symbol('AI_PROVIDER_REGISTRY');
export const AI_PROVIDER_TRANSPORT = Symbol('AI_PROVIDER_TRANSPORT');

const TEST_TIMEOUT_MS = 10_000;
const MAX_MODELS = 100;
const SAFE_MODEL_FIELD = /^[^\p{Cc}\p{Cf}]+$/u;
const statusByProviderCode: Record<ProviderErrorCode, HttpStatus> = {
  invalid_endpoint: HttpStatus.UNPROCESSABLE_ENTITY,
  invalid_credentials: HttpStatus.UNPROCESSABLE_ENTITY,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  unsupported: HttpStatus.UNPROCESSABLE_ENTITY,
  unavailable: HttpStatus.BAD_GATEWAY,
  invalid_response: HttpStatus.BAD_GATEWAY,
  timeout: HttpStatus.GATEWAY_TIMEOUT,
};

export function providerTestFailure(error: unknown) {
  const code = error instanceof AIProviderError ? error.code : 'unavailable';
  return {
    code,
    exception: new HttpException(
      { message: `AI provider test failed (${code})`, code: `AI_PROVIDER_${code.toUpperCase()}` },
      statusByProviderCode[code],
      { cause: error },
    ),
  };
}

function safeModelField(value: string, credential: string | null): boolean {
  return (
    value.length <= 255 &&
    value.trim().length > 0 &&
    SAFE_MODEL_FIELD.test(value) &&
    (!credential || !value.includes(credential))
  );
}

function publicModels(models: readonly ModelInfo[], credential: string | null): ModelInfo[] {
  const publicById = new Map<string, ModelInfo>();
  for (const { id, label } of models) {
    if (!safeModelField(id, credential) || publicById.has(id)) continue;
    publicById.set(id, { id, label: safeModelField(label, credential) ? label : id });
    if (publicById.size === MAX_MODELS) break;
  }
  return [...publicById.values()];
}

@Injectable()
export class AiConnectionDiagnosticsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_PROVIDER_REGISTRY) private readonly registry: Pick<AIProviderRegistry, 'connect'>,
    @Inject(AI_PROVIDER_TRANSPORT) private readonly transport: typeof createProviderTransport,
  ) {}

  async test(ctx: WorkspaceContext, actorId: string, connectionId: string): Promise<{ models: ModelInfo[] }> {
    if (ctx.role !== 'owner' && ctx.role !== 'admin') {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Testing a provider requires an administrator session',
        'AI_CONNECTION_TEST_SESSION_REQUIRED',
      );
    }
    const [connection] = await this.db
      .select({
        kind: aiConnections.kind,
        endpoint: aiConnections.endpoint,
        encryptedCredential: aiConnections.encryptedCredential,
        enabled: aiConnections.enabled,
      })
      .from(aiConnections)
      .where(and(eq(aiConnections.workspaceId, ctx.workspaceId), eq(aiConnections.id, connectionId)))
      .limit(1);
    if (!connection) {
      throw httpCode(HttpStatus.NOT_FOUND, 'AI connection not found', 'AI_CONNECTION_NOT_FOUND');
    }
    if (!connection.enabled) {
      await this.audit(ctx, actorId, connectionId, { code: 'disabled' });
      throw httpCode(
        HttpStatus.CONFLICT,
        'Enable the AI connection before testing it',
        'AI_CONNECTION_DISABLED',
      );
    }

    let models: ModelInfo[];
    try {
      const credential = connection.encryptedCredential
        ? decryptSecret(connection.encryptedCredential, this.config.ENCRYPTION_KEY)
        : null;
      const transport = this.transport(
        connection.kind,
        connection.endpoint,
        credential,
        this.config.AI_PRIVATE_ORIGINS,
      );
      const adapter = this.registry.connect(connection.kind, transport);
      models = publicModels(await adapter.discoverModels(AbortSignal.timeout(TEST_TIMEOUT_MS)), credential);
    } catch (error) {
      const { code, exception } = providerTestFailure(error);
      await this.audit(ctx, actorId, connectionId, { code });
      throw exception;
    }

    await this.audit(ctx, actorId, connectionId, { modelCount: models.length });
    return { models };
  }

  private audit(
    ctx: WorkspaceContext,
    actorId: string,
    connectionId: string,
    result: { code: ProviderErrorCode | 'disabled' } | { modelCount: number },
  ) {
    return writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'ai_connection.tested',
      resource: 'ai_connection',
      resourceId: connectionId,
      metadata: result,
    });
  }
}
