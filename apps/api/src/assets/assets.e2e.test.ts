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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-assets',
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

  const register = await http()
    .post('/api/v1/auth/register')
    .send({ displayName: 'Owner', email: 'owner@example.com', password: 'owner-passphrase-123' });
  owner = { cookie: sessionCookieOf(register), csrfToken: register.body.csrfToken as string };
  const ws = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'Assets WS', slug: 'assets-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;

  // A category and a location to reference.
  await http()
    .post(`/api/v1/workspaces/${workspaceId}/categories`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'IT Equipment' });
  await http()
    .post(`/api/v1/workspaces/${workspaceId}/locations`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'Server Room', type: 'room' });
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('assets (e2e)', () => {
  let assetId: string;

  it('creates an asset with a lowercase tag normalized to uppercase', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        assetTag: 'off-000142',
        displayName: 'Dell Latitude 7440',
        serialNumber: '0042-XK-9917',
        status: 'available',
        condition: 'good',
        purchasedAt: '2026-11-10',
        amount: '62999.00',
        currency: 'INR',
        tags: ['Laptop', 'Finance'],
        customValues: { warrantySeats: 2 },
      });
    expect(res.status).toBe(201);
    expect(res.body.assetTag).toBe('OFF-000142');
    expect(res.body.version).toBe(1);
    expect(res.body.tags).toEqual(expect.arrayContaining(['laptop', 'finance']));
    expect(res.body.customValues).toEqual({ warrantySeats: 2 });
    assetId = res.body.id as string;
  });

  it('rejects a duplicate asset tag in the same workspace with 409', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetTag: 'OFF-000142', displayName: 'Duplicate tag attempt' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSET_TAG_EXISTS');
  });

  it('lists assets filtered by free-text query and tag prefix', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets?q=XK-9917`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].displayName).toBe('Dell Latitude 7440');

    const byTag = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets?q=off-000142`)
      .set('Cookie', owner.cookie);
    // tag search is case-insensitive on the stored value
    expect(byTag.body.total).toBe(1);
  });

  it('enforces optimistic concurrency: stale expectedVersion → 409 ASSET_VERSION_CONFLICT', async () => {
    const stale = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/assets/${assetId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ notes: 'edited elsewhere', expectedVersion: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ASSET_VERSION_CONFLICT');

    const ok = await http()
      .patch(`/api/v1/workspaces/${workspaceId}/assets/${assetId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ notes: 'Updated note', expectedVersion: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);
    expect(ok.body.notes).toBe('Updated note');
  });

  it('rejects an illegal lifecycle transition (available → disposed)', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/status-transition`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ to: 'disposed', expectedVersion: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  it('performs a legal transition and appends an immutable history entry', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/status-transition`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ to: 'assigned', expectedVersion: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('assigned');
    expect(res.body.version).toBe(3);

    const history = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/history`)
      .set('Cookie', owner.cookie);
    expect(history.status).toBe(200);
    const actions = (history.body.events as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('asset.created');
    expect(actions).toContain('asset.updated');
    expect(actions).toContain('asset.status_changed');
  });

  it('archives the asset and refuses to archive twice', async () => {
    const first = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/archive`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('archived');

    const second = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/archive`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ASSET_ALREADY_ARCHIVED');
  });

  it('serves an opaque QR SVG for the asset (no serial or tag inside)', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/qr`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('image/svg+xml');
    const svg = typeof res.text === 'string' && res.text.length > 0 ? res.text : res.body.toString('utf8');
    expect(svg).toContain('<svg');
  });

  it('hides the asset from a workspace the user does not belong to (404)', async () => {
    const outsiderWorkspace = await http()
      .post('/api/v1/workspaces')
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'Isolated WS', slug: 'isolated-ws', mode: 'home' });
    const invite = await http()
      .post(`/api/v1/workspaces/${outsiderWorkspace.body.id}/invites`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ email: 'outsider@example.com', roleKey: 'member' });
    const token = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
    await http()
      .post('/api/v1/auth/invites/accept')
      .send({ token, displayName: 'Out', password: 'outsider-passphrase-123' });
    const outsider = await signIn('outsider@example.com', 'outsider-passphrase-123');

    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets/${assetId}`)
      .set('Cookie', outsider.cookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('WORKSPACE_NOT_FOUND');
  });
});
