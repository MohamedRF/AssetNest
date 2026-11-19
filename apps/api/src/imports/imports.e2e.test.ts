import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-import',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-import',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;
let categoryId: string;

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
    .send({ name: 'Import WS', slug: 'import-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;
  const cat = await http()
    .post(`/api/v1/workspaces/${workspaceId}/categories`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'Import Category' });
  categoryId = (cat.body as { id: string }).id;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

function csv(categoryUuid: string): string {
  return [
    'assetTag,displayName,condition,purchaseDate,amount,currency,tags,categoryId',
    `IMP-0001,Imported Laptop,good,2026-10-01,62999.00,INR,"laptop;finance",${categoryUuid}`,
    'IMP-0002,Minimal Row,,,,,,,',
    'IMP-0001,Duplicate In File,,,,,,,',
    'IMP-0004,Bad Amount,,,,abcINR????,,',
    'IMP-0005,Unknown Category,,,,,,00000000-0000-0000-0000-000000000000',
    'IMP-0006,,good,2026-10-02,,,',
  ].join('\n');
}

describe('csv import (e2e)', () => {
  it('previews headers, sample rows and a suggested mapping', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/imports/preview`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ csvText: csv(categoryId) });
    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual([
      'assetTag',
      'displayName',
      'condition',
      'purchaseDate',
      'amount',
      'currency',
      'tags',
      'categoryId',
    ]);
    expect(res.body.totalRows).toBe(6);
    expect(res.body.sample.length).toBe(5);
    expect(res.body.suggestedMapping).toMatchObject({
      assetTag: 'assetTag',
      displayName: 'displayName',
      categoryId: 'categoryId',
    });
  });

  it('dry-run reports every row outcome without writing anything', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/imports`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        csvText: csv(categoryId),
        mapping: {
          assetTag: 'assetTag',
          displayName: 'displayName',
          condition: 'condition',
          purchaseDate: 'purchaseDate',
          amount: 'amount',
          currency: 'currency',
          tags: 'tags',
          categoryId: 'categoryId',
        },
        dryRun: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(6);
    // valid rows: IMP-0001, IMP-0002 → 2 valid; the rest rejected
    expect(res.body.errors.length).toBeGreaterThanOrEqual(4);
    // nothing imported
    const list = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets?q=IMP-`)
      .set('Cookie', owner.cookie);
    expect(list.body.total).toBe(0);
  });

  it('imports valid rows, skips duplicates within the file and reports per-row errors', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/imports`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        csvText: csv(categoryId),
        mapping: {
          assetTag: 'assetTag',
          displayName: 'displayName',
          condition: 'condition',
          purchaseDate: 'purchaseDate',
          amount: 'amount',
          currency: 'currency',
          tags: 'tags',
          categoryId: 'categoryId',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(4);

    const list = await http().get(`/api/v1/workspaces/${workspaceId}/assets`).set('Cookie', owner.cookie);
    expect(list.body.items.map((a: { assetTag: string }) => a.assetTag).sort()).toEqual([
      'IMP-0001',
      'IMP-0002',
    ]);

    const importedRow = list.body.items.find((a: { assetTag: string }) => a.assetTag === 'IMP-0001');
    const detail = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets/${importedRow.id}`)
      .set('Cookie', owner.cookie);
    expect(detail.body.tags).toEqual(expect.arrayContaining(['laptop', 'finance']));
  });

  it('re-importing the same CSV reports every row as duplicate, losing nothing', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/imports`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        csvText: csv(categoryId),
        mapping: {
          assetTag: 'assetTag',
          displayName: 'displayName',
          condition: 'condition',
          purchaseDate: 'purchaseDate',
          amount: 'amount',
          currency: 'currency',
          tags: 'tags',
          categoryId: 'categoryId',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skippedDuplicate).toBe(2); // IMP-0001 and IMP-0002 now exist in the workspace
    expect(res.body.total).toBe(6);
  });

  it('rejects a non-manager caller', async () => {
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
      .post(`/api/v1/workspaces/${workspaceId}/imports/preview`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', memberCsrf)
      .send({ csvText: 'assetTag\nX-1' });
    expect(res.status).toBe(403);
  });
});
