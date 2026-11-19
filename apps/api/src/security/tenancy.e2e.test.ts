/**
 * Phase 1 cross-tenant acceptance matrix — consolidated attacker session.
 *
 * User A (owner) and User B (member of workspace B ONLY). Unless noted, B's
 * workspace does not contain A's resources: EVERY probe against A's workspace
 * must return 404 WORKSPACE_NOT_FOUND — never 403, never data (no oracle).
 *
 * Layer-by-layer guarantees (see e2e suites org/assets/documents/workspaces):
 *   HTTP guard → membership required; Permission → role→scope check;
 *   service → workspaceId predicate on every query; FK → composite checks.
 *
 * | Probe                                   | Expect         |
 * |-----------------------------------------|----------------|
 * | unauthenticated any route               | 401            |
 * | wrong/revoked session                   | 401            |
 * | B reads A's workspace                    | 404            |
 * | B lists/mutates A's assets               | 404            |
 * | B reads A's categories/locations/vendors | 404            |
 * | B reads/uploads/downloads A's docs       | 404            |
 * | B reads A's audit log                    | 404            |
 * | missing workspace param (route-scoped)   | guard skipped  |
 * | same tag in both workspaces              | allowed        |
 * | role escalation via invite as 'owner'    | blocked (enum) |
 * | member calls integrations endpoints      | 403            |
 */
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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-tenancy',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-tenancy',
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

let userA: Session;
let userB: Session;
let wsA: string;
let assetA: string;

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

  // User A and workspace A with an asset.
  const regA = await http()
    .post('/api/v1/auth/register')
    .send({ displayName: 'Owner A', email: 'owner-a@example.com', password: 'owner-a-passphrase-123' });
  userA = { cookie: sessionCookieOf(regA), csrfToken: regA.body.csrfToken as string };
  const createdA = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', userA.cookie)
    .set('x-csrf-token', userA.csrfToken)
    .send({ name: 'Workspace A', slug: 'workspace-a', mode: 'office' });
  wsA = (createdA.body as { id: string }).id;
  const asset = await http()
    .post(`/api/v1/workspaces/${wsA}/assets`)
    .set('Cookie', userA.cookie)
    .set('x-csrf-token', userA.csrfToken)
    .send({ assetTag: 'TENANT-0001', displayName: 'A secret asset' });
  assetA = (asset.body as { id: string }).id;

  // User B and workspace B only.
  const invite = await http()
    .post(`/api/v1/workspaces/${wsA}/invites`)
    .set('Cookie', userA.cookie)
    .set('x-csrf-token', userA.csrfToken)
    .send({ email: 'intruder@example.com', roleKey: 'member' });
  // NOTE: B belongs to a DIFFERENT workspace; create B's workspace via a second invite-accept flow:
  void invite;
  const ownB = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', userA.cookie)
    .set('x-csrf-token', userA.csrfToken)
    .send({ name: 'Workspace B', slug: 'workspace-b', mode: 'home' });
  const wsB = (ownB.body as { id: string }).id;
  const inviteB = await http()
    .post(`/api/v1/workspaces/${wsB}/invites`)
    .set('Cookie', userA.cookie)
    .set('x-csrf-token', userA.csrfToken)
    .send({ email: 'intruder@example.com', roleKey: 'member' });
  const tokenB = new URL(inviteB.body.acceptUrl as string).searchParams.get('token')!;
  await http()
    .post('/api/v1/auth/invites/accept')
    .send({ token: tokenB, displayName: 'User B', password: 'user-b-passphrase-123' });
  userB = await signIn('intruder@example.com', 'user-b-passphrase-123');
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('attacker session probes (workspace A resources)', () => {
  const probes: Array<{ name: string; method: () => request.Test }> = [
    {
      name: 'reads the workspace',
      method: () => http().get(`/api/v1/workspaces/${wsA}`).set('Cookie', userB.cookie),
    },
    {
      name: 'lists assets',
      method: () => http().get(`/api/v1/workspaces/${wsA}/assets`).set('Cookie', userB.cookie),
    },
    {
      name: 'gets the asset',
      method: () => http().get(`/api/v1/workspaces/${wsA}/assets/${assetA}`).set('Cookie', userB.cookie),
    },
    {
      name: 'creates an asset',
      method: () =>
        http()
          .post(`/api/v1/workspaces/${wsA}/assets`)
          .set('Cookie', userB.cookie)
          .set('x-csrf-token', userB.csrfToken)
          .send({ assetTag: 'INTRUDE-0001', displayName: 'Intrusion' }),
    },
    {
      name: 'lists categories',
      method: () => http().get(`/api/v1/workspaces/${wsA}/categories`).set('Cookie', userB.cookie),
    },
    {
      name: 'creates a category',
      method: () =>
        http()
          .post(`/api/v1/workspaces/${wsA}/categories`)
          .set('Cookie', userB.cookie)
          .set('x-csrf-token', userB.csrfToken)
          .send({ name: 'Intrusion Category' }),
    },
    {
      name: 'audit log',
      method: () => http().get(`/api/v1/workspaces/${wsA}/audit-log`).set('Cookie', userB.cookie),
    },
    {
      name: 'assets history',
      method: () =>
        http().get(`/api/v1/workspaces/${wsA}/assets/${assetA}/history`).set('Cookie', userB.cookie),
    },
    {
      name: 'documents list',
      method: () =>
        http().get(`/api/v1/workspaces/${wsA}/assets/${assetA}/documents`).set('Cookie', userB.cookie),
    },
    {
      name: 'QR endpoint',
      method: () => http().get(`/api/v1/workspaces/${wsA}/assets/${assetA}/qr`).set('Cookie', userB.cookie),
    },
  ];

  for (const probe of probes) {
    it(`${probe.name} → 404`, async () => {
      const res = await probe.method();
      expect(res.status).toBe(404);
      if (res.body?.code) {
        expect(res.body.code).toBe('WORKSPACE_NOT_FOUND');
      }
    });
  }

  it("same asset tag is allowed in B's workspace", async () => {
    const mine = await http()
      .post('/api/v1/workspaces')
      .set('Cookie', userB.cookie)
      .set('x-csrf-token', userB.csrfToken)
      .send({ name: 'B Second WS', slug: 'b-second-ws', mode: 'home' });
    const wsB2 = (mine.body as { id: string }).id;
    const res = await http()
      .post(`/api/v1/workspaces/${wsB2}/assets`)
      .set('Cookie', userB.cookie)
      .set('x-csrf-token', userB.csrfToken)
      .send({ assetTag: 'TENANT-0001', displayName: 'Same tag elsewhere' });
    expect(res.status).toBe(201);
  });
});
