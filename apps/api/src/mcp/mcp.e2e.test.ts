import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';
import { Test } from '@nestjs/testing';

// MCP must be enabled before AppModule is evaluated (module-scope flag).
process.env['MCP_ENABLED'] = 'true';

const { AppModule } = await import('../app.module.js');

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../../packages/db/migrations');

let client: PGlite;
let app: INestApplication;

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-mcp',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-mcp',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'true',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function sessionCookieOf(res: { headers: Record<string, unknown> }): string {
  const cookie = asStringArray(res.headers['set-cookie'] as string | string[] | undefined).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  );
  if (!cookie) throw new Error('expected a session cookie');
  return cookie.split(';')[0]!;
}

const http = () => request(app.getHttpServer());

const PROTOCOL_VERSION = '2026-07-28';
const META = {
  'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'assetnest-e2e', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

/** One MCP request with all the 2026-07-28 transport headers. */
function mcp(
  token: string | null,
  method: string,
  params: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) {
  const name =
    typeof params['name'] === 'string'
      ? (params['name'] as string)
      : typeof params['uri'] === 'string'
        ? (params['uri'] as string)
        : undefined;
  const agent = http()
    .post('/api/v1/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .set('MCP-Protocol-Version', PROTOCOL_VERSION)
    .set('Mcp-Method', method);
  if (name !== undefined) agent.set('Mcp-Name', name);
  if (token !== null) agent.set('Authorization', `Bearer ${token}`);
  for (const [key, value] of Object.entries(extraHeaders)) agent.set(key, value);
  return agent.send({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e9),
    method,
    params: { ...params, _meta: META },
  });
}

/** Tool results carry JSON in a text content block (no outputSchema) — parse it. */
function toolData<T = Record<string, unknown>>(res: request.Response): T {
  const content = (res.body as { result?: { content?: Array<{ type: string; text: string }> } }).result
    ?.content;
  const text = content?.find((c) => c.type === 'text')?.text;
  if (!text)
    throw new Error(`tool result had no text content (status ${res.status}): ${res.text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`tool result text was not JSON (status ${res.status}): ${text.slice(0, 300)}`);
  }
}

let ownerCookie: string;
let ownerCsrf: string;
let workspaceId: string;
let readToken: string;
let writeToken: string;
let assetId: string;
let assetVersion: number;

beforeAll(async () => {
  client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder });
  const testDb = pgliteDb as unknown as Database;
  await seedRoles(testDb);

  const config: AppConfig = loadConfig(testEnv);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(DATABASE)
    .useValue(testDb)
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();

  const register = await http()
    .post('/api/v1/auth/register')
    .send({ displayName: 'Owner', email: 'owner@example.com', password: 'owner-passphrase-123' });
  ownerCookie = sessionCookieOf(register);
  ownerCsrf = register.body.csrfToken as string;

  const ws = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', ownerCookie)
    .set('x-csrf-token', ownerCsrf)
    .send({ name: 'MCP WS', slug: 'mcp-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;

  const readTok = await http()
    .post(`/api/v1/workspaces/${workspaceId}/api-tokens`)
    .set('Cookie', ownerCookie)
    .set('x-csrf-token', ownerCsrf)
    .send({ name: 'mcp-reader', scopes: ['assets:read', 'reports:read'], expiresInDays: 30 });
  readToken = readTok.body.token as string;

  const writeTok = await http()
    .post(`/api/v1/workspaces/${workspaceId}/api-tokens`)
    .set('Cookie', ownerCookie)
    .set('x-csrf-token', ownerCsrf)
    .send({
      name: 'mcp-writer',
      scopes: ['assets:read', 'assets:write', 'assets:assign', 'reports:read'],
      expiresInDays: 30,
    });
  writeToken = writeTok.body.token as string;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  delete process.env['MCP_ENABLED'];
});

describe('MCP over Streamable HTTP (2026-07-28)', () => {
  it('rejects calls without a bearer token (401 + challenge)', async () => {
    const res = await mcp(null, 'server/discover', {});
    expect(res.status).toBe(401);
  });

  it('server/discover returns versions, capabilities and serverInfo', async () => {
    const res = await mcp(readToken, 'server/discover', {});
    expect(res.status).toBe(200);
    expect(res.body.result.resultType).toBe('complete');
    expect(res.body.result.supportedVersions).toContain('2026-07-28');
    expect(res.body.result.capabilities).toMatchObject({ tools: expect.anything() });
    expect(res.body.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('assetnest');
  });

  it('missing MCP-Protocol-Version header is rejected', async () => {
    const res = await http()
      .post('/api/v1/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set('Mcp-Method', 'server/discover')
      .set('Authorization', `Bearer ${readToken}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32020);
  });

  it('too-new protocol version is rejected with the supported list', async () => {
    const res = await http()
      .post('/api/v1/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set('MCP-Protocol-Version', '2999-01-01')
      .set('Mcp-Method', 'server/discover')
      .set('Authorization', `Bearer ${readToken}`)
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'server/discover',
        params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2999-01-01' } },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32022);
    expect(JSON.stringify(res.body)).toContain('2026-07-28');
  });

  it('header/body method mismatch is rejected (-32020)', async () => {
    const res = await http()
      .post('/api/v1/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set('MCP-Protocol-Version', PROTOCOL_VERSION)
      .set('Mcp-Method', 'tools/list') // header says tools/list, body says server/discover
      .set('Authorization', `Bearer ${readToken}`)
      .send({ jsonrpc: '2.0', id: 2, method: 'server/discover', params: { _meta: META } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32020);
  });

  it('unknown RPC method answers 404 with -32601', async () => {
    const res = await mcp(readToken, 'bogus/method', {});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(-32601);
  });

  it('tools/list advertises the full catalog (enforcement happens at call time)', async () => {
    // The module does not scope-filter tools/list; every tool is advertised
    // and calls made without the required scope get HTTP 403 insufficient_scope.
    const res = await mcp(readToken, 'tools/list', {});
    expect(res.status).toBe(200);
    const names = (res.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain('assets_list');
    expect(names).toContain('assets_create');
    expect(names).toContain('custody_assign');
    expect(names).toContain('imports_run');
    // Deterministic ordering (same set, same order across calls).
    const again = await mcp(readToken, 'tools/list', {});
    const namesAgain = (again.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(namesAgain).toEqual(names);
  });

  it('scope enforcement: reader calling assets_create gets 403', async () => {
    const res = await mcp(readToken, 'tools/call', {
      name: 'assets_create',
      arguments: { assetTag: 'MCP-0001', displayName: 'Nope' },
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'insufficient_scope' });
    expect(res.headers['www-authenticate']).toMatch(/scope="?([^,]*)assets:write/);
  });

  it('full CRUD round trip: create → get → update (CAS) → archive', async () => {
    const created = await mcp(writeToken, 'tools/call', {
      name: 'assets_create',
      arguments: {
        assetTag: 'MCP-0002',
        displayName: 'MCP round trip',
        condition: 'new',
        amount: '199.90',
        currency: 'EUR',
      },
    });
    expect(created.status).toBe(200);
    expect(created.body.result.isError).not.toBe(true);
    const createdData = toolData<{ id: string; version: number }>(created);
    assetId = createdData.id;
    assetVersion = createdData.version ?? 1;

    const fetched = await mcp(writeToken, 'tools/call', { name: 'assets_get', arguments: { assetId } });
    expect(toolData<{ assetTag: string }>(fetched).assetTag).toBe('MCP-0002');

    const badCas = await mcp(writeToken, 'tools/call', {
      name: 'assets_update',
      arguments: { assetId, displayName: 'Should fail', expectedVersion: assetVersion + 99 },
    });
    expect(badCas.body.result.isError).toBe(true);

    const updated = await mcp(writeToken, 'tools/call', {
      name: 'assets_update',
      arguments: { assetId, displayName: 'MCP updated', expectedVersion: assetVersion },
    });
    expect(updated.body.result.isError).not.toBe(true);

    const archived = await mcp(writeToken, 'tools/call', { name: 'assets_archive', arguments: { assetId } });
    expect(archived.body.result.isError).not.toBe(true);
  });

  it('custody assign/return round trip with CAS', async () => {
    // Dedicated asset — the CRUD-test asset is archived by then.
    const dedicated = await mcp(writeToken, 'tools/call', {
      name: 'assets_create',
      arguments: { assetTag: 'MCP-0003', displayName: 'Custody round trip' },
    });
    const dedicatedData = toolData<{ id: string; version: number }>(dedicated);
    const dedicatedAssetId = dedicatedData.id;

    const members = await mcp(writeToken, 'tools/call', { name: 'members_list', arguments: {} });
    expect(members.body.result.isError).not.toBe(true);
    const rows = toolData<Array<{ membershipId: string }>>(members);
    expect(rows.length).toBeGreaterThan(0);
    const membershipId = rows[0]!.membershipId;

    const fetched = await mcp(writeToken, 'tools/call', {
      name: 'assets_get',
      arguments: { assetId: dedicatedAssetId },
    });
    const version = toolData<{ version: number }>(fetched).version;

    const assigned = await mcp(writeToken, 'tools/call', {
      name: 'custody_assign',
      arguments: { assetId: dedicatedAssetId, memberId: membershipId, expectedVersion: version },
    });
    expect(assigned.body.result.isError).not.toBe(true);

    const after = await mcp(writeToken, 'tools/call', {
      name: 'assets_get',
      arguments: { assetId: dedicatedAssetId },
    });
    const returned = await mcp(writeToken, 'tools/call', {
      name: 'custody_return',
      arguments: { assetId: dedicatedAssetId, expectedVersion: toolData<{ version: number }>(after).version },
    });
    expect(returned.body.result.isError).not.toBe(true);
  });

  it('mutating MCP calls are audit-logged (mcp.invoke) and visible via the audit tool', async () => {
    const log = await mcp(writeToken, 'tools/call', {
      name: 'workspace_audit_log',
      arguments: { limit: 20 },
    });
    expect(log.body.result.isError).not.toBe(true);
    const entries = toolData<Array<{ action: string }>>(log);
    expect(entries.some((e) => e.action === 'mcp.invoke')).toBe(true);
  });

  it('resources/list advertises the workspace and assets resources', async () => {
    const res = await mcp(readToken, 'resources/list', {});
    expect(res.status).toBe(200);
    const uris = (res.body.result.resources as Array<{ uri: string }>).map((r) => r.uri);
    expect(uris).toContain('assetnest://workspace/current');
    expect(uris).toContain('assetnest://assets');
  });

  it('resources/read returns the bound workspace as JSON', async () => {
    const res = await mcp(readToken, 'resources/read', { uri: 'assetnest://workspace/current' });
    expect(res.status).toBe(200);
    const text = res.body.result.contents[0]?.text as string;
    const parsed = JSON.parse(text) as { id: string };
    expect(parsed.id).toBe(workspaceId);
  });

  it('resources/read with an unknown id answers the resource-not-found error', async () => {
    const res = await mcp(readToken, 'resources/read', {
      uri: 'assetnest://assets/00000000-0000-0000-0000-000000000000',
    });
    expect([200, 400]).toContain(res.status);
    expect(JSON.stringify(res.body)).toMatch(/not|found|-32602/i);
  });

  it('prompts/list advertises the review prompts; prompts/get renders one with live data', async () => {
    const list = await mcp(readToken, 'prompts/list', {});
    expect(list.status).toBe(200);
    const names = (list.body.result.prompts as Array<{ name: string }>).map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(['inventory_review', 'warranty_review', 'maintenance_review', 'audit_brief']),
    );

    const got = await mcp(readToken, 'prompts/get', { name: 'inventory_review', arguments: {} });
    expect(got.status).toBe(200);
    const text = got.body.result.messages[0]?.content?.text as string;
    expect(text).toContain('MCP WS');
  });

  it('tool execution errors (bad CAS) are isError results, not protocol errors', async () => {
    const res = await mcp(writeToken, 'tools/call', {
      name: 'assets_update',
      arguments: { assetId, displayName: 'X', expectedVersion: 424242 },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
  });

  it('Origin header from an unexpected origin is rejected (DNS-rebinding guard)', async () => {
    const res = await mcp(readToken, 'server/discover', {}, { Origin: 'https://evil.example.com' });
    expect(res.status).toBe(403);
  });
});
