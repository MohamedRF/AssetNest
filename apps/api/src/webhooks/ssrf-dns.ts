import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpException, HttpStatus } from '@nestjs/common';
import { isPrivateHostLiteral } from '@assetnest/contracts';

/**
 * DNS-level SSRF guard. The string policy already rejects literal private
 * hosts; this catches public hostnames that resolve into private space
 * (compromised DNS, split-horizon, rebinding). Called at registration time
 * and again at delivery time — DNS answers change, policy does not.
 */
export async function assertHostResolvesPublicly(hostname: string, allowPrivate: boolean): Promise<void> {
  if (allowPrivate) {
    return;
  }
  // Literal IPs were validated at the string layer; no DNS answer needed.
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0) {
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new HttpException(
      { message: 'Destination hostname does not resolve', code: 'WEBHOOK_DNS_FAILED' },
      HttpStatus.BAD_REQUEST,
    );
  }
  for (const { address } of addresses) {
    if (isPrivateHostLiteral(address)) {
      throw new HttpException(
        { message: 'Destination hostname resolves to a private address', code: 'WEBHOOK_SSRF_BLOCKED' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
