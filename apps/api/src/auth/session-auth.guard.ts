import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { apiTokens, users } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { IS_PUBLIC_KEY } from '../common/public.decorator.js';
import { parseCookies } from '../common/cookies.js';
import { sha256Hex } from '../common/crypto.js';
import { SESSION_COOKIE } from './auth.constants.js';
import type { PublicUser } from './auth.service.js';
import { AuthService } from './auth.service.js';

export interface AuthContext {
  user: PublicUser;
  sessionId: string;
  /** Raw opaque token — needed only by the CSRF guard; never logged. Empty for API tokens. */
  sessionToken: string;
  authType: 'session' | 'api_token';
  /** API tokens only: the workspace the token is bound to. */
  tokenWorkspaceId?: string;
  /** API tokens only: scopes granted by the token (subset of permission keys). */
  scopes?: string[];
}

export type RequestWithAuth = Request & { auth?: AuthContext };

/**
 * Global session guard (runs before all routes, registered via APP_GUARD).
 * Public routes (@Public) pass through with req.auth unset.
 * Everything else requires a valid assetnest_session cookie.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();

    // Bearer API token path: `Authorization: Bearer anst_...` — hashed, workspace-bound.
    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return this.authenticateApiToken(request, authHeader.slice('Bearer '.length).trim());
    }

    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (!token) {
      throw new HttpException(
        { message: 'Authentication required', code: 'SESSION_REQUIRED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.authService.validateSessionToken(token);
    if (!result) {
      throw new HttpException(
        { message: 'Session is invalid or expired', code: 'SESSION_INVALID' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    request.auth = {
      user: result.user,
      sessionId: result.sessionId,
      sessionToken: result.sessionToken,
      authType: 'session',
    };
    return true;
  }

  private async authenticateApiToken(request: RequestWithAuth, presented: string): Promise<boolean> {
    if (!presented.startsWith('anst_')) {
      throw new HttpException(
        { message: 'API token is invalid or expired', code: 'API_TOKEN_INVALID' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const tokenHash = sha256Hex(presented);
    const [row] = await this.db
      .select({
        id: apiTokens.id,
        workspaceId: apiTokens.workspaceId,
        ownerId: apiTokens.ownerId,
        scopesJson: apiTokens.scopesJson,
        expiresAt: apiTokens.expiresAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
        ownerEmail: users.email,
        ownerName: users.displayName,
      })
      .from(apiTokens)
      .leftJoin(users, eq(users.id, apiTokens.ownerId))
      .where(eq(apiTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row || row.revokedAt !== null || (row.expiresAt !== null && row.expiresAt <= new Date())) {
      throw new HttpException(
        { message: 'API token is invalid or expired', code: 'API_TOKEN_INVALID' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const scopes = Array.isArray(row.scopesJson) ? (row.scopesJson as string[]) : [];
    request.auth = {
      user: {
        id: row.ownerId ?? 'unattributed',
        email: row.ownerEmail ?? 'token@assetnest.local',
        displayName: row.ownerName ?? 'API token',
      },
      sessionId: `token:${row.id}`,
      sessionToken: '',
      authType: 'api_token',
      tokenWorkspaceId: row.workspaceId,
      scopes,
    };
    // Throttle last_used_at to one write per minute per token.
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      void this.db
        .update(apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiTokens.id, row.id))
        .execute()
        .catch(() => undefined);
    }
    return true;
  }
}
