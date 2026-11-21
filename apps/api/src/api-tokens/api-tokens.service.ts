import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { apiTokens } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { PERMISSIONS, permissionsForRole, type Permission, type WorkspaceRole } from '@assetnest/domain';
import { DATABASE } from '../common/tokens.js';
import { generateToken, sha256Hex } from '../common/crypto.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type { CreateTokenInput } from './dto.js';

type IssuedToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: Date | null;
  createdAt: Date;
  scopes: Permission[];
  token: string;
};

function expiryFrom(input: CreateTokenInput): Date | null {
  return input.expiresInDays === null
    ? null
    : new Date(Date.now() + (input.expiresInDays ?? 90) * 86_400_000);
}

@Injectable()
export class ApiTokensService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Token administration is a human, interactive action: an automation bearer
   * token (role 'automation') can never mint, rotate or revoke other tokens,
   * even if it somehow carried the integrations:manage scope. This blocks the
   * privilege-escalation path of a leaked automation token bootstrapping a
   * longer-lived credential.
   */
  private assertHumanSession(ctx: WorkspaceContext): WorkspaceRole {
    if (ctx.role === 'automation') {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'API token administration requires a workspace session',
        'AI_SESSION_REQUIRED',
      );
    }
    return ctx.role;
  }

  /**
   * A token may never carry more authority than the human minting it. Every
   * requested scope must be one the actor's role already holds in this
   * workspace, otherwise a low-privilege admin could self-escalate by issuing a
   * token with owner-level scopes.
   */
  private assertScopesWithinAuthority(ctx: WorkspaceContext, scopes: readonly Permission[]): void {
    const role = this.assertHumanSession(ctx);
    const allowed = new Set<Permission>(permissionsForRole(role));
    const exceeded = scopes.filter((scope) => !allowed.has(scope));
    if (exceeded.length > 0) {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Requested scopes exceed your workspace permissions',
        'TOKEN_SCOPE_EXCEEDED',
      );
    }
  }

  private buildToken() {
    const secret = generateToken(); // 43 chars base64url
    const token = `anst_${secret}`;
    return { token, tokenPrefix: token.slice(0, 13), tokenHash: sha256Hex(token) };
  }

  async create(ctx: WorkspaceContext, actorId: string, input: CreateTokenInput): Promise<IssuedToken> {
    this.assertScopesWithinAuthority(ctx, input.scopes);
    const expiresAt = expiryFrom(input);
    const { token, ...credentials } = this.buildToken();

    const [created] = await this.db
      .insert(apiTokens)
      .values({
        workspaceId: ctx.workspaceId,
        ownerId: actorId,
        name: input.name,
        tokenPrefix: credentials.tokenPrefix,
        tokenHash: credentials.tokenHash,
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

    if (!created) {
      throw httpCode(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not create token', 'TOKEN_FAILED');
    }

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'api_token.created',
      resource: 'api_token',
      resourceId: created.id,
      metadata: { name: input.name, scopes: input.scopes, expiresAt },
    });

    // The full token is shown exactly once; only its hash is stored.
    return { ...created, scopes: input.scopes, token };
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
    this.assertHumanSession(ctx);
    // Conditional update: only an un-revoked token in this workspace transitions.
    const [updated] = await this.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.workspaceId, ctx.workspaceId),
          // isNull guard keeps the revoke idempotent-safe and audit accurate.
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning({ id: apiTokens.id, name: apiTokens.name });
    if (!updated) {
      // Either missing or already revoked — do not reveal which across tenants.
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

  async rotate(ctx: WorkspaceContext, actorId: string, tokenId: string): Promise<IssuedToken> {
    this.assertHumanSession(ctx);
    // The whole rotation is one transaction: the original is locked, its scopes
    // re-validated against the actor, the replacement is minted, and only then
    // is the original revoked. Any failure rolls the whole thing back, so the
    // original credential survives; a concurrent second rotate blocks on the
    // row lock, observes the original already revoked, and cannot mint a second
    // replacement.
    return this.db.transaction(async (tx) => {
      const [original] = await tx
        .select({
          id: apiTokens.id,
          name: apiTokens.name,
          scopesJson: apiTokens.scopesJson,
          expiresAt: apiTokens.expiresAt,
          revokedAt: apiTokens.revokedAt,
        })
        .from(apiTokens)
        .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.workspaceId, ctx.workspaceId)))
        .limit(1)
        .for('update');
      if (!original) {
        throw httpCode(HttpStatus.NOT_FOUND, 'API token not found', 'TOKEN_NOT_FOUND');
      }
      if (original.revokedAt) {
        throw httpCode(HttpStatus.CONFLICT, 'API token is already revoked', 'TOKEN_ALREADY_REVOKED');
      }
      const scopes = (Array.isArray(original.scopesJson) ? original.scopesJson : []).filter(
        (scope): scope is Permission =>
          typeof scope === 'string' && (PERMISSIONS as readonly string[]).includes(scope),
      );
      if (scopes.length === 0) {
        throw httpCode(
          HttpStatus.CONFLICT,
          'Original token carries no valid scopes to rotate forward',
          'TOKEN_SCOPES_INVALID',
        );
      }
      this.assertScopesWithinAuthority(ctx, scopes);
      const expiresAt =
        original.expiresAt === null
          ? null
          : new Date(Math.max(Date.now() + 86_400_000, original.expiresAt.getTime()));
      const { token, ...credentials } = this.buildToken();

      const [created] = await tx
        .insert(apiTokens)
        .values({
          workspaceId: ctx.workspaceId,
          ownerId: actorId,
          name: original.name,
          tokenPrefix: credentials.tokenPrefix,
          tokenHash: credentials.tokenHash,
          scopesJson: scopes,
          expiresAt,
        })
        .returning({
          id: apiTokens.id,
          name: apiTokens.name,
          tokenPrefix: apiTokens.tokenPrefix,
          expiresAt: apiTokens.expiresAt,
          createdAt: apiTokens.createdAt,
        });
      if (!created) {
        throw httpCode(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not rotate token', 'TOKEN_FAILED');
      }

      await tx.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, original.id));

      await writeAuditLog(tx, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'api_token.rotated',
        resource: 'api_token',
        resourceId: created.id,
        metadata: { rotatedFrom: original.id },
      });

      return { ...created, scopes, token };
    });
  }
}
