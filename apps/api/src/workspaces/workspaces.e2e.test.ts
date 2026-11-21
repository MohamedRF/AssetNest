import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import argon2 from 'argon2';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';
import { WorkspacesService } from './workspaces.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../../packages/db/migrations');

let client: PGlite;
let testDb: Database;
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

interface TestUser {
  cookie: string;
  csrfToken: string;
  userId: string;
}

const http = () => request(app.getHttpServer());

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-workspaces',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

async function registerBootstrapAdmin(): Promise<TestUser> {
  const res = await http()
    .post('/api/v1/auth/register')
    .send({ displayName: 'Owner One', email: 'owner@example.com', password: 'owner-passphrase-123' });
  return {
    cookie: sessionCookieOf(res),
    csrfToken: res.body.csrfToken as string,
    userId: (res.body.user as { id: string }).id,
  };
}

async function signIn(email: string, password: string): Promise<TestUser> {
  const res = await http().post('/api/v1/auth/login').send({ email, password });
  return {
    cookie: sessionCookieOf(res),
    csrfToken: res.body.csrfToken as string,
    userId: (res.body.user as { id: string }).id,
  };
}

/** Creates a workspace via the API and returns its id. */
async function createWorkspace(user: TestUser, name: string, slug?: string): Promise<string> {
  const res = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', user.cookie)
    .set('x-csrf-token', user.csrfToken)
    .send(slug ? { name, slug, mode: 'office' } : { name, mode: 'office' });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
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
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('workspaces (e2e)', () => {
  let owner: TestUser;
  let workspaceId: string;

  it('bootstrap admin creates the first workspace (owner role, 201)', async () => {
    owner = await registerBootstrapAdmin();
    workspaceId = await createWorkspace(owner, 'Acme Office', 'acme-office');
    expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates a unique slug automatically when not provided', async () => {
    const second = await createWorkspace(owner, 'Acme Office');
    expect(second).not.toBe(workspaceId);
    const list = await http().get('/api/v1/workspaces').set('Cookie', owner.cookie);
    expect(list.status).toBe(200);
    const slugs = (list.body.workspaces as Array<{ slug: string }>).map((w) => w.slug);
    expect(slugs).toContain('acme-office');
    expect(slugs).toContain('acme-office-2');
  });

  it('rejects a taken explicit slug with 409 SLUG_TAKEN', async () => {
    const res = await http()
      .post('/api/v1/workspaces')
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'Another', slug: 'acme-office', mode: 'office' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLUG_TAKEN');
  });

  it('returns the workspace detail with memberCount to the owner', async () => {
    const res = await http().get(`/api/v1/workspaces/${workspaceId}`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Acme Office', mode: 'office', role: 'owner', memberCount: 1 });
  });

  it('hides the workspace from non-members (404, no existence oracle)', async () => {
    const passwordHash = await argon2.hash('outsider-passphrase', { type: argon2.argon2id });
    await testDb.execute(
      sql`insert into users (email, display_name, password_hash) values ('outsider@example.com', 'Out Sider', ${passwordHash})`,
    );
    const outsider = await signIn('outsider@example.com', 'outsider-passphrase');
    const res = await http().get(`/api/v1/workspaces/${workspaceId}`).set('Cookie', outsider.cookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('invite → accept → new member appears with the invited role', async () => {
    const invite = await http()
      .post(`/api/v1/workspaces/${workspaceId}/invites`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ email: 'auditor@example.com', roleKey: 'auditor' });
    expect(invite.status).toBe(201);
    expect(invite.body.acceptUrl).toContain('accept-invite?token=');
    const token = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;

    const accept = await http()
      .post('/api/v1/auth/invites/accept')
      .send({ token, displayName: 'Audi Tor', password: 'auditor-passphrase-123' });
    expect(accept.status).toBe(200);
    const auditorCookie = sessionCookieOf(accept);

    const members = await http()
      .get(`/api/v1/workspaces/${workspaceId}/members`)
      .set('Cookie', auditorCookie);
    expect(members.status).toBe(200);
    const auditorRow = (members.body.members as Array<{ email: string; role: string }>).find(
      (m) => m.email === 'auditor@example.com',
    );
    expect(auditorRow?.role).toBe('auditor');

    // The same token cannot be reused.
    const replay = await http()
      .post('/api/v1/auth/invites/accept')
      .send({ token, displayName: 'Audi Tor', password: 'auditor-passphrase-123' });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('INVITE_INVALID');
  });

  it('auditor cannot rename the workspace (RBAC: audits:manage only)', async () => {
    const auditor = await signIn('auditor@example.com', 'auditor-passphrase-123');
    const res = await http()
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', auditor.cookie)
      .set('x-csrf-token', auditor.csrfToken)
      .send({ name: 'Renamed by auditor' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('owner can rename the workspace and the change is audited', async () => {
    const res = await http()
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'Acme HQ' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme HQ');

    const audit = await http().get(`/api/v1/workspaces/${workspaceId}/audit-log`).set('Cookie', owner.cookie);
    expect(audit.status).toBe(200);
    const actions = (audit.body.entries as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('workspace.created');
    expect(actions).toContain('workspace.updated');
    expect(actions).toContain('invite.accepted');
  });

  it('changing roles enforces the owner/admin matrix and keeps a last owner', async () => {
    // owner demotes self? Last-owner protection must block it (owner is the only owner).
    const members = await http().get(`/api/v1/workspaces/${workspaceId}/members`).set('Cookie', owner.cookie);
    const ownerRow = (members.body.members as Array<{ userId: string; role: string }>).find(
      (m) => m.role === 'owner',
    )!;
    const demote = await http()
      .post(`/api/v1/workspaces/${workspaceId}/members/${ownerRow.userId}/role`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ roleKey: 'admin' });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('LAST_OWNER');

    // Promote auditor to member, then to admin as owner (matrix allows owner to grant admin).
    const auditorRow = (members.body.members as Array<{ userId: string; email: string }>).find(
      (m) => m.email === 'auditor@example.com',
    )!;
    const promote = await http()
      .post(`/api/v1/workspaces/${workspaceId}/members/${auditorRow.userId}/role`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ roleKey: 'admin' });
    expect(promote.status).toBe(200);
  });

  it('removing a member suspends access (workspace becomes 404 for them)', async () => {
    const members = await http().get(`/api/v1/workspaces/${workspaceId}/members`).set('Cookie', owner.cookie);
    const auditorRow = (members.body.members as Array<{ userId: string; email: string }>).find(
      (m) => m.email === 'auditor@example.com',
    )!;
    const removed = await http()
      .delete(`/api/v1/workspaces/${workspaceId}/members/${auditorRow.userId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(removed.status).toBe(200);

    const auditor = await signIn('auditor@example.com', 'auditor-passphrase-123');
    const res = await http().get(`/api/v1/workspaces/${workspaceId}`).set('Cookie', auditor.cookie);
    expect(res.status).toBe(404);
  });

  it('serializes concurrent owner removals so a workspace never reaches zero owners', async () => {
    // Fresh workspace with two owners (the bootstrap owner + a promoted co-owner).
    const wsId = await createWorkspace(owner, 'Two Owners', 'two-owners');
    const invite = await http()
      .post(`/api/v1/workspaces/${wsId}/invites`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ email: 'coowner@example.com', roleKey: 'manager' });
    const inviteToken = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
    await http()
      .post('/api/v1/auth/invites/accept')
      .send({ token: inviteToken, displayName: 'Co Owner', password: 'coowner-passphrase-123' });
    const coOwner = await signIn('coowner@example.com', 'coowner-passphrase-123');
    const promote = await http()
      .post(`/api/v1/workspaces/${wsId}/members/${coOwner.userId}/role`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ roleKey: 'owner' });
    expect(promote.status).toBe(200);

    // Drive the service directly (bypassing the HTTP guard) so both removals
    // enter the mutation path concurrently — the workspace row lock must let
    // exactly one succeed and reject the other with LAST_OWNER.
    const service = app.get(WorkspacesService);
    const ownerCtx = {
      workspaceId: wsId,
      membershipId: 'actor',
      role: 'owner',
    } as unknown as WorkspaceContext;
    const results = await Promise.allSettled([
      service.removeMember(ownerCtx, owner.userId, owner.userId),
      service.removeMember(ownerCtx, owner.userId, coOwner.userId),
    ]);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? 'fulfilled' : 'rejected'));
    expect(statuses.sort()).toEqual(['fulfilled', 'rejected']);

    const owners = await testDb.execute<{ count: string }>(
      sql`select count(*)::text as count from memberships where workspace_id = ${wsId} and role_key = 'owner' and status = 'active'`,
    );
    expect(Number(owners.rows[0]?.count ?? '0')).toBe(1);
  });
});
