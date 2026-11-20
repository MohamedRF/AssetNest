import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('Node webhook receiver authenticates raw bytes and deduplicates the signed event ID', async (t) => {
  const signingSecret = 'synthetic-receiver-fixture';
  const script = fileURLToPath(new URL('webhook-receiver.mjs', import.meta.url));
  const receiver = spawn(process.execPath, [script, '0'], {
    env: { ...process.env, WEBHOOK_SECRET: signingSecret },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const closed = once(receiver, 'exit');
  t.after(async () => {
    receiver.kill();
    await closed;
  });
  const [listening] = await once(receiver.stdout, 'data', { signal: AbortSignal.timeout(5000) });
  const url = /http:\/\/127\.0\.0\.1:\d+\/assetnest/.exec(listening.toString('utf8'))?.[0];
  assert.ok(url, 'receiver started on an ephemeral port');

  const body = Buffer.from('{ "id": "event-1", "kind": "asset.created", "payload": "Café" }\r\n');
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = (bytes, seconds) =>
    createHmac('sha256', signingSecret)
      .update(String(seconds) + '.')
      .update(bytes)
      .digest('hex');
  const send = (bytes, signature, deliveryId = 'delivery-1', seconds = timestamp) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'x-assetnest-signature': 't=' + seconds + ',v1=' + signature,
        'x-assetnest-delivery': deliveryId,
      },
      body: bytes,
      signal: AbortSignal.timeout(5000),
    });

  const signature = digest(body, timestamp);
  const valid = await send(body, signature);
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { ok: true });

  const retry = await send(body, signature, 'delivery-2');
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { ok: true, duplicate: true });

  const alteredBody = Buffer.from(JSON.stringify(JSON.parse(body)));
  const altered = await send(alteredBody, signature);
  assert.equal(altered.status, 401);
  const staleTimestamp = timestamp - 301;
  const stale = await send(body, digest(body, staleTimestamp), 'delivery-3', staleTimestamp);
  assert.equal(stale.status, 401);

  const invalidUtf8 = Buffer.from([0xc0, 0xaf]);
  const invalid = await send(invalidUtf8, digest(invalidUtf8, timestamp));
  assert.equal(invalid.status, 400);
  const tooLarge = Buffer.alloc(2 * 1024 * 1024 + 1);
  const oversized = await send(tooLarge, digest(tooLarge, timestamp));
  assert.equal(oversized.status, 413);
});
