import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from '@assetnest/config';
import { IS_PUBLIC_KEY } from '../common/public.decorator.js';
import { matchesCsrfToken } from '../common/csrf.js';
import { APP_CONFIG } from '../common/tokens.js';
import type { RequestWithAuth } from './session-auth.guard.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global CSRF guard — registered AFTER SessionGuard via APP_GUARD.
 * Only mutating, session-cookie-authenticated requests need a token.
 * The token is derived from the session token itself (HMAC, see common/csrf).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    // MCP tool/resource/prompt handlers run through the guard pipeline without
    // an HTTP request; CSRF does not apply there (bearer tokens, no cookies).
    if (!request || typeof request.method !== 'string') {
      return true;
    }
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }
    // Routes that establish a session (login/register) are @Public and skipped above.
    if (!request.auth) {
      // No session → the SessionGuard already rejected this request.
      return true;
    }
    // Session cookies need the synchronizer token; bearer API tokens are not cookies → immune to CSRF.
    if (request.auth.authType === 'api_token') {
      return true;
    }
    if (!request.auth.sessionToken) {
      return true;
    }
    const provided = request.headers['x-csrf-token'];
    const headerValue = Array.isArray(provided) ? provided[0] : provided;
    if (!matchesCsrfToken(headerValue, request.auth.sessionToken, this.config.SESSION_SECRET)) {
      throw new HttpException(
        { message: 'Missing or invalid CSRF token', code: 'CSRF_TOKEN_INVALID' },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
