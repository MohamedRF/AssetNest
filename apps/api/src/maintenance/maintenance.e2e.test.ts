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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-maint',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-maint',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;
let assetId: string;
let planId: string;

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
    .send({ name: 'Maintenance WS', slug: 'maintenance-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;
  const asset = await http()
    .post(`/api/v1/workspaces/${workspaceId}/assets`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ assetTag: 'MNT-0001', displayName: 'Maintained asset' });
  assetId = (asset.body as { id: string }).id;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('maintenance (e2e)', () => {
  it('creates a quarterly plan and lists it with a derived due state', async () => {
    const create = await http()
      .post(`/api/v1/workspaces/${workspaceId}/maintenance/plans`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        assetId,
        title: 'Quarterly filter and belt inspection',
        cadence: 'quarterly',
        nextDueAt: '2027-03-01',
      });
    expect(create.status).toBe(201);
    planId = create.body.id;

    const list = await http()
      .get(`/api/v1/workspaces/${workspaceId}/maintenance/plans`)
      .set('Cookie', owner.cookie);
    expect(list.status).toBe(200);
    expect(list.body.plans).toHaveLength(1);
    expect(list.body.plans[0]).toMatchObject({ assetTag: 'MNT-0001', dueState: 'scheduled' });
  });

  it('rejects invalid cadence with 400', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/maintenance/plans`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetId, title: 'Bogus cadence', cadence: 'fortnightly', nextDueAt: '2027-03-01' });
    expect(res.status).toBe(400);
  });

  it('logs a service against the plan and advances nextDueAt by the cadence', async () => {
    const record = await http()
      .post(`/api/v1/workspaces/${workspaceId}/maintenance/records`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        assetId,
        planId,
        performedAt: '2027-03-10',
        cost: '1500.00',
        currency: 'INR',
        notes: 'Filter and belt replaced',
      });
    expect(record.status).toBe(201);

    const list = await http()
      .get(`/api/v1/workspaces/${workspaceId}/maintenance/plans`)
      .set('Cookie', owner.cookie);
    expect(list.body.plans[0].nextDueAt).toBe('2027-06-10');
  });

  it('creates a service record without a plan and lists it with vendor join', async () => {
    const vendor = await http()
      .post(`/api/v1/workspaces/${workspaceId}/vendors`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'CoolAir Services' });
    const vendorId = (vendor.body as { id: string }).id;

    const record = await http()
      .post(`/api/v1/workspaces/${workspaceId}/maintenance/records`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetId, performedAt: '2027-02-05', vendorId, cost: '2200.00', currency: 'INR' });
    expect(record.status).toBe(201);

    const list = await http()
      .get(`/api/v1/workspaces/${workspaceId}/maintenance/records?assetId=${assetId}`)
      .set('Cookie', owner.cookie);
    expect(list.status).toBe(200);
    const withVendor = (list.body.records as Array<{ vendorName?: string }>).find(
      (r) => r.vendorName === 'CoolAir Services',
    );
    expect(withVendor).toBeTruthy();
  });

  it('rejects a record whose plan belongs to another asset', async () => {
    const other = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetTag: 'MNT-0002', displayName: 'Second asset' });
    const otherAssetId = (other.body as { id: string }).id;

    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/maintenance/records`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetId: otherAssetId, planId, performedAt: '2027-04-01' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PLAN_ASSET_MISMATCH');
  });

  it('rejects a plain member from creating plans (assets:write required)', async () => {
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
      .post(`/api/v1/workspaces/${workspaceId}/maintenance/plans`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', memberCsrf)
      .send({ assetId, title: 'Unauthorized plan', cadence: 'monthly', nextDueAt: '2027-01-01' });
    expect(res.status).toBe(403);
  });
});
