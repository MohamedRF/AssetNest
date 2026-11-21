import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
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
const storageRoot = mkdtempSync(join(tmpdir(), 'assetnest-policies-'));

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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-policies',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: storageRoot,
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

interface Session {
  cookie: string;
  csrfToken: string;
  userId: string;
}

let owner: Session;
let auditor: Session;
let wsA: string;
let wsB: string;
let reportsToken: string; // reports:read only
let adminToken: string; // reports:read + exports:manage + audit:read + audit:manage
let downloadToken: string; // reports:read only, used for revoke test
let downloadTokenId: string;

const DAY = 24 * 60 * 60 * 1000;

async function createWorkspace(name: string, slug: string): Promise<string> {
  const res = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name, slug, mode: 'office' });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

async function createToken(name: string, scopes: string[]): Promise<{ token: string; id: string }> {
  const res = await http()
    .post(`/api/v1/workspaces/${wsA}/api-tokens`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name, scopes, expiresInDays: 30 });
  expect(res.status).toBe(201);
  return res.body as { token: string; id: string };
}

async function generateExport(cookie: string, csrf: string, report = 'assets'): Promise<{ id: string }> {
  const res = await http()
    .post(`/api/v1/workspaces/${wsA}/exports`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrf)
    .send({ report });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

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
  owner = {
    cookie: sessionCookieOf(register),
    csrfToken: register.body.csrfToken as string,
    userId: register.body.user.id as string,
  };

  wsA = await createWorkspace('Policy WS A', 'policy-ws-a');
  wsB = await createWorkspace('Policy WS B', 'policy-ws-b');

  await http()
    .post(`/api/v1/workspaces/${wsA}/assets`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ assetTag: 'POL-0001', displayName: 'Policy asset', currency: 'INR', amount: '100.00' });

  // Auditor member of workspace A only.
  const invite = await http()
    .post(`/api/v1/workspaces/${wsA}/invites`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ email: 'auditor@example.com', roleKey: 'auditor' });
  const inviteToken = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
  const accept = await http()
    .post('/api/v1/auth/invites/accept')
    .send({ token: inviteToken, displayName: 'Auditor', password: 'auditor-passphrase-123' });
  auditor = {
    cookie: sessionCookieOf(accept),
    csrfToken: accept.body.csrfToken as string,
    userId: accept.body.user.id as string,
  };

  const reports = await createToken('reports', ['reports:read']);
  reportsToken = reports.token;
  const admin = await createToken('policy-admin', [
    'reports:read',
    'exports:manage',
    'audit:read',
    'audit:manage',
  ]);
  adminToken = admin.token;
  const dl = await createToken('downloader', ['reports:read']);
  downloadToken = dl.token;
  downloadTokenId = dl.id;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('P6-01 workspace policies (e2e)', () => {
  it('defaults are safe and policies are workspace-scoped', async () => {
    const a = await http().get(`/api/v1/workspaces/${wsA}/policies`).set('Cookie', owner.cookie);
    expect(a.status).toBe(200);
    expect(a.body).toEqual({
      auditRetentionDays: null,
      exportPolicy: { enabled: true, maxAgeDays: null },
    });

    // Owner belongs to B too — separate policy, same safe defaults.
    const b = await http().get(`/api/v1/workspaces/${wsB}/policies`).set('Cookie', owner.cookie);
    expect(b.status).toBe(200);
    expect(b.body.auditRetentionDays).toBeNull();

    // Auditor is not a member of B: 404 (no existence oracle).
    const crossMember = await http().get(`/api/v1/workspaces/${wsB}/policies`).set('Cookie', auditor.cookie);
    expect(crossMember.status).toBe(404);

    // A token bound to A cannot read B's policies.
    const crossToken = await http()
      .get(`/api/v1/workspaces/${wsB}/policies`)
      .set('Authorization', `Bearer ${reportsToken}`);
    expect(crossToken.status).toBe(404);

    // A token without workspace:manage is denied A's policies.
    const insufficient = await http()
      .get(`/api/v1/workspaces/${wsA}/policies`)
      .set('Authorization', `Bearer ${reportsToken}`);
    expect(insufficient.status).toBe(403);
    expect(insufficient.body.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('audit retention can be set by audit:manage and rejects invalid values', async () => {
    const set = await http()
      .put(`/api/v1/workspaces/${wsA}/policies/audit-retention`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ retentionDays: 30 });
    expect(set.status).toBe(200);
    expect(set.body.auditRetentionDays).toBe(30);

    const invalid = await http()
      .put(`/api/v1/workspaces/${wsA}/policies/audit-retention`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ retentionDays: 0 });
    expect(invalid.status).toBe(400);

    // Token with audit:manage may change it.
    const byToken = await http()
      .put(`/api/v1/workspaces/${wsA}/policies/audit-retention`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ retentionDays: 90 });
    expect(byToken.status).toBe(200);
    expect(byToken.body.auditRetentionDays).toBe(90);

    // Token without audit:manage may not.
    const denied = await http()
      .put(`/api/v1/workspaces/${wsA}/policies/audit-retention`)
      .set('Authorization', `Bearer ${reportsToken}`)
      .send({ retentionDays: 10 });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('auditor can read the audit trail (audit:read) while a narrow token cannot', async () => {
    const auditorRead = await http().get(`/api/v1/workspaces/${wsA}/audit-log`).set('Cookie', auditor.cookie);
    expect(auditorRead.status).toBe(200);
    expect(Array.isArray(auditorRead.body.entries)).toBe(true);

    const tokenDenied = await http()
      .get(`/api/v1/workspaces/${wsA}/audit-log`)
      .set('Authorization', `Bearer ${reportsToken}`);
    expect(tokenDenied.status).toBe(403);

    const tokenAllowed = await http()
      .get(`/api/v1/workspaces/${wsA}/audit-log`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(tokenAllowed.status).toBe(200);
  });

  it('pruning deletes only this workspace’s old audit rows and respects null retention', async () => {
    // Finite retention on A only.
    await http()
      .put(`/api/v1/workspaces/${wsA}/policies/audit-retention`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ retentionDays: 30 });

    const now = new Date();
    const old = new Date(now.getTime() - 40 * DAY);
    const recent = new Date(now.getTime() - 5 * DAY);
    await testDb.insert(schema.auditLog).values([
      { workspaceId: wsA, action: 'test.old', resource: 'test', occurredAt: old },
      { workspaceId: wsA, action: 'test.recent', resource: 'test', occurredAt: recent },
      { workspaceId: wsB, action: 'test.other-workspace', resource: 'test', occurredAt: old },
    ]);

    const prune = await http()
      .post(`/api/v1/workspaces/${wsA}/policies/audit-retention/prune`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(prune.status).toBe(200);
    expect(prune.body.deleted).toBe(1);
    expect(typeof prune.body.cutoff).toBe('string');

    const remainingA = await testDb
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, wsA));
    expect(remainingA.map((r) => r.action)).toContain('test.recent');
    expect(remainingA.map((r) => r.action)).not.toContain('test.old');

    // The other workspace is never touched.
    const other = await testDb
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, wsB));
    expect(other.map((r) => r.action)).toContain('test.other-workspace');

    // Null retention is a no-op even for very old rows.
    await http()
      .put(`/api/v1/workspaces/${wsA}/policies/audit-retention`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ retentionDays: null });
    await testDb.insert(schema.auditLog).values({
      workspaceId: wsA,
      action: 'test.ancient',
      resource: 'test',
      occurredAt: new Date(now.getTime() - 900 * DAY),
    });
    const noop = await http()
      .post(`/api/v1/workspaces/${wsA}/policies/audit-retention/prune`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(noop.status).toBe(200);
    expect(noop.body).toEqual({ cutoff: null, deleted: 0 });
    const ancient = await testDb
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'test.ancient'));
    expect(ancient).toHaveLength(1);
  });

  it('export policy blocks create/list/download and re-applies to existing files', async () => {
    const created = await generateExport(owner.cookie, owner.csrfToken);
    const before = await http()
      .get(`/api/v1/workspaces/${wsA}/exports/${created.id}/download`)
      .set('Cookie', owner.cookie);
    expect(before.status).toBe(200);

    // Disable exports.
    const disable = await http()
      .put(`/api/v1/workspaces/${wsA}/policies/export-policy`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ enabled: false, maxAgeDays: null });
    expect(disable.status).toBe(200);

    const create = await http()
      .post(`/api/v1/workspaces/${wsA}/exports`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ report: 'assets' });
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('EXPORT_DISABLED');

    const list = await http().get(`/api/v1/workspaces/${wsA}/exports`).set('Cookie', owner.cookie);
    expect(list.status).toBe(200);
    expect(list.body.policy.enabled).toBe(false);
    expect(list.body.exports).toEqual([]);

    const download = await http()
      .get(`/api/v1/workspaces/${wsA}/exports/${created.id}/download`)
      .set('Cookie', owner.cookie);
    expect(download.status).toBe(403);
    expect(download.body.code).toBe('EXPORT_DISABLED');

    // A token with only reports:read cannot change the policy.
    const denied = await http()
      .put(`/api/v1/workspaces/${wsA}/policies/export-policy`)
      .set('Authorization', `Bearer ${reportsToken}`)
      .send({ enabled: true, maxAgeDays: null });
    expect(denied.status).toBe(403);

    // A token with exports:manage can re-enable it; the old file downloads again.
    const reenable = await http()
      .put(`/api/v1/workspaces/${wsA}/policies/export-policy`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true, maxAgeDays: null });
    expect(reenable.status).toBe(200);
    const after = await http()
      .get(`/api/v1/workspaces/${wsA}/exports/${created.id}/download`)
      .set('Cookie', owner.cookie);
    expect(after.status).toBe(200);
  });

  it('shortening maxAgeDays expires previously generated files', async () => {
    const created = await generateExport(owner.cookie, owner.csrfToken);

    await http()
      .put(`/api/v1/workspaces/${wsA}/policies/export-policy`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ enabled: true, maxAgeDays: 1 });

    // Age the generated file beyond the new window.
    await testDb
      .update(schema.exports)
      .set({ createdAt: new Date(Date.now() - 3 * DAY) })
      .where(eq(schema.exports.id, created.id));
    await testDb.insert(schema.exports).values(
      Array.from({ length: 20 }, () => ({
        workspaceId: wsA,
        report: 'assets',
        objectKey: 'expired-fixture.csv',
        createdAt: new Date(Date.now() - 3 * DAY),
      })),
    );
    const recent = await generateExport(owner.cookie, owner.csrfToken);

    const expired = await http()
      .get(`/api/v1/workspaces/${wsA}/exports/${created.id}/download`)
      .set('Cookie', owner.cookie);
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('EXPORT_EXPIRED');

    const list = await http().get(`/api/v1/workspaces/${wsA}/exports`).set('Cookie', owner.cookie);
    expect(list.body.policy.maxAgeDays).toBe(1);
    expect((list.body.exports as Array<{ id: string }>).map((e) => e.id)).not.toContain(created.id);
    expect(list.body.exports[0]?.id).toBe(recent.id);

    // Reverting the policy makes the file downloadable again (reversible default).
    await http()
      .put(`/api/v1/workspaces/${wsA}/policies/export-policy`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ enabled: true, maxAgeDays: null });
    const restored = await http()
      .get(`/api/v1/workspaces/${wsA}/exports/${created.id}/download`)
      .set('Cookie', owner.cookie);
    expect(restored.status).toBe(200);
  });

  it('revoked token and revoked role cannot download an existing export', async () => {
    const createdByToken = await http()
      .post(`/api/v1/workspaces/${wsA}/exports`)
      .set('Authorization', `Bearer ${downloadToken}`)
      .send({ report: 'assets' });
    expect(createdByToken.status).toBe(201);
    const exportId = (createdByToken.body as { id: string }).id;

    const ok = await http()
      .get(`/api/v1/workspaces/${wsA}/exports/${exportId}/download`)
      .set('Authorization', `Bearer ${downloadToken}`);
    expect(ok.status).toBe(200);

    // Revoke the token — the same file is no longer reachable with it.
    const revoke = await http()
      .delete(`/api/v1/workspaces/${wsA}/api-tokens/${downloadTokenId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(revoke.status).toBe(200);
    const afterRevoke = await http()
      .get(`/api/v1/workspaces/${wsA}/exports/${exportId}/download`)
      .set('Authorization', `Bearer ${downloadToken}`);
    expect(afterRevoke.status).toBe(401);

    // Auditor can download while they hold reports:read.
    const auditorBefore = await http()
      .get(`/api/v1/workspaces/${wsA}/exports/${exportId}/download`)
      .set('Cookie', auditor.cookie);
    expect(auditorBefore.status).toBe(200);

    // Owner demotes the auditor to member — reports:read is gone, download denied.
    const demote = await http()
      .post(`/api/v1/workspaces/${wsA}/members/${auditor.userId}/role`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ roleKey: 'member' });
    expect(demote.status).toBe(200);
    const auditorAfter = await http()
      .get(`/api/v1/workspaces/${wsA}/exports/${exportId}/download`)
      .set('Cookie', auditor.cookie);
    expect(auditorAfter.status).toBe(403);
  });

  it('tokens cannot reach another workspace’s exports', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${wsB}/exports`)
      .set('Authorization', `Bearer ${reportsToken}`);
    expect(res.status).toBe(404);

    const memberRes = await http().get(`/api/v1/workspaces/${wsB}/exports`).set('Cookie', auditor.cookie);
    expect(memberRes.status).toBe(404);
  });
});
