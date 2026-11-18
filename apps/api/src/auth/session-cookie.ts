import type { AppConfig } from '@assetnest/config';
import { SESSION_TTL_SECONDS } from './auth.constants.js';

export function sessionCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: config.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

export function clearSessionCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: config.NODE_ENV === 'production',
  };
}
