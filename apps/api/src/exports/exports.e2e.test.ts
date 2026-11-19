import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../../packages/db/migrations');

let client: PGlite;
let app: INestApplication;
const storageRoot = mkdtempSync(join(tmpdir(), 'assetnest-exports-'));

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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-exports',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: storageRoot,
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;

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
  owner = { cookie: sessionCookieOf(register), csrfToken: register.body.csrfToken as string };
  const ws = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'Exports WS', slug: 'exports-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;
  for (const tag of ['EXP-0001', 'EXP-0002']) {
    await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetTag: tag, displayName: `Export asset ${tag}`, currency: 'INR', amount: '1000.00' });
  }
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('exports (e2e)', () => {
  it('generates an assets CSV report end-to-end', async () => {
    const create = await http()
      .post(`/api/v1/workspaces/${workspaceId}/exports`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ report: 'assets' });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('completed');
    expect(create.body.downloadUrl).toBe(
      `/api/v1/workspaces/${workspaceId}/exports/${create.body.id}/download`,
    );

    const download = await http()
      .get(`/api/v1/workspaces/${workspaceId}/exports/${create.body.id}/download`)
      .set('Cookie', owner.cookie);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('text/csv');
    expect(download.text).toContain('asset_tag,display_name');
    expect(download.text).toContain('EXP-0001');
    expect(download.text).toContain('EXP-0002');
  });

  it('generates a warranties report with derived status', async () => {
    const create = await http()
      .post(`/api/v1/workspaces/${workspaceId}/exports`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ report: 'warranties' });
    expect(create.status).toBe(201);

    const download = await http()
      .get(`/api/v1/workspaces/${workspaceId}/exports/${create.body.id}/download`)
      .set('Cookie', owner.cookie);
    expect(download.text).toContain('asset_tag,asset_name,provider');
  });

  it('lists recent exports', async () => {
    const res = await http().get(`/api/v1/workspaces/${workspaceId}/exports`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect((res.body.exports as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a plain member (reports:read required)', async () => {
    const invite = await http()
      .post(`/api/v1/workspaces/${workspaceId}/invites`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ email: 'plainmember@example.com', roleKey: 'member' });
    const token = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
    await http()
      .post('/api/v1/auth/invites/accept')
      .send({ token, displayName: 'Plain', password: 'plain-member-passphrase-1' });
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'plainmember@example.com', password: 'plain-member-passphrase-1' });
    const memberCookie = sessionCookieOf(login);
    const memberCsrf = login.body.csrfToken as string;

    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/exports`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', memberCsrf)
      .send({ report: 'assets' });
    expect(res.status).toBe(403);
  });
});
