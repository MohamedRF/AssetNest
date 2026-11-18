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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-org',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

interface Session {
  cookie: string;
  csrfToken: string;
}

async function signIn(email: string, password: string): Promise<Session> {
  const res = await http().post('/api/v1/auth/login').send({ email, password });
  return { cookie: sessionCookieOf(res), csrfToken: res.body.csrfToken as string };
}

async function registerBootstrap(): Promise<Session> {
  const res = await http()
    .post('/api/v1/auth/register')
    .send({ displayName: 'Owner', email: 'owner@example.com', password: 'owner-passphrase-123' });
  return { cookie: sessionCookieOf(res), csrfToken: res.body.csrfToken as string };
}

async function acceptInvite(token: string, displayName: string, password: string): Promise<Session> {
  const res = await http().post('/api/v1/auth/invites/accept').send({ token, displayName, password });
  return { cookie: sessionCookieOf(res), csrfToken: res.body.csrfToken as string };
}

let owner: Session;
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

  owner = await registerBootstrap();
  const created = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'Org Test WS', slug: 'org-test', mode: 'office' });
  workspaceId = (created.body as { id: string }).id;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('categories (e2e)', () => {
  it('creates, lists and patches categories', async () => {
    const create = await http()
      .post(`/api/v1/workspaces/${workspaceId}/categories`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'IT Equipment', description: 'Laptops, servers, peripherals' });
    expect(create.status).toBe(201);

    const list = await http().get(`/api/v1/workspaces/${workspaceId}/categories`).set('Cookie', owner.cookie);
    expect(list.status).toBe(200);
    expect((list.body.categories as unknown[]).length).toBe(1);

    const patch = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/categories/${create.body.id}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ description: 'Updated description' });
    expect(patch.status).toBe(200);
    expect(patch.body.description).toBe('Updated description');
  });

  it('rejects duplicate category names case-insensitively with 409', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/categories`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'it equipment' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CATEGORY_EXISTS');
  });
});

describe('locations (e2e)', () => {
  let rootId: string;
  let floorId: string;
  let roomId: string;

  it('builds a nested tree with materialized paths', async () => {
    const root = await http()
      .post(`/api/v1/workspaces/${workspaceId}/locations`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'HQ Building', type: 'building' });
    expect(root.status).toBe(201);
    expect(root.body.path).toBe('/hq-building');
    rootId = root.body.id;

    const floor = await http()
      .post(`/api/v1/workspaces/${workspaceId}/locations`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'First Floor', type: 'floor', parentId: rootId });
    expect(floor.body.path).toBe('/hq-building/first-floor');
    floorId = floor.body.id;

    const room = await http()
      .post(`/api/v1/workspaces/${workspaceId}/locations`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'Server Room', type: 'room', parentId: floorId });
    expect(room.body.path).toBe('/hq-building/first-floor/server-room');
    roomId = room.body.id;
  });

  it('moves the subtree when a parent is renamed (children re-anchored)', async () => {
    const res = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/locations/${floorId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'Ground Floor' });
    expect(res.status).toBe(200);

    const list = await http().get(`/api/v1/workspaces/${workspaceId}/locations`).set('Cookie', owner.cookie);
    const room = (list.body.locations as Array<{ id: string; path: string }>).find((l) => l.id === roomId)!;
    expect(room.path).toBe('/hq-building/ground-floor/server-room');
  });

  it('rejects moving a location under its own descendant (409 LOCATION_CYCLE)', async () => {
    const res = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/locations/${rootId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ parentId: roomId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LOCATION_CYCLE');
  });

  it('rejects a parent from another workspace (404 LOCATION_NOT_FOUND)', async () => {
    // Create a second workspace with its own location.
    const other = await http()
      .post('/api/v1/workspaces')
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'Other WS', slug: 'other-ws', mode: 'home' });
    const otherWs = (other.body as { id: string }).id;
    const foreign = await http()
      .post(`/api/v1/workspaces/${otherWs}/locations`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'Other Room', type: 'room' });
    const foreignId = (foreign.body as { id: string }).id;

    const res = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/locations/${roomId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ parentId: foreignId });
    expect(res.status).toBe(404);
  });
});

describe('vendors (e2e)', () => {
  it('creates, lists and patches vendors', async () => {
    const create = await http()
      .post(`/api/v1/workspaces/${workspaceId}/vendors`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        name: 'Dell Technologies',
        contact: { phone: '+1 555 0100', email: 'sales@dell.example.com' },
      });
    expect(create.status).toBe(201);

    const list = await http().get(`/api/v1/workspaces/${workspaceId}/vendors`).set('Cookie', owner.cookie);
    expect((list.body.vendors as unknown[]).length).toBe(1);

    const patch = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/vendors/${create.body.id}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ notes: 'Preferred channel' });
    expect(patch.status).toBe(200);
    expect(patch.body.notes).toBe('Preferred channel');
  });
});

describe('tenancy and permissions (e2e)', () => {
  it('a member of a DIFFERENT workspace gets 404 on this workspace (no oracle)', async () => {
    // Create a second workspace, invite outsider into it, then probe the first.
    const other = await http()
      .post('/api/v1/workspaces')
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'Private WS', slug: 'private-ws', mode: 'home' });
    const otherWs = (other.body as { id: string }).id;
    const invite = await http()
      .post(`/api/v1/workspaces/${otherWs}/invites`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ email: 'outsider@example.com', roleKey: 'member' });
    const token = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
    const outsider = await acceptInvite(token, 'Out Sider', 'outsider-passphrase-123');

    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/categories`)
      .set('Cookie', outsider.cookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('member without assets:write gets 403 on category create', async () => {
    const invite = await http()
      .post(`/api/v1/workspaces/${workspaceId}/invites`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ email: 'plainmember@example.com', roleKey: 'member' });
    const token = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
    await acceptInvite(token, 'Plain Member', 'plain-member-passphrase-1');
    const member = await signIn('plainmember@example.com', 'plain-member-passphrase-1');

    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/categories`)
      .set('Cookie', member.cookie)
      .set('x-csrf-token', member.csrfToken)
      .send({ name: 'Unauthorized Category' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_SCOPE');

    const list = await http()
      .get(`/api/v1/workspaces/${workspaceId}/categories`)
      .set('Cookie', member.cookie);
    expect(list.status).toBe(200);
  });
});
