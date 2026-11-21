#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
/**
 * AssetNest end-to-end demo against a running stack.
 *
 *   DEMO_BASE_URL=http://localhost:3000 \
 *   DEMO_EMAIL=owner@example.com DEMO_PASSWORD=… \
 *   node scripts/demo.mjs
 *
 * Flow: health → sign in (or bootstrap register) → workspace → category →
 * location → asset → export → download → verify the CSV contains the asset.
 * Prints a PASS/FAIL transcript and exits non-zero on the first failure.
 *
 * This is a demo/verification tool. It creates a demo workspace and asset in
 * the target tenant; run it against a disposable or staging stack.
 */
const BASE = (process.env.DEMO_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;
const suffix = randomUUID().split('-')[0];

let cookie = '';
let csrf = '';

function log(step, detail = '') {
  console.log(`${step}\t${detail}`);
}

async function request(method, path, { body } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

function captureSession(response) {
  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  cookie = setCookies.map((entry) => entry.split(';')[0]).join('; ');
  csrf = response.body?.csrfToken ?? '';
  assert(cookie && csrf, 'authentication returned no session cookie or CSRF token');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function authenticate() {
  const login = await request('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  if (login.status === 200) {
    captureSession(login);
    return 'login';
  }
  assert(login.status === 401, `sign-in failed (${login.status})`);
  const register = await request('POST', '/auth/register', {
    body: { displayName: 'Demo User', email: EMAIL, password: PASSWORD },
  });
  if (register.status === 201) {
    captureSession(register);
    return 'register';
  }
  throw new Error(`could not sign in or bootstrap (${login.status}/${register.status})`);
}

async function main() {
  assert(EMAIL && PASSWORD, 'set DEMO_EMAIL and DEMO_PASSWORD');
  log('health', `${BASE}/api/v1/health/live`);
  const health = await request('GET', '/health/live');
  assert(health.status === 200 && health.body?.status === 'ok', `health failed: ${health.status}`);

  const auth = await authenticate();
  const me = await request('GET', '/auth/me');
  assert(me.status === 200, `auth/me failed: ${me.status}`);
  log('auth', auth);

  const created = await request('POST', '/workspaces', {
    body: { name: 'Demo Workspace', slug: `demo-${suffix}`, mode: 'office' },
  });
  assert(created.status === 201 && created.body?.id, `workspace create failed: ${created.status}`);
  const workspace = created.body;
  const ws = workspace.id;
  log('workspace', `${workspace.name} (${ws})`);

  const category = await request('POST', `/workspaces/${ws}/categories`, {
    body: { name: `Demo Category ${suffix}` },
  });
  assert(category.status === 201, `category create failed: ${category.status}`);

  const location = await request('POST', `/workspaces/${ws}/locations`, {
    body: { name: `Demo Room ${suffix}`, type: 'room' },
  });
  assert(location.status === 201, `location create failed: ${location.status}`);

  const asset = await request('POST', `/workspaces/${ws}/assets`, {
    body: {
      assetTag: `DEMO-${suffix}`,
      displayName: 'Demo Laptop',
      serialNumber: 'DEMO-SN-1',
      categoryId: category.body.id,
      locationId: location.body.id,
      currency: 'USD',
      amount: '999.00',
    },
  });
  assert(asset.status === 201, `asset create failed: ${asset.status}`);
  log('asset', `${asset.body.assetTag} id=${asset.body.id}`);

  const detail = await request('GET', `/workspaces/${ws}/assets/${asset.body.id}`);
  assert(detail.status === 200 && detail.body.assetTag === asset.body.assetTag, 'asset read failed');
  log('asset-read', `${detail.body.displayName} · ${detail.body.status}`);

  const exportResult = await request('POST', `/workspaces/${ws}/exports`, { body: { report: 'assets' } });
  assert(exportResult.status === 201, `export create failed: ${exportResult.status}`);
  log('export', `id=${exportResult.body.id} status=${exportResult.body.status}`);

  const download = await request('GET', `/workspaces/${ws}/exports/${exportResult.body.id}/download`);
  assert(download.status === 200, `export download failed: ${download.status}`);
  const csv = typeof download.body === 'string' ? download.body : '';
  assert(csv.includes(asset.body.assetTag), 'exported CSV does not contain the demo asset');
  log('download', `${Buffer.byteLength(csv)} bytes · contains ${asset.body.assetTag}`);

  log('demo', 'PASS');
}

main().catch((error) => {
  console.error(`demo\tFAIL\t${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
