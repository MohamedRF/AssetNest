/** Minimal, strict cookie helpers for a single known cookie. No dependency. */

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  secure: boolean;
  maxAgeSeconds?: number;
}

/** Parse the Cookie header into a name→value map (first occurrence wins). */
export function parseCookies(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) {
    return map;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    if (!name || map.has(name)) {
      continue;
    }
    try {
      map.set(name, decodeURIComponent(raw));
    } catch {
      // Malformed percent-encoding — ignore the cookie rather than crash.
    }
  }
  return map;
}

/** Serialize a Set-Cookie value. Values are base64url, so encoding is stable. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const segments = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`];
  if (options.maxAgeSeconds !== undefined) {
    segments.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options.httpOnly) {
    segments.push('HttpOnly');
  }
  segments.push(`SameSite=${options.sameSite === 'lax' ? 'Lax' : options.sameSite === 'strict' ? 'Strict' : 'None'}`);
  if (options.secure) {
    segments.push('Secure');
  }
  return segments.join('; ');
}

/** Serialize an expired cookie for logout (Max-Age=0). */
export function serializeExpiredCookie(name: string, options: Omit<CookieOptions, 'maxAgeSeconds'>): string {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 });
}
