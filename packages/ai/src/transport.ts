import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { AIProviderError, type ProviderKind, type ProviderTransport } from './provider.js';

const nativeEndpoints = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
} as const;

const denyIpv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['169.254.0.0', 16], ['224.0.0.0', 3],
] as const) denyIpv4.addSubnet(address, prefix, 'ipv4');

const privateIpv4 = new BlockList();
for (const [address, prefix] of [
  ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24],
] as const) privateIpv4.addSubnet(address, prefix, 'ipv4');

const denyIpv6 = new BlockList();
for (const [address, prefix] of [
  ['::', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['2001::', 32], ['2002::', 16], ['fe80::', 10], ['ff00::', 8], ['fd00:ec2::254', 128],
] as const) denyIpv6.addSubnet(address, prefix, 'ipv6');

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
const localIpv6 = new BlockList();
localIpv6.addAddress('::1', 'ipv6');
localIpv6.addSubnet('fc00::', 7, 'ipv6');

const blockedIpv6 = new BlockList();
blockedIpv6.addSubnet('2001:db8::', 32, 'ipv6');

type Address = { address: string; family: number };
const MAX_RESPONSE_BYTES = 1024 * 1024;

function parseEndpoint(rawEndpoint: string): URL {
  let url: URL;
  try {
    url = new URL(rawEndpoint);
  } catch {
    throw new AIProviderError('invalid_endpoint');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username || url.password || url.search || url.hash
  ) throw new AIProviderError('invalid_endpoint');
  return url;
}

function allowedAddress({ address, family }: Address, privateAllowed: boolean): boolean {
  if (family === 4) {
    return !denyIpv4.check(address, 'ipv4') && (privateAllowed || !privateIpv4.check(address, 'ipv4'));
  }
  return family === 6 &&
    !denyIpv6.check(address, 'ipv6') &&
    !blockedIpv6.check(address, 'ipv6') &&
    (globalIpv6.check(address, 'ipv6') || (privateAllowed && localIpv6.check(address, 'ipv6')));
}

function resolveHost(host: string, signal: AbortSignal): Promise<Address[]> {
  const family = isIP(host);
  if (family) return Promise.resolve([{ address: host, family }]);

  return new Promise((resolve, reject) => {
    const abort = () => reject(new AIProviderError('timeout'));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    void lookup(host, { all: true })
      .then(resolve, () => reject(new AIProviderError('invalid_endpoint')))
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

async function resolveEndpoint(url: URL, privateOrigins: readonly string[], signal: AbortSignal): Promise<Address> {
  if (signal.aborted) throw new AIProviderError('timeout');
  const privateAllowed = privateOrigins.includes(url.origin);
  if (url.protocol === 'http:' && !privateAllowed) throw new AIProviderError('invalid_endpoint');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await resolveHost(host, signal);
  if (!addresses[0] || addresses.some((address) => !allowedAddress(address, privateAllowed))) {
    throw new AIProviderError('invalid_endpoint');
  }
  return addresses[0];
}

/** Validate tenant input without sending requests or credentials to the destination. */
export async function validateProviderEndpoint(
  kind: ProviderKind,
  rawEndpoint: string | null,
  privateOrigins: readonly string[],
  signal = AbortSignal.timeout(3_000),
): Promise<URL | null> {
  if (kind in nativeEndpoints) {
    if (rawEndpoint !== null) throw new AIProviderError('invalid_endpoint');
    return null;
  }
  if (!rawEndpoint) throw new AIProviderError('invalid_endpoint');
  const url = parseEndpoint(rawEndpoint);
  await resolveEndpoint(url, privateOrigins, signal);
  return url;
}

function statusError(status: number): AIProviderError {
  if (status === 401 || status === 403) return new AIProviderError('invalid_credentials');
  if (status === 429) return new AIProviderError('rate_limited');
  if ([400, 404, 405, 422].includes(status)) return new AIProviderError('unsupported');
  return new AIProviderError('unavailable');
}

function requestJson(
  url: URL,
  address: Address,
  options: { method: string; signal: AbortSignal; headers: Record<string, string>; body?: unknown },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers = { Accept: 'application/json', ...options.headers };
    if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json' });
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = send(url, {
      ...options,
      headers,
      // One checked address per request. The URL hostname still drives TLS
      // certificate and SNI verification, and redirects are never followed.
      agent: false,
      family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.destroy();
        reject(statusError(status));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy();
          reject(new AIProviderError('invalid_response'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
        } catch {
          reject(new AIProviderError('invalid_response'));
        }
      });
      response.on('error', () => reject(new AIProviderError(options.signal.aborted ? 'timeout' : 'unavailable')));
    });
    outgoing.on('error', () => reject(new AIProviderError(options.signal.aborted ? 'timeout' : 'unavailable')));
    outgoing.end(body);
  });
}

export function createProviderTransport(
  kind: ProviderKind,
  storedEndpoint: string | null,
  credential: string | null,
  privateOrigins: readonly string[],
): ProviderTransport {
  const native = kind in nativeEndpoints ? nativeEndpoints[kind as keyof typeof nativeEndpoints] : undefined;
  if ((native && storedEndpoint !== null) || (!native && !storedEndpoint)) {
    throw new AIProviderError('invalid_endpoint');
  }
  const base = parseEndpoint(native ?? storedEndpoint!);
  const prefix = base.pathname.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (kind === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  if (credential) {
    if (kind === 'anthropic') headers['x-api-key'] = credential;
    else if (kind === 'gemini') headers['x-goog-api-key'] = credential;
    else headers['Authorization'] = `Bearer ${credential}`;
  }

  return {
    async request({ path, method, body, signal }) {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      if (!path.startsWith('/') || path.startsWith('//')) throw new AIProviderError('invalid_endpoint');
      const url = new URL(`${prefix}${path}`, base.origin);
      if (url.origin !== base.origin || !url.pathname.startsWith(`${prefix}/`) || url.hash) {
        throw new AIProviderError('invalid_endpoint');
      }
      const address = await resolveEndpoint(url, native ? [] : privateOrigins, timeout);
      return requestJson(url, address, { method, headers, body, signal: timeout });
    },
  };
}
