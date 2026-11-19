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
 *   4. Dedupes on `X-Assetnest-Delivery` (delivery is at-least-once).
 * Only after those three checks may the payload touch your business logic.
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

/** Delivery IDs seen recently — swap for Redis set with TTL in a real deployment. */
const seen = new Map(); // deliveryId -> timestamp ms

function isReplay(deliveryId) {
  const now = Date.now();
  for (const [id, at] of seen) {
    if (now - at > SKEW_SECONDS * 1000) seen.delete(id);
  }
  if (seen.has(deliveryId)) return true;
  seen.set(deliveryId, now);
  return false;
}

function verify(body, signatureHeader) {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader ?? '');
  if (!match) return { ok: false, reason: 'malformed signature header' };
  const [, timestamp, digest] = match;
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > SKEW_SECONDS) {
    return { ok: false, reason: 'timestamp outside the allowed skew window (replay?)' };
  }
  const expected = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
  const a = Buffer.from(digest, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true };
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/assetnest') {
    res.writeHead(404).end('not found');
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const check = verify(body, req.headers['x-assetnest-signature']);
    if (!check.ok) {
      console.warn(`[webhook] REJECTED: ${check.reason}`);
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: check.reason }));
      return;
    }
    const deliveryId = String(req.headers['x-assetnest-delivery'] ?? '');
    if (deliveryId && isReplay(deliveryId)) {
      console.log(`[webhook] duplicate delivery ${deliveryId} — acked, not processed`);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"duplicate":true}');
      return;
    }
    let event;
    try {
      event = JSON.parse(body);
    } catch {
      res.writeHead(400).end('invalid JSON');
      return;
    }
    console.log(`[webhook] event=${event.kind} id=${event.id} resource=${event.resourceId}`);
    // → your business logic here. Return 2xx quickly; do heavy work async.
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
});

server.listen(PORT, () => {
  console.log(`AssetNest webhook receiver listening on http://127.0.0.1:${PORT}/assetnest`);
  console.log('Point a webhook subscription at this URL (or a tunnel) and send a test delivery.');
});
