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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-notif',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-notif',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let member: { cookie: string; csrfToken: string };
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
    .send({ name: 'Notif WS', slug: 'notif-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;

  const invite = await http()
    .post(`/api/v1/workspaces/${workspaceId}/invites`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ email: 'member@example.com', roleKey: 'member' });
  const token = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
  await http()
    .post('/api/v1/auth/invites/accept')
    .send({ token, displayName: 'Member', password: 'member-passphrase-123' });
  const login = await http()
    .post('/api/v1/auth/login')
    .send({ email: 'member@example.com', password: 'member-passphrase-123' });
  member = { cookie: sessionCookieOf(login), csrfToken: login.body.csrfToken as string };
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('notification preferences (e2e)', () => {
  it('defaults to an empty own list and upserts opt-out', async () => {
    const before = await http()
      .get(`/api/v1/workspaces/${workspaceId}/notification-preferences`)
      .set('Cookie', owner.cookie);
    expect(before.status).toBe(200);
    expect(before.body.preferences).toHaveLength(0);

    const put = await http()
      .put(`/api/v1/workspaces/${workspaceId}/notification-preferences`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ channel: 'email', event: 'asset.assigned', enabled: false });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ channel: 'email', event: 'asset.assigned', enabled: false });
  });

  it('upserts idempotently and toggles back', async () => {
    for (const enabled of [false, true]) {
      const put = await http()
        .put(`/api/v1/workspaces/${workspaceId}/notification-preferences`)
        .set('Cookie', owner.cookie)
        .set('x-csrf-token', owner.csrfToken)
        .send({ channel: 'email', event: 'asset.assigned', enabled });
      expect(put.status).toBe(200);
      expect(put.body.enabled).toBe(enabled);
    }
    const list = await http()
      .get(`/api/v1/workspaces/${workspaceId}/notification-preferences`)
      .set('Cookie', owner.cookie);
    expect(list.body.preferences).toHaveLength(1);
  });

  it('preferences are scoped per member, not shared', async () => {
    const memberList = await http()
      .get(`/api/v1/workspaces/${workspaceId}/notification-preferences`)
      .set('Cookie', member.cookie);
    expect(memberList.status).toBe(200);
    expect(memberList.body.preferences).toHaveLength(0);
  });

  it('validates channel and event shape', async () => {
    const res = await http()
      .put(`/api/v1/workspaces/${workspaceId}/notification-preferences`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ channel: 'sms', event: 'Asset Created', enabled: true });
    expect(res.status).toBe(400);
  });
});
