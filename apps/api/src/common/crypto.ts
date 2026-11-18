import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Opaque 256-bit tokens, base64url-encoded (43 chars, URL-safe). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest — stored in the DB; the raw token never is. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time equality for fixed-length hex digests. */
export function digestsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
