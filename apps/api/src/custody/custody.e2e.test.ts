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
import { sql } from 'drizzle-orm';
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
let testDb: Database;

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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-custody',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-custody',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;
let roomId: string;
let assetId: string;
let memberId: string;

beforeAll(async () => {
  client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder });
  testDb = pgliteDb as unknown as Database;
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
    .send({ name: 'Custody WS', slug: 'custody-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;

  const loc = await http()
    .post(`/api/v1/workspaces/${workspaceId}/locations`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'Server Room', type: 'room' });
  roomId = (loc.body as { id: string }).id;

  const asset = await http()
    .post(`/api/v1/workspaces/${workspaceId}/assets`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ assetTag: 'CUST-0001', displayName: 'Custody laptop' });
  assetId = (asset.body as { id: string }).id;

  // Member to assign to: the owner themselves (guaranteed active member).
  const members = await http().get(`/api/v1/workspaces/${workspaceId}/members`).set('Cookie', owner.cookie);
  memberId = (members.body.members as Array<{ membershipId: string }>)[0]!.membershipId;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('custody (e2e)', () => {
  it('rejects assignment to a non-member with 400 CUSTODIAN_NOT_MEMBER', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/assign`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ memberId: crypto.randomUUID(), expectedVersion: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CUSTODIAN_NOT_MEMBER');
  });

  it('assigns the asset and records custody + history', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/assign`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ memberId, expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body.asset.status).toBe('assigned');
    expect(res.body.asset.version).toBe(2);
    expect(res.body.assignment.memberId).toBe(memberId);

    const history = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/history`)
      .set('Cookie', owner.cookie);
    expect((history.body.events as Array<{ action: string }>).map((e) => e.action)).toContain(
      'asset.assigned',
    );
  });

  it('rejects a second assignment with 409 ALREADY_ASSIGNED (partial unique)', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/assign`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ memberId, expectedVersion: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_ASSIGNED');
  });

  it('rejects a stale expectedVersion with 409 ASSET_VERSION_CONFLICT', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/transfer`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ toLocationId: roomId, expectedVersion: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSET_VERSION_CONFLICT');
  });

  it('transfers the asset and writes an audit + history record', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/transfer`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ toLocationId: roomId, expectedVersion: 2 });
    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe(roomId);

    const again = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/transfer`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ toLocationId: roomId, expectedVersion: 3 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ASSET_ALREADY_THERE');
  });

  it('lists active assignments with member details', async () => {
    const res = await http().get(`/api/v1/workspaces/${workspaceId}/custody`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    const rows = res.body.assignments as Array<{ assetTag: string; memberName: string; role: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assetTag).toBe('CUST-0001');
    expect(rows[0]!.role).toBe('owner');
  });

  it('returns the asset and closes the assignment', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/return`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ expectedVersion: 3, notes: 'Back in storage' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('available');
    expect(res.body.custodianMembershipId).toBeNull();

    const custody = await http().get(`/api/v1/workspaces/${workspaceId}/custody`).set('Cookie', owner.cookie);
    expect(custody.body.assignments).toHaveLength(0);

    const again = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/return`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ expectedVersion: 4 });
    expect(again.status).toBe(404);
    expect(again.body.code).toBe('ASSIGNMENT_NOT_FOUND');
  });

  it('writes transactional outbox events for assign/transfer/return', async () => {
    const result = await testDb.execute<{ kind: string; schema_version: number }>(
      sql`select kind, schema_version from outbox_events where aggregate_id = ${assetId} order by occurred_at`,
    );
    const kinds = result.rows.map((row) => row.kind);
    expect(kinds).toContain('asset.assigned');
    expect(kinds).toContain('asset.transferred');
    expect(kinds).toContain('asset.returned');
    for (const row of result.rows) {
      expect(row.schema_version).toBe(1);
    }
  });
});
