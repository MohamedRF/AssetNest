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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-warranty',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-warranty',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;
let assetId: string;
let warrantyId: string;

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
    .send({ name: 'Warranty WS', slug: 'warranty-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;
  const asset = await http()
    .post(`/api/v1/workspaces/${workspaceId}/assets`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ assetTag: 'WAR-0001', displayName: 'Warranted asset' });
  assetId = (asset.body as { id: string }).id;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('warranties (e2e)', () => {
  it('validates date order on create (400 when expiresOn < startsOn)', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/warranties`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetId, provider: 'Dell', startsOn: '2027-01-01', expiresOn: '2026-01-01' });
    expect(res.status).toBe(400);
  });

  it('creates a warranty and lists it with a derived expiry state', async () => {
    const create = await http()
      .post(`/api/v1/workspaces/${workspaceId}/warranties`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        assetId,
        provider: 'Dell ProSupport',
        startsOn: '2026-01-01',
        expiresOn: '2027-12-31',
        details: '3-year NBD',
      });
    expect(create.status).toBe(201);
    warrantyId = create.body.id;

    const list = await http().get(`/api/v1/workspaces/${workspaceId}/warranties`).set('Cookie', owner.cookie);
    expect(list.status).toBe(200);
    expect(list.body.warranties).toHaveLength(1);
    expect(list.body.warranties[0]).toMatchObject({
      assetTag: 'WAR-0001',
      provider: 'Dell ProSupport',
      derivedStatus: 'active',
    });
  });

  it('rejects a patch that inverts the date order (400)', async () => {
    const res = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/warranties/${warrantyId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ startsOn: '2028-06-01' });
    expect(res.status).toBe(400);
  });

  it('patches the warranty provider', async () => {
    const res = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/warranties/${warrantyId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ provider: 'Dell ProSupport Plus' });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('Dell ProSupport Plus');
  });

  it('filters warranties expiring within a horizon', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/warranties?expiringDays=3650`)
      .set('Cookie', owner.cookie);
    expect(res.body.warranties).toHaveLength(1);
    const none = await http()
      .get(`/api/v1/workspaces/${workspaceId}/warranties?expiringDays=0`)
      .set('Cookie', owner.cookie);
    // expires 2027-12-31 — not within 0 days, so empty
    expect(none.body.warranties).toHaveLength(0);
  });

  it('rejects creation from a plain member (assets:write required)', async () => {
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
      .post(`/api/v1/workspaces/${workspaceId}/warranties`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', memberCsrf)
      .send({ assetId, provider: 'Dell', startsOn: '2026-01-01', expiresOn: '2026-12-31' });
    expect(res.status).toBe(403);
  });
});
