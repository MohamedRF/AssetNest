import { describe, expect, it } from 'vitest';
import { generateToken, sha256Hex, digestsEqual } from '../common/crypto.js';
import { parseCookies, serializeCookie, serializeExpiredCookie } from '../common/cookies.js';
import { deriveCsrfToken, matchesCsrfToken } from '../common/csrf.js';

describe('crypto tokens', () => {
  it('generates unique 256-bit url-safe tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('sha256Hex produces stable 64-char hex digests', () => {
    expect(sha256Hex('test')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('test')).toBe(sha256Hex('test'));
  });

  it('digestsEqual compares constant-length hex strings', () => {
    const a = sha256Hex('same');
    expect(digestsEqual(a, sha256Hex('same'))).toBe(true);
    expect(digestsEqual(a, sha256Hex('different'))).toBe(false);
    expect(digestsEqual(a, 'short')).toBe(false);
  });
});

describe('cookies', () => {
  it('parses a cookie header and decodes values', () => {
    const map = parseCookies('assetnest_session=abc123%3D%3D; theme=dark; =ignored; noequals');
    expect(map.get('assetnest_session')).toBe('abc123==');
    expect(map.get('theme')).toBe('dark');
    expect(map.size).toBe(2);
  });

  it('handles missing header and malformed entries gracefully', () => {
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies(';;;').size).toBe(0);
  });

  it('serializes with httpOnly, SameSite=Lax and path', () => {
    const cookie = serializeCookie('assetnest_session', 'tok', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
      maxAgeSeconds: 60,
    });
    expect(cookie).toContain('assetnest_session=tok');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=60');
  });

  it('expires cookies for logout', () => {
    const cookie = serializeExpiredCookie('assetnest_session', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
    });
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('assetnest_session=');
  });
});

describe('csrf synchronizer tokens', () => {
  const secret = 'test-secret-that-is-long-enough-to-be-safe-123456';

  it('derives stable tokens for a session token', () => {
    const sessionToken = generateToken();
    expect(deriveCsrfToken(sessionToken, secret)).toBe(deriveCsrfToken(sessionToken, secret));
    expect(deriveCsrfToken(sessionToken, secret)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('produces different tokens for different sessions and secrets', () => {
    const a = generateToken();
    const b = generateToken();
    expect(deriveCsrfToken(a, secret)).not.toBe(deriveCsrfToken(b, secret));
    expect(deriveCsrfToken(a, secret)).not.toBe(
      deriveCsrfToken(a, 'different-secret-that-is-long-enough-000'),
    );
  });

  it('validates only the exact derived token', () => {
    const sessionToken = generateToken();
    const csrf = deriveCsrfToken(sessionToken, secret);
    expect(matchesCsrfToken(csrf, sessionToken, secret)).toBe(true);
    expect(matchesCsrfToken('wrong', sessionToken, secret)).toBe(false);
    expect(matchesCsrfToken(undefined, sessionToken, secret)).toBe(false);
    expect(matchesCsrfToken(csrf, sessionToken, 'other-secret-that-is-long-enough-00000')).toBe(false);
  });
});
