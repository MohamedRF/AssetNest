import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-audit',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-audit',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;
let locationId: string;
let assetInScope: string;
let assetOutOfScope: string;
let assetInScope2: string;
let auditId: string;

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
    .send({ name: 'Audit WS', slug: 'audit-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;
  const loc = await http()
    .post(`/api/v1/workspaces/${workspaceId}/locations`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'HQ Floor', type: 'floor' });
  locationId = (loc.body as { id: string }).id;

  for (const [tag, locationFlag] of [
    ['AUD-0001', true],
    ['AUD-0002', false],
    ['AUD-0003', true],
  ] as const) {
    const asset = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetTag: tag, displayName: `Audit asset ${tag}`, ...(locationFlag ? { locationId } : {}) });
    if (tag === 'AUD-0001') assetInScope = (asset.body as { id: string }).id;
    if (tag === 'AUD-0002') assetOutOfScope = (asset.body as { id: string }).id;
    if (tag === 'AUD-0003') assetInScope2 = (asset.body as { id: string }).id;
  }
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('audits (e2e)', () => {
  it('opens a location-scoped audit with a pre-created snapshot of in-scope assets', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/audits`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ label: 'Q1 floor audit', scope: { locationId } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('open');
    expect(res.body.counts.total).toBe(2);
    expect(res.body.counts.unobserved).toBe(2);
    auditId = res.body.id;
  });

  it('records an observation (present) and shows it in counts', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/audits/${auditId}/verify`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetId: assetInScope, observation: 'present' });
    expect(res.status).toBe(200);

    const detail = await http()
      .get(`/api/v1/workspaces/${workspaceId}/audits/${auditId}`)
      .set('Cookie', owner.cookie);
    expect(detail.body.counts.present).toBe(1);
    expect(detail.body.counts.unobserved).toBe(1);
  });

  it('rejects an out-of-scope asset with 404 AUDIT_ITEM_NOT_FOUND', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/audits/${auditId}/verify`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetId: assetOutOfScope, observation: 'present' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('AUDIT_ITEM_NOT_FOUND');
  });

  it('allows re-observation (resolution history is the audit trail)', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/audits/${auditId}/verify`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        assetId: assetInScope,
        observation: 'moved',
        observedLocationId: locationId,
        notes: 'Found in the other room',
      });
    expect(res.status).toBe(200);

    const audit = await http()
      .get(`/api/v1/workspaces/${workspaceId}/audit-log?limit=20`)
      .set('Cookie', owner.cookie);
    const verified = (audit.body.entries as Array<{ action: string; metadataJson: { to?: string } }>).filter(
      (e) => e.action === 'audit.item_verified',
    );
    expect(verified.map((e) => e.metadataJson.to)).toEqual(expect.arrayContaining(['present', 'moved']));
  });

  it('closes the audit (emits outbox event) and is immutable afterwards', async () => {
    const close = await http()
      .post(`/api/v1/workspaces/${workspaceId}/audits/${auditId}/close`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ notes: 'All scanned' });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('closed');

    const outbox = await testDb.execute<{ kind: string }>(
      sql`select kind from outbox_events where aggregate_id = ${auditId}`,
    );
    const kinds = outbox.rows.map((r) => r.kind);
    expect(kinds).toContain('audit.opened');
    expect(kinds).toContain('audit.closed');

    const verify = await http()
      .post(`/api/v1/workspaces/${workspaceId}/audits/${auditId}/verify`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ assetId: assetInScope2, observation: 'present' });
    expect(verify.status).toBe(409);
    expect(verify.body.code).toBe('AUDIT_CLOSED');

    const closeAgain = await http()
      .post(`/api/v1/workspaces/${workspaceId}/audits/${auditId}/close`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({});
    expect(closeAgain.status).toBe(409);

    // Exactly one close event is ever emitted, even under a repeated close.
    const closed = await testDb.execute<{ count: string }>(
      sql`select count(*)::text as count from outbox_events where aggregate_id = ${auditId} and kind = 'audit.closed'`,
    );
    expect(Number(closed.rows[0]?.count ?? '0')).toBe(1);
  });

  it('rejects a plain member (audits:manage required)', async () => {
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

    const res = await http().get(`/api/v1/workspaces/${workspaceId}/audits`).set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});
