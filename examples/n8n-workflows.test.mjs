import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const workflows = await Promise.all(
  ['n8n-asset-webhook-receiver.json', 'n8n-asset-health.json'].map(async (file) =>
    JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8')),
  ),
);
const [webhook, health] = workflows;
const getNode = (workflow, name) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, 'Missing workflow node ' + name);
  return node;
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const fixedTimestamp = Math.floor(Date.parse('2026-11-19T12:00:00.000Z') / 1000);
class FixtureDate extends Date {
  static now() {
    return fixedTimestamp * 1000;
  }
}

async function runCode(workflow, nodeName, { item, helpers, select } = {}) {
  const { jsCode } = getNode(workflow, nodeName).parameters;
  const run = new AsyncFunction('$input', '$', 'require', 'Date', jsCode);
  const onlyCrypto = (module) => {
    assert.equal(module, 'crypto');
    return { timingSafeEqual };
  };
  return run.call({ helpers }, { first: () => item }, select, onlyCrypto, FixtureDate);
}

const signingSecret = 'synthetic-test-fixture';
const event = {
  id: 'event-1',
  kind: 'asset.status_changed',
  occurredAt: '2026-11-19T12:00:00.000Z',
  workspaceId: 'workspace-1',
  resourceId: 'asset-1',
  payload: { displayName: 'Café Ω', status: 'lost' },
};
const rawBody = Buffer.from(JSON.stringify(event, null, 2) + '\r\n', 'utf8');

function sign(body, timestamp = fixedTimestamp) {
  const digest = createHmac('sha256', signingSecret)
    .update(String(timestamp) + '.')
    .update(body)
    .digest('hex');
  return 't=' + timestamp + ',v1=' + digest;
}

async function runWebhook({ body = rawBody, signature = sign(rawBody), missingRawBody = false } = {}) {
  const [prepared] = await runCode(webhook, 'Prepare signed body', {
    item: {
      json: {
        body: event,
        headers: { 'x-assetnest-signature': signature, 'x-assetnest-delivery': 'delivery-1' },
      },
    },
    helpers: {
      getBinaryDataBuffer(index, field) {
        assert.equal(index, 0);
        assert.equal(field, 'data');
        if (missingRawBody) throw new Error('Raw binary data unavailable');
        return body;
      },
    },
  });
  // Mirror the Crypto node using only the synthetic credential and the configured algorithm/output.
  const cryptoNode = getNode(webhook, 'Compute HMAC from credential');
  const { encoding, type, value, dataPropertyName } = cryptoNode.parameters;
  assert.equal(cryptoNode.typeVersion, 2);
  assert.equal(cryptoNode.parameters.action, 'hmac');
  assert.equal(value, '={{ $json.signedBody }}');
  prepared.json[dataPropertyName] = createHmac(type, signingSecret)
    .update(prepared.json.signedBody)
    .digest(encoding);
  return runCode(webhook, 'Verify HMAC signature', { item: prepared });
}

test('workflow graph references exist and ticket dispatch follows the verifier', () => {
  for (const workflow of workflows) {
    const names = new Set(workflow.nodes.map((node) => node.name));
    assert.equal(names.size, workflow.nodes.length);
    assert.equal(workflow.active, false);
    for (const [source, { main }] of Object.entries(workflow.connections)) {
      assert.ok(names.has(source));
      for (const { node } of main.flat()) assert.ok(names.has(node));
    }
  }
  const targetAfter = (node) => webhook.connections[node].main[0][0].node;
  assert.equal(getNode(webhook, 'AssetNest Webhook').parameters.options.rawBody, true);
  assert.equal(targetAfter('AssetNest Webhook'), 'Prepare signed body');
  assert.equal(targetAfter('Prepare signed body'), 'Compute HMAC from credential');
  assert.equal(targetAfter('Compute HMAC from credential'), 'Verify HMAC signature');
  assert.equal(targetAfter('Verify HMAC signature'), 'Event is asset.status_changed?');
});

test('webhook verifies exact UTF-8 bytes including whitespace and multibyte characters', async () => {
  const [result] = await runWebhook();
  assert.deepEqual(result.json, {
    verified: true,
    deliveryId: 'delivery-1',
    event: event.kind,
    eventId: event.id,
    occurredAt: event.occurredAt,
    workspaceId: event.workspaceId,
    resourceId: event.resourceId,
    payload: event.payload,
  });
});

test('webhook rejects a reserialized body and a bad signature without exposing data', async () => {
  const rejectsAsMismatch = (error) => error.message === 'AssetNest signature mismatch';
  await assert.rejects(runWebhook({ body: Buffer.from(JSON.stringify(event)) }), rejectsAsMismatch);
  await assert.rejects(
    runWebhook({ signature: 't=' + fixedTimestamp + ',v1=' + 'f'.repeat(64) }),
    rejectsAsMismatch,
  );
});

test('webhook rejects malformed headers, stale delivery and excessive clock skew', async () => {
  await assert.rejects(runWebhook({ signature: 'invalid' }), /Invalid AssetNest headers/);
  await assert.rejects(runWebhook({ signature: sign(rawBody, fixedTimestamp - 301) }), /replay window/);
  await assert.rejects(runWebhook({ signature: sign(rawBody, fixedTimestamp + 301) }), /replay window/);
});

test('webhook rejects a missing raw body or invalid UTF-8 instead of hashing parsed JSON', async () => {
  await assert.rejects(runWebhook({ missingRawBody: true }), /Raw binary data unavailable/);
  const invalidUtf8 = Buffer.from([0xc0, 0xaf]);
  await assert.rejects(runWebhook({ body: invalidUtf8, signature: sign(invalidUtf8) }), /body encoding/);
});

test('webhook reports invalid signed JSON without including the payload in the error', async () => {
  const malformed = Buffer.from('unparseable test body');
  await assert.rejects(
    runWebhook({ body: malformed, signature: sign(malformed) }),
    (error) => error.message === 'Invalid AssetNest JSON',
  );
});

function runHealth(lost, warranties) {
  const responses = { 'Lost assets': lost, 'Warranties expiring ≤30d': warranties };
  return runCode(health, 'Build digest', {
    select: (name) => ({ first: () => ({ json: responses[name] }) }),
  });
}

test('health digest uses the paginated total and counts only warranties expiring within 30 days', async () => {
  const [result] = await runHealth(
    { total: 22, items: [{ assetTag: 'LOST-1', displayName: 'Laptop', status: 'lost' }] },
    {
      warranties: [
        { assetTag: 'PAST-1', provider: 'Earlier', expiresOn: '2026-11-18', derivedStatus: 'expired' },
        { assetTag: 'SOON-1', provider: 'Coverage', expiresOn: '2026-11-30', derivedStatus: 'expiring_30' },
        { assetTag: 'LATER-1', provider: 'Coverage', expiresOn: '2027-01-20', derivedStatus: 'expiring_90' },
      ],
    },
  );
  assert.equal(result.json.lostCount, 22);
  assert.equal(result.json.expiringCount, 1);
  assert.deepEqual(result.json.digest.split('\n').slice(1), [
    'Lost assets: 22',
    ' - LOST-1: Laptop (lost)',
    'Warranties expiring within 30 days: 1',
    ' - SOON-1: Coverage expires 2026-11-30',
  ]);
});

test('health digest handles empty responses and rejects a mismatched warranty envelope', async () => {
  const [result] = await runHealth({ total: 0, items: [] }, { warranties: [] });
  assert.equal(result.json.lostCount, 0);
  assert.equal(result.json.expiringCount, 0);
  await assert.rejects(runHealth({ total: 0, items: [] }, { items: [] }), /Unexpected AssetNest response/);
});
