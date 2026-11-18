import { createParamDecorator, type ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import type { AuthContext, RequestWithAuth } from './session-auth.guard.js';

/** Extracts the authenticated user; only usable on non-@Public routes. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!request.auth) {
    throw new HttpException(
      { message: 'Authentication required', code: 'SESSION_REQUIRED' },
      HttpStatus.UNAUTHORIZED,
    );
  }
  return request.auth.user;
});

/** Extracts the full auth context (user + sessionId + sessionToken). */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!request.auth) {
    throw new HttpException(
      { message: 'Authentication required', code: 'SESSION_REQUIRED' },
      HttpStatus.UNAUTHORIZED,
    );
  }
  return request.auth;
});
