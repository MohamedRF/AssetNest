/**
 * SSRF policy for outbound webhook destinations. Pure and dependency-free so
 * it can run in both the API (at registration) and the worker (at delivery
 * time, re-checked because DNS answers change). DNS-level verification is
 * the caller's responsibility (see assertHostIsPublic in api/webhooks and
 * worker/webhooks) — this module owns scheme/credential/literal-IP rules.
 *
 * Deployments that need webhooks to internal services must opt in explicitly
 * with WEBHOOKS_ALLOW_PRIVATE=true; it is off by default.
 */

export interface UrlPolicyOptions {
  allowPrivate?: boolean;
}

export interface UrlPolicyResult {
  ok: boolean;
  reason?: string;
}

function parseIpv4Literal(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number.parseInt(part, 10);
    if (value < 0 || value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local + cloud metadata 169.254.169.254
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 198 && (b === 18 || b === 19)) // benchmarking
  );
}

/** Expands an IPv6 literal into its 8 hextets, or null if malformed. Handles :: compression. */
function parseIpv6Hextets(host: string): number[] | null {
  const normalized = host.toLowerCase();
  if (normalized.length === 0 || normalized.includes('%')) return null;
  const halves = normalized.split('::');
  if (halves.length > 2) return null;

  const parsePart = (part: string): number[] | null => {
    if (part === '') return [];
    const pieces = part.split(':');
    const out: number[] = [];
    for (const piece of pieces) {
      // Embedded dotted-quad tail: ::ffff:1.2.3.4
      if (piece.includes('.')) {
        const octets = parseIpv4Literal(piece);
        if (!octets) return null;
        out.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(Number.parseInt(piece, 16));
    }
    return out;
  };

  const left = parsePart(halves[0]!);
  const right = halves.length === 2 ? parsePart(halves[1]!) : [];
  if (!left || !right) return null;

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function isPrivateIpv6(host: string): boolean {
  const hextets = parseIpv6Hextets(host);
  if (!hextets) return true; // unparseable IPv6 — fail closed

  // ::1 loopback and :: unspecified
  if (hextets.slice(0, 7).every((h) => h === 0) && (hextets[7] === 1 || hextets[7] === 0)) return true;
  // fe80::/10 link-local
  if ((hextets[0]! & 0xffc0) === 0xfe80) return true;
  // fc00::/7 unique-local
  if ((hextets[0]! & 0xfe00) === 0xfc00) return true;
  // IPv4-mapped ::ffff:a.b.c.d — last 32 bits carry the IPv4 address
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    const octets = [hextets[6]! >> 8, hextets[6]! & 0xff, hextets[7]! >> 8, hextets[7]! & 0xff];
    return isPrivateIpv4(octets);
  }
  return false;
}

/** True when the host is a private/loopback/link-local literal (works for IPs and bracket-enclosed IPv6). */
export function isPrivateHostLiteral(host: string): boolean {
  const ipv4 = parseIpv4Literal(host);
  if (ipv4) {
    return isPrivateIpv4(ipv4);
  }
  const unwrapped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (unwrapped.includes(':')) {
    return isPrivateIpv6(unwrapped);
  }
  const lower = unwrapped.toLowerCase();
  return (
    lower === 'localhost' ||
    lower.endsWith('.internal') ||
    lower.endsWith('.local') ||
    lower.endsWith('.localhost')
  );
}

/**
 * Validates the destination for an outbound webhook. Returns {ok} — callers
 * reject with a problem-details error; never silently rewrite the URL.
 */
export function validateWebhookUrl(rawUrl: string, options: UrlPolicyOptions = {}): UrlPolicyResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL is not parseable' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Only http(s) destinations are allowed' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Credentials in the destination URL are not allowed' };
  }
  const host = url.hostname;
  if (host.length === 0) {
    return { ok: false, reason: 'Destination host is empty' };
  }
  if (options.allowPrivate) {
    return { ok: true };
  }

  const ipv4 = parseIpv4Literal(host);
  if (ipv4) {
    return isPrivateIpv4(ipv4)
      ? { ok: false, reason: 'Private and link-local IP ranges are not allowed for webhook destinations' }
      : { ok: true };
  }
  if (host.startsWith('[') && host.endsWith(']')) {
    if (isPrivateIpv6(host.slice(1, -1))) {
      return {
        ok: false,
        reason: 'Private and link-local IP ranges are not allowed for webhook destinations',
      };
    }
    return { ok: true };
  }
  const lower = host.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.internal') ||
    lower.endsWith('.local') ||
    lower.endsWith('.localhost')
  ) {
    return { ok: false, reason: 'Internal hostnames are not allowed for webhook destinations' };
  }
  return { ok: true };
}
