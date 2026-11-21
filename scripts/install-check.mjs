#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
/**
 * Reproducible installation check for AssetNest.
 *
 *   INSTALL_BASE_URL=http://localhost:3000 \
 *   INSTALL_EMAIL=install@example.com INSTALL_PASSWORD=… \
 *   node scripts/install-check.mjs
 *
 * Verifies a freshly installed stack end-to-end: readiness, version, bootstrap
 * sign-in, workspace creation, asset creation and read-back. Prints a compact
 * evidence block and exits non-zero on failure.
 */
const BASE = (process.env.INSTALL_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const EMAIL = process.env.INSTALL_EMAIL;
const PASSWORD = process.env.INSTALL_PASSWORD;
const suffix = randomUUID().split('-')[0];

let cookie = '';
let csrf = '';

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

async function main() {
  assert(EMAIL && PASSWORD, 'set INSTALL_EMAIL and INSTALL_PASSWORD');
  const evidence = { base: BASE, checks: [] };

  const live = await request('GET', '/health/live');
  assert(live.status === 200, `liveness failed: ${live.status}`);
  evidence.checks.push('health/live 200');

  const ready = await request('GET', '/health/ready');
  assert(ready.status === 200 && ready.body?.status === 'ready', `readiness failed: ${ready.status}`);
  evidence.checks.push('health/ready 200 (database up)');

  const version = await request('GET', '/version');
  assert(version.status === 200 && version.body?.version, 'version endpoint failed');
  evidence.version = version.body.version;
  evidence.checks.push(`version ${version.body.version} on ${version.body.node}`);

  const login = await request('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  let auth;
  if (login.status === 200) {
    captureSession(login);
    auth = 'login';
  } else {
    assert(login.status === 401, `sign-in failed (${login.status})`);
    const register = await request('POST', '/auth/register', {
      body: { displayName: 'Install Check', email: EMAIL, password: PASSWORD },
    });
    assert(register.status === 201, `bootstrap register failed: ${register.status}`);
    captureSession(register);
    auth = 'bootstrap-register';
  }
  evidence.checks.push(`auth (${auth})`);

  const me = await request('GET', '/auth/me');
  assert(me.status === 200, `auth/me failed: ${me.status}`);

  const created = await request('POST', '/workspaces', {
    body: { name: 'Install Check', slug: `install-${suffix}`, mode: 'office' },
  });
  assert(created.status === 201 && created.body?.id, `workspace create failed: ${created.status}`);
  const workspaceId = created.body.id;
  evidence.checks.push('workspace created');

  const asset = await request('POST', `/workspaces/${workspaceId}/assets`, {
    body: {
      assetTag: `INSTALL-${suffix}`,
      displayName: 'Install check asset',
      currency: 'USD',
      amount: '1.00',
    },
  });
  assert(asset.status === 201, `asset create failed: ${asset.status}`);
  evidence.checks.push('asset created');

  const readBack = await request('GET', `/workspaces/${workspaceId}/assets/${asset.body.id}`);
  assert(readBack.status === 200 && readBack.body.assetTag === asset.body.assetTag, 'asset read-back failed');
  evidence.checks.push('asset read-back');

  console.log(JSON.stringify({ status: 'PASS', ...evidence }, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify({ status: 'FAIL', error: error instanceof Error ? error.message : error }, null, 2),
  );
  process.exitCode = 1;
});
