import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import type { Permission, WorkspaceRole } from '@assetnest/domain';
import { WORKSPACE_ROLES, roleHasPermission } from '@assetnest/domain';
import { memberships } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { PERMISSIONS_KEY } from './permissions.decorator.js';
import type { RequestWithAuth } from './session-auth.guard.js';

export interface WorkspaceContext {
  workspaceId: string;
  membershipId: string;
  role: WorkspaceRole | 'automation';
}

export type RequestWithWorkspace = RequestWithAuth & { workspace?: WorkspaceContext };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): HttpException {
  // 404 (not 403) for non-members: don't reveal that the workspace exists.
  return new HttpException(
    { message: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' },
    HttpStatus.NOT_FOUND,
  );
}

/**
 * Workspace membership guard — registered AFTER SessionGuard.
 * Activates only on routes with a `:workspaceId` route param:
 *  1. validates the id format (never reaches PG with a malformed uuid),
 *  2. loads the caller's ACTIVE membership (deny-by-default),
 *  3. enforces any @RequirePermissions(...) declared on the route.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWorkspace>();
    const rawParam = request.params?.workspaceId;
    const workspaceId = Array.isArray(rawParam) ? rawParam[0] : rawParam;
    if (workspaceId === undefined) {
      if (request.auth?.authType === 'api_token') {
        // Tokens are workspace-scoped; no token access to global routes.
        throw new HttpException(
          { message: 'API tokens cannot access this endpoint', code: 'TOKEN_SCOPE_EXCEEDED' },
          HttpStatus.FORBIDDEN,
        );
      }
      return true; // not a workspace-scoped route (browser session)
    }
    if (!request.auth) {
      return true; // SessionGuard already rejected unauthenticated requests
    }
    if (!UUID.test(workspaceId)) {
      throw notFound();
    }

    // API tokens are bound to exactly one workspace and carry their own scopes —
    // membership is not required, scope match is. This keeps automation usable
    // after the human creator loses access, with independently managed scopes.
    if (request.auth.authType === 'api_token') {
      if (request.auth.tokenWorkspaceId !== workspaceId) {
        throw notFound();
      }
      request.workspace = { workspaceId, membershipId: '', role: 'automation' };

      const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (required && required.length > 0) {
        const granted = new Set(request.auth.scopes ?? []);
        for (const permission of required) {
          if (!granted.has(permission)) {
            throw new HttpException(
              { message: 'Token does not grant this scope', code: 'INSUFFICIENT_SCOPE' },
              HttpStatus.FORBIDDEN,
            );
          }
        }
      }
      return true;
    }

    const [membership] = await this.db
      .select({ id: memberships.id, roleKey: memberships.roleKey })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.userId, request.auth.user.id),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1);
    if (!membership) {
      throw notFound();
    }

    const role = WORKSPACE_ROLES.find((r) => r === membership.roleKey);
    if (!role) {
      throw notFound(); // unknown role key — treat as not a member
    }
    request.workspace = { workspaceId, membershipId: membership.id, role };

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && required.length > 0) {
      for (const permission of required) {
        if (!roleHasPermission(role, permission)) {
          throw new HttpException(
            { message: 'Insufficient workspace permissions', code: 'INSUFFICIENT_SCOPE' },
            HttpStatus.FORBIDDEN,
          );
        }
      }
    }
    return true;
  }
}
