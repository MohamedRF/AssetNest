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
import { IS_PUBLIC_KEY } from '../common/public.decorator.js';
import { parseCookies } from '../common/cookies.js';
import { SESSION_COOKIE } from './auth.constants.js';
import type { PublicUser } from './auth.service.js';
import { AuthService } from './auth.service.js';

export interface AuthContext {
  user: PublicUser;
  sessionId: string;
  /** Raw opaque token — needed only by the CSRF guard; never logged. */
  sessionToken: string;
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
    request.auth = { user: result.user, sessionId: result.sessionId, sessionToken: result.sessionToken };
    return true;
  }
}
