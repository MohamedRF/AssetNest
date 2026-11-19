import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { apiTokens } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { PERMISSIONS } from '@assetnest/domain';
import { DATABASE } from '../common/tokens.js';
import { generateToken, sha256Hex } from '../common/crypto.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type { CreateTokenInput } from './dto.js';

@Injectable()
export class ApiTokensService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(ctx: WorkspaceContext, actorId: string, input: CreateTokenInput) {
    const secret = generateToken(); // 43 chars base64url
    const token = `anst_${secret}`;
    const expiresAt =
      input.expiresInDays === null ? null : new Date(Date.now() + (input.expiresInDays ?? 90) * 86_400_000);

    const [created] = await this.db
      .insert(apiTokens)
      .values({
        workspaceId: ctx.workspaceId,
        ownerId: actorId,
        name: input.name,
        tokenPrefix: token.slice(0, 13),
        tokenHash: sha256Hex(token),
        scopesJson: input.scopes,
        expiresAt,
      })
      .returning({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        expiresAt: apiTokens.expiresAt,
        createdAt: apiTokens.createdAt,
      });

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'api_token.created',
      resource: 'api_token',
      resourceId: created!.id,
      metadata: { name: input.name, scopes: input.scopes, expiresAt },
    });

    // The full token is shown exactly once; only its hash is stored.
    return { ...created!, scopes: input.scopes, token };
  }

  async list(ctx: WorkspaceContext) {
    return this.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        scopes: apiTokens.scopesJson,
        expiresAt: apiTokens.expiresAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.workspaceId, ctx.workspaceId))
      .orderBy(desc(apiTokens.createdAt));
  }

  async revoke(ctx: WorkspaceContext, actorId: string, tokenId: string) {
    const [updated] = await this.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.workspaceId, ctx.workspaceId)))
      .returning({ id: apiTokens.id, name: apiTokens.name });
    if (!updated) {
      throw httpCode(HttpStatus.NOT_FOUND, 'API token not found', 'TOKEN_NOT_FOUND');
    }
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'api_token.revoked',
      resource: 'api_token',
      resourceId: updated.id,
      metadata: { name: updated.name },
    });
    return { ok: true };
  }

  async rotate(ctx: WorkspaceContext, actorId: string, tokenId: string) {
    const [original] = await this.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        scopesJson: apiTokens.scopesJson,
        expiresAt: apiTokens.expiresAt,
      })
      .from(apiTokens)
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!original) {
      throw httpCode(HttpStatus.NOT_FOUND, 'API token not found', 'TOKEN_NOT_FOUND');
    }
    await this.db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, original.id));
    const scopes = (Array.isArray(original.scopesJson) ? original.scopesJson : []).filter(
      (scope): scope is (typeof PERMISSIONS)[number] =>
        typeof scope === 'string' && (PERMISSIONS as readonly string[]).includes(scope),
    );
    if (scopes.length === 0) {
      throw httpCode(
        HttpStatus.CONFLICT,
        'Original token carries no valid scopes to rotate forward',
        'TOKEN_SCOPES_INVALID',
      );
    }
    const created = await this.create(ctx, actorId, {
      name: original.name,
      scopes,
      expiresInDays:
        original.expiresAt === null
          ? null
          : Math.max(1, Math.ceil((original.expiresAt.getTime() - Date.now()) / 86_400_000)),
    });
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'api_token.rotated',
      resource: 'api_token',
      resourceId: created.id,
      metadata: { rotatedFrom: original.id },
    });
    return created;
  }
}
