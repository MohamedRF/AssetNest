#!/usr/bin/env node
/**
 * Dependency-free HTTP load probe for a running AssetNest stack.
 *
 *   LOAD_TEST_BASE_URL=http://localhost:3000 \
 *   LOAD_TEST_EMAIL=owner@example.com LOAD_TEST_PASSWORD=… \
 *   LOAD_TEST_REQUESTS=200 LOAD_TEST_CONCURRENCY=8 \
 *   node scripts/load-test.mjs
 *
 * Exercises public health plus (when credentials are supplied) auth/me, the
 * asset list and a search page. Reports per-probe p50/p95/p99 latency and the
 * overall error rate. This is a smoke/load probe, not a formal benchmark; run
 * it against a disposable or staging environment, never production.
 *
 * Exit code is non-zero when the error rate exceeds 2%.
 */
import { performance } from 'node:perf_hooks';

const BASE = (process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const EMAIL = process.env.LOAD_TEST_EMAIL;
const PASSWORD = process.env.LOAD_TEST_PASSWORD;
const REQUESTS = Number(process.env.LOAD_TEST_REQUESTS ?? 200);
const CONCURRENCY = Number(process.env.LOAD_TEST_CONCURRENCY ?? 8);
const TIMEOUT_MS = 10_000;

function request(path, options = {}) {
  return fetch(`${API}${path}`, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[index];
}

function summarize(results) {
  const byProbe = new Map();
  for (const result of results) {
    if (!byProbe.has(result.probe)) byProbe.set(result.probe, []);
    byProbe.get(result.probe).push(result);
  }
  const probes = {};
  for (const [probe, rows] of byProbe) {
    const latencies = rows.map((row) => row.ms).sort((a, b) => a - b);
    const failures = rows.filter((row) => !row.ok).length;
    probes[probe] = {
      samples: rows.length,
      p50_ms: Number(percentile(latencies, 50).toFixed(1)),
      p95_ms: Number(percentile(latencies, 95).toFixed(1)),
      p99_ms: Number(percentile(latencies, 99).toFixed(1)),
      errors: failures,
    };
  }
  return probes;
}

async function login() {
  if (!EMAIL || !PASSWORD) return '';
  const response = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`login failed with HTTP ${response.status}`);
  }
  await response.arrayBuffer();
  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map((entry) => entry.split(';')[0]).join('; ');
  if (!cookie) throw new Error('login returned no session cookie');
  return cookie;
}

async function firstWorkspace(cookie) {
  if (!cookie) return undefined;
  if (process.env.LOAD_TEST_WORKSPACE_ID) return process.env.LOAD_TEST_WORKSPACE_ID;
  const response = await request('/workspaces', { headers: { cookie, accept: 'application/json' } });
  if (!response.ok) throw new Error(`workspace discovery failed with HTTP ${response.status}`);
  const body = await response.json();
  const workspaceId = body.workspaces?.[0]?.id;
  if (!workspaceId) throw new Error('the load-test user has no workspace');
  return workspaceId;
}

async function main() {
  if (!Number.isSafeInteger(REQUESTS) || REQUESTS < 1 || REQUESTS > 100_000) {
    throw new Error('LOAD_TEST_REQUESTS must be an integer from 1 to 100000');
  }
  if (!Number.isSafeInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 256) {
    throw new Error('LOAD_TEST_CONCURRENCY must be an integer from 1 to 256');
  }
  if (Boolean(EMAIL) !== Boolean(PASSWORD)) {
    throw new Error('set both LOAD_TEST_EMAIL and LOAD_TEST_PASSWORD for authenticated probes');
  }
  const cookie = await login();
  const workspace = await firstWorkspace(cookie);
  const workspaceId = workspace && encodeURIComponent(workspace);
  const probes = [
    { name: 'health/live', path: '/health/live', auth: false },
    ...(cookie
      ? [
          { name: 'auth/me', path: '/auth/me', auth: true },
          ...(workspaceId
            ? [
                { name: 'assets/list', path: `/workspaces/${workspaceId}/assets?limit=100`, auth: true },
                {
                  name: 'assets/search',
                  path: `/workspaces/${workspaceId}/assets?q=a&limit=100`,
                  auth: true,
                },
              ]
            : []),
        ]
      : []),
  ];
  if (!cookie) {
    console.warn('[load-test] no credentials supplied — running public probes only');
  }
  if (REQUESTS < probes.length)
    throw new Error(`at least ${probes.length} requests are required for these probes`);

  const results = [];
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= REQUESTS) return;
      const probe = probes[index % probes.length];
      const started = performance.now();
      try {
        const response = await request(probe.path, {
          headers: { accept: 'application/json', ...(probe.auth ? { cookie } : {}) },
        });
        await response.arrayBuffer();
        results.push({ probe: probe.name, ok: response.ok, ms: performance.now() - started });
      } catch {
        results.push({
          probe: probe.name,
          ok: false,
          ms: performance.now() - started,
        });
      }
    }
  }

  const concurrency = Math.min(CONCURRENCY, REQUESTS);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const failures = results.filter((row) => !row.ok).length;
  const summary = {
    base: BASE,
    requests: results.length,
    concurrency,
    errorRate: Number((failures / results.length).toFixed(4)),
    probes: summarize(results),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures / results.length > 0.02) {
    console.error('[load-test] error rate above 2%');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[load-test] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
