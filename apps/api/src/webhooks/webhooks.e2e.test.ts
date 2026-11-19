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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-webhooks',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-webhooks',
  MAIL_TRANSPORT: 'log',
  WEBHOOKS_ALLOW_PRIVATE: 'false', // SSRF policy enforced in tests
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'true',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;
let webhookId: string;
let secret: string;

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
    .send({ name: 'Webhooks WS', slug: 'webhooks-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('webhooks admin API (e2e)', () => {
  it('rejects private-network destinations (SSRF policy)', async () => {
    for (const url of ['http://127.0.0.1:8080/hook', 'http://localhost/hook', 'http://192.168.1.10/hook']) {
      const res = await http()
        .post(`/api/v1/workspaces/${workspaceId}/webhooks`)
        .set('Cookie', owner.cookie)
        .set('x-csrf-token', owner.csrfToken)
        .send({ url, eventTypes: ['asset.created'] });
      expect(res.status, `expected ${url} to be rejected`).toBe(400);
      expect(res.body.code).toMatch(/WEBHOOK_URL_REJECTED|WEBHOOK_SSRF/);
    }
  });

  it('rejects URLs with embedded credentials and non-http schemes', async () => {
    for (const url of ['https://user:pass@example.com/hook', 'ftp://example.com/hook']) {
      const res = await http()
        .post(`/api/v1/workspaces/${workspaceId}/webhooks`)
        .set('Cookie', owner.cookie)
        .set('x-csrf-token', owner.csrfToken)
        .send({ url, eventTypes: ['asset.created'] });
      expect(res.status).toBe(400);
    }
  });

  it('creates an outbound webhook and returns the signing secret exactly once', async () => {
    // A public IP literal — no DNS dependency in tests.
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/webhooks`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        url: 'https://93.184.216.34/hook',
        eventTypes: ['asset.created', 'asset.assigned'],
        description: 'n8n hook',
      });
    expect(res.status).toBe(201);
    expect(typeof res.body.secret).toBe('string');
    expect(res.body.secret.length).toBeGreaterThanOrEqual(32);
    expect(res.body.eventTypes).toEqual(['asset.created', 'asset.assigned']);
    webhookId = res.body.id as string;
    secret = res.body.secret as string;
  });

  it('list never returns the signing secret', async () => {
    const res = await http().get(`/api/v1/workspaces/${workspaceId}/webhooks`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    const found = (res.body.webhooks as Array<Record<string, unknown>>).find((w) => w.id === webhookId)!;
    expect(found.url).toBe('https://93.184.216.34/hook');
    expect(JSON.stringify(found)).not.toContain(secret);
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });

  it('test delivery endpoint enqueues without delivering synchronously', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/test`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('deliveries endpoint returns an empty ledger before any delivery', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.deliveries).toEqual([]);
  });

  it('retry-failed with no failed deliveries reports zero enqueued', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/retry-failed`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, enqueued: 0 });
  });

  it('update can disable the subscription (active=false)', async () => {
    const res = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  it('plain members cannot manage webhooks (integrations:manage required)', async () => {
    const invite = await http()
      .post(`/api/v1/workspaces/${workspaceId}/invites`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ email: 'plainwebhookmember@example.com', roleKey: 'member' });
    const tokenValue = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
    await http()
      .post('/api/v1/auth/invites/accept')
      .send({ token: tokenValue, displayName: 'Plain', password: 'plain-member-passphrase-1' });
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'plainwebhookmember@example.com', password: 'plain-member-passphrase-1' });
    const memberCookie = sessionCookieOf(login);
    const memberCsrf = login.body.csrfToken as string;

    const denied = await http()
      .post(`/api/v1/workspaces/${workspaceId}/webhooks`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', memberCsrf)
      .send({ url: 'https://93.184.216.34/hook', eventTypes: ['asset.created'] });
    expect(denied.status).toBe(403);

    const listed = await http().get(`/api/v1/workspaces/${workspaceId}/webhooks`).set('Cookie', memberCookie);
    expect(listed.status).toBe(403);
  });

  it('delete soft-removes the webhook and hides it from the list', async () => {
    const res = await http()
      .delete(`/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(res.status).toBe(200);
    const list = await http().get(`/api/v1/workspaces/${workspaceId}/webhooks`).set('Cookie', owner.cookie);
    expect(list.status).toBe(200);
    expect((list.body.webhooks as Array<{ id: string }>).find((w) => w.id === webhookId)).toBeUndefined();
  });
});
