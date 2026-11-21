import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { AssetNestClient, type AssetPage, type OperationResult } from '../../../../packages/sdk/src/index.js';
import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../../packages/db/migrations');

let client: PGlite;
let app: INestApplication;

function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function sessionCookieOf(res: { headers: Record<string, unknown> }): string {
  const cookie = asStringArray(res.headers['set-cookie'] as string | string[] | undefined).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  );
  if (!cookie) throw new Error('expected a session cookie to be set');
  return cookie.split(';')[0]!;
}

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-tokens',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-tokens',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;
let tokenId: string;
let token: string;
let secondWorkspaceId: string;

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
  await app.listen(0, '127.0.0.1');

  const register = await http()
    .post('/api/v1/auth/register')
    .send({ displayName: 'Owner', email: 'owner@example.com', password: 'owner-passphrase-123' });
  owner = { cookie: sessionCookieOf(register), csrfToken: register.body.csrfToken as string };
  const ws = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'Tokens WS', slug: 'tokens-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;
  await http()
    .post(`/api/v1/workspaces/${workspaceId}/assets`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ assetTag: 'TOK-0001', displayName: 'Token-read asset' });
  const ws2 = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'Other WS', slug: 'other-ws', mode: 'home' });
  secondWorkspaceId = (ws2.body as { id: string }).id;

  const created = await http()
    .post(`/api/v1/workspaces/${workspaceId}/api-tokens`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'reader', scopes: ['assets:read'], expiresInDays: 30 });
  expect(created.status).toBe(201);
  token = created.body.token as string;
  tokenId = created.body.id as string;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('scoped API tokens (e2e)', () => {
  it('preserves SDK types for JSON, text, downloads, and empty responses', () => {
    expectTypeOf<OperationResult<'listAssets'>>().toEqualTypeOf<AssetPage>();
    expectTypeOf<OperationResult<'getReadiness'>>().toEqualTypeOf<{
      checks: { database: 'up' };
      status: 'ready';
    }>();
    expectTypeOf<OperationResult<'getAssetQr'>>().toEqualTypeOf<string>();
    expectTypeOf<OperationResult<'downloadDocument'>>().toEqualTypeOf<Blob>();
    expectTypeOf<OperationResult<'deleteAiConnection'>>().toEqualTypeOf<void>();
  });

  it('the SDK consumes typed asset responses and preserves token scope boundaries', async () => {
    const sdk = new AssetNestClient({ baseUrl: await app.getUrl(), token });
    const page = await sdk.listAssets(workspaceId, { q: 'Token-read', pageSize: 1 });
    expect(page).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    const asset = page.items[0]!;
    expect(asset).toMatchObject({ assetTag: 'TOK-0001', serialNumber: null, status: 'available' });
    await expect(sdk.getAsset(workspaceId, asset.id)).resolves.toMatchObject({
      id: asset.id,
      tags: [],
      customValues: {},
    });
    await expect(sdk.getAssetQr(workspaceId, asset.id)).resolves.toContain('<svg');
    await expect(sdk.execute('getAssetQr', { path: { workspaceId, assetId: asset.id } })).resolves.toContain(
      '<svg',
    );
    await expect(
      sdk.execute('listAssets', { path: { workspaceId }, query: { pageSize: 1, q: 'Token-read' } }),
    ).resolves.toEqual(page);
    await expect(sdk.getLiveness()).resolves.toEqual({ status: 'ok' });
    await expect(sdk.listAssets(secondWorkspaceId)).rejects.toMatchObject({ status: 404 });
    await expect(
      sdk.createAsset(workspaceId, { assetTag: 'SDK-0001', displayName: 'Denied' }),
    ).rejects.toMatchObject({ status: 403, body: { code: 'INSUFFICIENT_SCOPE' } });
  });

  it('the SDK sends JSON writes with optional defaults and required optimistic versions', async () => {
    const minted = await http()
      .post(`/api/v1/workspaces/${secondWorkspaceId}/api-tokens`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'sdk-writer', scopes: ['assets:read', 'assets:write'] });
    expect(minted.status).toBe(201);
    const sdk = new AssetNestClient({ baseUrl: await app.getUrl(), token: minted.body.token as string });
    const created = await sdk.createAsset(secondWorkspaceId, {
      assetTag: 'SDK-0001',
      displayName: 'SDK asset',
      serialNumber: '00042',
    });
    expect(created).toMatchObject({
      serialNumber: '00042',
      status: 'available',
      condition: 'good',
      version: 1,
    });
    const updated = await sdk.updateAsset(secondWorkspaceId, created.id, {
      expectedVersion: created.version,
      serialNumber: null,
    });
    expect(updated).toMatchObject({ serialNumber: null, version: 2 });
    await expect(
      sdk.updateAsset(secondWorkspaceId, created.id, { expectedVersion: created.version, notes: 'stale' }),
    ).rejects.toMatchObject({ status: 409, body: { code: 'ASSET_VERSION_CONFLICT' } });
    const history = await sdk.getAssetHistory(secondWorkspaceId, created.id);
    expect(history.events.map((event) => event.action)).toEqual(['asset.updated', 'asset.created']);
  });

  it('an API token with assets:read can list assets', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body.items as unknown[]).length).toBe(1);
  });

  it('the same token cannot write (403 INSUFFICIENT_SCOPE)', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetTag: 'TOK-0002', displayName: 'Nope' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('the token cannot touch a different workspace (404, no oracle)', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${secondWorkspaceId}/assets`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('the token cannot reach global routes like /auth/me (403 TOKEN_SCOPE_EXCEEDED)', async () => {
    const res = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TOKEN_SCOPE_EXCEEDED');
  });

  it('list never returns the token secret, only its prefix and scopes', async () => {
    const res = await http().get(`/api/v1/workspaces/${workspaceId}/api-tokens`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    const found = (res.body.tokens as Array<Record<string, unknown>>).find((t) => t.id === tokenId)!;
    expect(found.name).toBe('reader');
    expect(found.scopes).toEqual(['assets:read']);
    expect(found.tokenPrefix).toBe(token.slice(0, 13));
    expect(JSON.stringify(found)).not.toContain(token);
  });

  it('rotate issues a fresh token with the same scopes and kills the old one', async () => {
    const rotated = await http()
      .post(`/api/v1/workspaces/${workspaceId}/api-tokens/${tokenId}/rotate`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(rotated.status).toBe(200);
    const newToken = rotated.body.token as string;
    expect(newToken).toMatch(/^anst_/);

    const oldFails = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Authorization', `Bearer ${token}`);
    expect(oldFails.status).toBe(401);

    const newWorks = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Authorization', `Bearer ${newToken}`);
    expect(newWorks.status).toBe(200);

    // Revoke the rotated token too; make the rest of the suite pass with a fresh token.
    const revoke = await http()
      .delete(`/api/v1/workspaces/${workspaceId}/api-tokens/${rotated.body.id}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(revoke.status).toBe(200);

    const gone = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Authorization', `Bearer ${newToken}`);
    expect(gone.status).toBe(401);
  });

  it('plain members cannot mint tokens (integrations:manage required, 403)', async () => {
    const invite = await http()
      .post(`/api/v1/workspaces/${workspaceId}/invites`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ email: 'plainmember@example.com', roleKey: 'member' });
    const tokenValue = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
    await http()
      .post('/api/v1/auth/invites/accept')
      .send({ token: tokenValue, displayName: 'Plain', password: 'plain-member-passphrase-1' });
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'plainmember@example.com', password: 'plain-member-passphrase-1' });
    const memberCookie = sessionCookieOf(login);
    const memberCsrf = login.body.csrfToken as string;

    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/api-tokens`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', memberCsrf)
      .send({ name: 'rogue', scopes: ['assets:write'] });
    expect(res.status).toBe(403);
  });

  it('a bearer token cannot mint, rotate or revoke tokens even with integrations:manage', async () => {
    // The owner mints an automation token that itself carries integrations:manage.
    const minted = await http()
      .post(`/api/v1/workspaces/${workspaceId}/api-tokens`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'token-admin', scopes: ['integrations:manage', 'assets:read'] });
    expect(minted.status).toBe(201);
    const adminToken = minted.body.token as string;
    const adminTokenId = minted.body.id as string;

    // Using that token as a bearer credential to create another token is refused.
    const create = await http()
      .post(`/api/v1/workspaces/${workspaceId}/api-tokens`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'escalated', scopes: ['assets:read'] });
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('AI_SESSION_REQUIRED');

    // Rotate and revoke via the bearer token are refused too.
    const rotate = await http()
      .post(`/api/v1/workspaces/${workspaceId}/api-tokens/${adminTokenId}/rotate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(rotate.status).toBe(403);
    expect(rotate.body.code).toBe('AI_SESSION_REQUIRED');

    const revoke = await http()
      .delete(`/api/v1/workspaces/${workspaceId}/api-tokens/${adminTokenId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revoke.status).toBe(403);
    expect(revoke.body.code).toBe('AI_SESSION_REQUIRED');
  });

  it('a narrow-scope bearer token cannot administer tokens (integrations:manage required)', async () => {
    // Fresh read-only token (the earlier one may already be revoked by the rotate test).
    const minted = await http()
      .post(`/api/v1/workspaces/${workspaceId}/api-tokens`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'reader-2', scopes: ['assets:read'] });
    expect(minted.status).toBe(201);
    const readOnly = minted.body.token as string;

    const denied = await http()
      .get(`/api/v1/workspaces/${workspaceId}/api-tokens`)
      .set('Authorization', `Bearer ${readOnly}`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('INSUFFICIENT_SCOPE');

    // And it stays confined to its own workspace for data reads.
    const cross = await http()
      .get(`/api/v1/workspaces/${secondWorkspaceId}/assets`)
      .set('Authorization', `Bearer ${readOnly}`);
    expect(cross.status).toBe(404);
  });
});
