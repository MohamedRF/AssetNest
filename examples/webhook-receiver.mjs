/* eslint-disable no-console -- CLI example: stdout is the interface */
/**
 * AssetNest outbound webhook receiver — production-shaped, zero dependencies.
 *
 *   WEBHOOK_SECRET=whsec_... node examples/webhook-receiver.mjs [port]
 *
 * What it does, and why:
 *   1. Reads the RAW body (verification must run over bytes, not a re-serialized object).
 *   2. Verifies `X-Assetnest-Signature: t=<unix>,v1=<hex-hmac-sha256(`${t}.${body}`)>`
 *      against the signing secret shown once when the webhook was created.
 *   3. Enforces a 5-minute timestamp skew window (replay prevention).
 *   4. Dedupes by the signed event ID (delivery is at-least-once).
 * These checks run before the payload reaches business logic.
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.WEBHOOK_SECRET;
if (!SECRET) {
  console.error('Set WEBHOOK_SECRET to the signing secret shown when the webhook was created.');
  process.exit(1);
}
const PORT = Number(process.argv[2] ?? 8787);
const SKEW_SECONDS = 300;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Recently processed event IDs. Use durable storage for production idempotency. */
const seen = new Map();

function isReplay(eventId, expiresAt) {
  const now = Date.now();
  for (const [id, expiration] of seen) {
    if (now > expiration) seen.delete(id);
  }
  const previousExpiration = seen.get(eventId);
  seen.set(eventId, Math.max(previousExpiration ?? 0, expiresAt));
  return previousExpiration !== undefined;
}

function verify(body, signatureHeader) {
  const match = typeof signatureHeader === 'string' && /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader);
  if (!match) return { ok: false, reason: 'malformed signature header' };
  const [, timestamp, digest] = match;
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > SKEW_SECONDS) {
    return { ok: false, reason: 'timestamp outside the allowed skew window (replay?)' };
  }
  const expected = createHmac('sha256', SECRET).update(`${timestamp}.`).update(body).digest();
  const a = Buffer.from(digest, 'hex');
  if (!timingSafeEqual(a, expected)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true, expiresAt: (t + SKEW_SECONDS) * 1000 };
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/assetnest') {
    res.writeHead(404).end('not found');
    return;
  }
  const chunks = [];
  let bodySize = 0;
  req.on('data', (chunk) => {
    if (res.headersSent) return;
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_BYTES) {
      chunks.length = 0;
      res.writeHead(413, { connection: 'close' }).end('body too large');
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', () => {
    if (!res.headersSent && !res.destroyed) res.writeHead(400).end('invalid request');
  });
  req.on('end', () => {
    if (res.headersSent || res.destroyed) return;
    const body = Buffer.concat(chunks, bodySize);
    const check = verify(body, req.headers['x-assetnest-signature']);
    if (!check.ok) {
      console.warn(`[webhook] REJECTED: ${check.reason}`);
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: check.reason }));
      return;
    }
    let event;
    try {
      event = JSON.parse(utf8.decode(body));
    } catch {
      res.writeHead(400).end('invalid JSON');
      return;
    }
    if (!event || typeof event.kind !== 'string' || typeof event.id !== 'string' || !event.id) {
      res.writeHead(400).end('invalid event');
      return;
    }
    if (isReplay(event.id, check.expiresAt)) {
      console.log('[webhook] acknowledged duplicate event');
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"duplicate":true}');
      return;
    }
    console.log('[webhook] received verified event');
    // → your business logic here. Return 2xx quickly; do heavy work async.
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
});

server.listen(PORT, () => {
  console.log(`AssetNest webhook receiver listening on http://127.0.0.1:${server.address().port}/assetnest`);
  console.log('Point a webhook subscription at this URL (or a tunnel) and send a test delivery.');
});
