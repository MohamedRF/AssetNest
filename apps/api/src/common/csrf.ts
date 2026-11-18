import { createHmac, timingSafeEqual } from 'node:crypto';

/** Stateless synchronizer token, HMAC-SHA256 over the opaque session token. */
export function deriveCsrfToken(sessionToken: string, sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update(`csrf:${sessionToken}`).digest('base64url');
}

export function matchesCsrfToken(
  provided: string | undefined,
  sessionToken: string,
  sessionSecret: string,
): boolean {
  if (!provided) {
    return false;
  }
  const expected = Buffer.from(deriveCsrfToken(sessionToken, sessionSecret), 'utf8');
  const actual = Buffer.from(provided, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
