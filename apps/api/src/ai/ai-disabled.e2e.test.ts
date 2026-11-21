import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';

/**
 * P5-12 offline regression: with AI disabled (the default), every AI route
 * returns 404 AI_DISABLED while the core inventory flow — login, workspace,
 * asset create, document upload — keeps working. AI must never be a hard
 * dependency of asset management.
 */

const migrationsFolder = fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url));
const storageRoot = mkdtempSync(join(tmpdir(), 'assetnest-ai-off-'));

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-ai-off',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
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
}

function sessionFrom(response: request.Response): Session {
  const cookies = response.headers['set-cookie'] as string[] | undefined;
  const cookie = cookies?.find((item) => item.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0];
  if (!cookie) throw new Error('Expected a session cookie');
  return { cookie, csrfToken: response.body.csrfToken as string };
}

function authenticated(test: request.Test, session: Session) {
  return test.set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken);
}

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

let client: PGlite;
let app: INestApplication;
let owner: Session;
let workspaceId: string;
let assetId: string;

beforeAll(async () => {
  client = new PGlite();
  const database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder });
  await seedRoles(database as unknown as Database);

  const config: AppConfig = loadConfig(testEnv);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(DATABASE)
    .useValue(database)
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();

  const register = await http().post('/api/v1/auth/register').send({
    displayName: 'Offline owner',
    email: 'offline-owner@example.com',
    password: 'offline-owner-password-example',
  });
  expect(register.status).toBe(201);
  owner = sessionFrom(register);

  const ws = await authenticated(http().post('/api/v1/workspaces'), owner)
    .send({ name: 'Offline WS', slug: 'offline-ws', mode: 'office' })
    .expect(201);
  workspaceId = ws.body.id as string;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('AI-disabled deployment (offline regression)', () => {
  it('serves 404 AI_DISABLED on every AI route', async () => {
    for (const [method, path] of [
      ['get', 'connections'],
      ['get', 'models'],
      ['get', 'routes'],
      ['post', 'tasks/query'],
      ['post', 'tasks/chat'],
      ['post', 'tasks/maintenance'],
      ['post', 'tasks/extract-invoice'],
      ['post', 'tasks/asset-suggestions'],
    ] as const) {
      const call = authenticated(http()[method](`/api/v1/workspaces/${workspaceId}/ai/${path}`), owner);
      const response = await (method === 'get' ? call : call.send({}));
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('AI_DISABLED');
    }
  });

  it('keeps the core inventory loop working with AI disabled', async () => {
    const asset = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/assets`), owner)
      .send({ assetTag: 'OFF-0001', displayName: 'Offline asset', status: 'available' })
      .expect(201);
    expect(asset.body.assetTag).toBe('OFF-0001');
    assetId = asset.body.id as string;

    const list = await authenticated(http().get(`/api/v1/workspaces/${workspaceId}/assets`), owner).expect(
      200,
    );
    expect(list.body.total).toBe(1);
  });

  it('still accepts private document uploads without AI', async () => {
    const upload = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`),
      owner,
    )
      .field('kind', 'invoice')
      .attach('file', PDF_BYTES, { filename: 'offline-invoice.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(upload.body.mime).toBe('application/pdf');
  });

  it('keeps the dashboard read endpoint available', async () => {
    await authenticated(http().get(`/api/v1/workspaces/${workspaceId}`), owner).expect(200);
  });
});
