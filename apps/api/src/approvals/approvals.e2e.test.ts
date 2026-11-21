import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const storageRoot = mkdtempSync(join(tmpdir(), 'assetnest-approvals-'));

function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function sessionCookieOf(res: { headers: Record<string, unknown> }): string {
  const cookie = asStringArray(res.headers['set-cookie'] as string | string[] | undefined).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  );
  if (!cookie) throw new Error('expected a session cookie');
  return cookie.split(';')[0]!;
}

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-approvals',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64'),
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
let admin: Session;
let manager: Session;
let wsA: string;
let wsB: string;

async function createWorkspace(name: string, slug: string): Promise<string> {
  const res = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name, slug, mode: 'office' });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

async function invite(
  email: string,
  roleKey: 'admin' | 'manager' | 'member',
  displayName: string,
  password: string,
): Promise<Session> {
  const created = await http()
    .post(`/api/v1/workspaces/${wsA}/invites`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ email, roleKey });
  expect(created.status).toBe(201);
  const token = new URL(created.body.acceptUrl as string).searchParams.get('token')!;
  const accepted = await http().post('/api/v1/auth/invites/accept').send({ token, displayName, password });
  expect(accepted.status).toBe(200);
  return {
    cookie: sessionCookieOf(accepted),
    csrfToken: accepted.body.csrfToken as string,
    userId: accepted.body.user.id as string,
  };
}

async function createAsset(tag: string): Promise<string> {
  const res = await http()
    .post(`/api/v1/workspaces/${wsA}/assets`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ assetTag: tag, displayName: `Asset ${tag}`, currency: 'INR', amount: '10.00' });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

async function toInRepair(assetId: string): Promise<void> {
  const res = await http()
    .post(`/api/v1/workspaces/${wsA}/assets/${assetId}/status-transition`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ to: 'in_repair', expectedVersion: 1 });
  expect(res.status).toBe(200);
}

async function createDisposeRequest(assetId: string): Promise<string> {
  const res = await http()
    .post(`/api/v1/workspaces/${wsA}/approvals/requests`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({
      action: 'asset.dispose',
      resourceType: 'asset',
      resourceId: assetId,
      context: { reason: 'test' },
    });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

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
  owner = {
    cookie: sessionCookieOf(register),
    csrfToken: register.body.csrfToken as string,
    userId: register.body.user.id as string,
  };

  wsA = await createWorkspace('Approvals WS A', 'approvals-ws-a');
  wsB = await createWorkspace('Approvals WS B', 'approvals-ws-b');
  admin = await invite('admin@example.com', 'admin', 'Admin', 'admin-passphrase-123');
  manager = await invite('manager@example.com', 'manager', 'Manager', 'manager-passphrase-123');
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('P6-02 approval workflows (e2e)', () => {
  it('defaults to no rules and preserves ungated disposal', async () => {
    const rules = await http().get(`/api/v1/workspaces/${wsA}/approvals/rules`).set('Cookie', owner.cookie);
    expect(rules.status).toBe(200);
    expect(rules.body).toEqual({ rules: [] });

    const assetId = await createAsset('APR-0001');
    await toInRepair(assetId);
    const dispose = await http()
      .post(`/api/v1/workspaces/${wsA}/assets/${assetId}/status-transition`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ to: 'disposed', expectedVersion: 2 });
    expect(dispose.status).toBe(200);
  });

  it('only owner/admin can configure rules', async () => {
    const managerAttempt = await http()
      .put(`/api/v1/workspaces/${wsA}/approvals/rules`)
      .set('Cookie', manager.cookie)
      .set('x-csrf-token', manager.csrfToken)
      .send({
        rules: [
          { action: 'asset.dispose', requiredApprovals: 1, approverRoles: ['manager'], selfApproval: false },
        ],
      });
    expect(managerAttempt.status).toBe(403);

    const ineligibleRule = await http()
      .put(`/api/v1/workspaces/${wsA}/approvals/rules`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ rules: [{ action: 'asset.dispose', requiredApprovals: 1, approverRoles: ['auditor'] }] });
    expect(ineligibleRule.status).toBe(400);

    const set = await http()
      .put(`/api/v1/workspaces/${wsA}/approvals/rules`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        rules: [
          {
            action: 'asset.dispose',
            requiredApprovals: 2,
            approverRoles: ['admin', 'manager'],
            selfApproval: false,
          },
        ],
      });
    expect(set.status).toBe(200);
    expect(set.body.rules).toHaveLength(1);
    expect(set.body.rules[0].requiredApprovals).toBe(2);
  });

  it('blocks disposal without approval and enforces the quorum', async () => {
    const assetId = await createAsset('APR-0002');
    await toInRepair(assetId);

    const blocked = await http()
      .post(`/api/v1/workspaces/${wsA}/assets/${assetId}/status-transition`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ to: 'disposed', expectedVersion: 2 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('APPROVAL_REQUIRED');

    const requestId = await createDisposeRequest(assetId);

    const duplicateRequest = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ action: 'asset.dispose', resourceType: 'asset', resourceId: assetId });
    expect(duplicateRequest.status).toBe(409);
    expect(duplicateRequest.body.code).toBe('APPROVAL_ALREADY_REQUESTED');

    const first = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests/${requestId}/decide`)
      .set('Cookie', admin.cookie)
      .set('x-csrf-token', admin.csrfToken)
      .send({ decision: 'approved', note: 'ok' });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('pending');

    const duplicateDecision = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests/${requestId}/decide`)
      .set('Cookie', admin.cookie)
      .set('x-csrf-token', admin.csrfToken)
      .send({ decision: 'approved' });
    expect(duplicateDecision.status).toBe(409);
    expect(duplicateDecision.body.code).toBe('APPROVAL_ALREADY_DECIDED');

    // Still blocked with only one of two approvals.
    const stillBlocked = await http()
      .post(`/api/v1/workspaces/${wsA}/assets/${assetId}/status-transition`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ to: 'disposed', expectedVersion: 2 });
    expect(stillBlocked.status).toBe(409);

    const second = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests/${requestId}/decide`)
      .set('Cookie', manager.cookie)
      .set('x-csrf-token', manager.csrfToken)
      .send({ decision: 'approved' });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('approved');

    const dispose = await http()
      .post(`/api/v1/workspaces/${wsA}/assets/${assetId}/status-transition`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ to: 'disposed', expectedVersion: 2 });
    expect(dispose.status).toBe(200);
    expect(dispose.body.status).toBe('disposed');

    // The approval is consumed (executed), not reusable.
    const after = await http()
      .get(`/api/v1/workspaces/${wsA}/approvals/requests`)
      .query({ resourceId: assetId })
      .set('Cookie', owner.cookie);
    expect(after.body.requests).toHaveLength(1);
    const found = (after.body.requests as Array<{ id: string; status: string }>).find(
      (r) => r.id === requestId,
    );
    expect(found?.status).toBe('executed');
  });

  it('rejects a request when any approver rejects', async () => {
    const assetId = await createAsset('APR-0003');
    await toInRepair(assetId);
    const requestId = await createDisposeRequest(assetId);

    const reject = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests/${requestId}/decide`)
      .set('Cookie', admin.cookie)
      .set('x-csrf-token', admin.csrfToken)
      .send({ decision: 'rejected', note: 'not now' });
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe('rejected');

    const blocked = await http()
      .post(`/api/v1/workspaces/${wsA}/assets/${assetId}/status-transition`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ to: 'disposed', expectedVersion: 2 });
    expect(blocked.status).toBe(409);
  });

  it('forbids self-approval unless the rule allows it', async () => {
    const set = await http()
      .put(`/api/v1/workspaces/${wsA}/approvals/rules`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        rules: [
          {
            action: 'asset.dispose',
            requiredApprovals: 1,
            approverRoles: ['owner', 'admin'],
            selfApproval: false,
          },
        ],
      });
    expect(set.status).toBe(200);

    const assetId = await createAsset('APR-0004');
    await toInRepair(assetId);
    const requestId = await createDisposeRequest(assetId);

    const self = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests/${requestId}/decide`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ decision: 'approved' });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_APPROVAL_FORBIDDEN');

    const adminApproval = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests/${requestId}/decide`)
      .set('Cookie', admin.cookie)
      .set('x-csrf-token', admin.csrfToken)
      .send({ decision: 'approved' });
    expect(adminApproval.status).toBe(200);
    expect(adminApproval.body.status).toBe('approved');
  });

  it('cancels a pending request and blocks further decisions', async () => {
    const set = await http()
      .put(`/api/v1/workspaces/${wsA}/approvals/rules`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({
        rules: [
          { action: 'asset.dispose', requiredApprovals: 1, approverRoles: ['admin'], selfApproval: false },
        ],
      });
    expect(set.status).toBe(200);

    const assetId = await createAsset('APR-0005');
    await toInRepair(assetId);
    const requestId = await createDisposeRequest(assetId);

    const cancel = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests/${requestId}/cancel`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('cancelled');

    const decide = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests/${requestId}/decide`)
      .set('Cookie', admin.cookie)
      .set('x-csrf-token', admin.csrfToken)
      .send({ decision: 'approved' });
    expect(decide.status).toBe(409);
  });

  it('isolates approvals across workspaces', async () => {
    const cross = await http()
      .get(`/api/v1/workspaces/${wsB}/approvals/requests`)
      .set('Cookie', admin.cookie);
    expect(cross.status).toBe(404);
  });

  it('enforces token scopes and refuses token decisions', async () => {
    const narrow = await http()
      .post(`/api/v1/workspaces/${wsA}/api-tokens`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'narrow', scopes: ['assets:read'], expiresInDays: 30 });
    const narrowToken = narrow.body.token as string;
    const forbidden = await http()
      .get(`/api/v1/workspaces/${wsA}/approvals/rules`)
      .set('Authorization', `Bearer ${narrowToken}`);
    expect(forbidden.status).toBe(403);

    const reader = await http()
      .post(`/api/v1/workspaces/${wsA}/api-tokens`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'approvals-reader', scopes: ['approvals:read'], expiresInDays: 30 });
    const readerToken = reader.body.token as string;
    const allowed = await http()
      .get(`/api/v1/workspaces/${wsA}/approvals/rules`)
      .set('Authorization', `Bearer ${readerToken}`);
    expect(allowed.status).toBe(200);

    const tokenManager = await http()
      .post(`/api/v1/workspaces/${wsA}/api-tokens`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ name: 'approvals-manager', scopes: ['approvals:manage'], expiresInDays: 30 });
    const managerToken = tokenManager.body.token as string;
    const assetId = await createAsset('APR-0006');
    await toInRepair(assetId);
    const requestId = await createDisposeRequest(assetId);
    const tokenDecision = await http()
      .post(`/api/v1/workspaces/${wsA}/approvals/requests/${requestId}/decide`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'approved' });
    expect(tokenDecision.status).toBe(403);
    expect(tokenDecision.body.code).toBe('APPROVAL_HUMAN_REQUIRED');
  });
});
