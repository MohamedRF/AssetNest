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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-perf',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-perf',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;

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
    .send({ name: 'Perf WS', slug: 'perf-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;

  // Seed 1000 assets in one set-based insert (not 1000 round trips).
  await testDb.execute(
    sql`insert into assets (workspace_id, asset_tag, display_name, serial_number, status, condition)
        select ${workspaceId}, 'PERF-' || lpad(n::text, 5, '0'), 'Performance asset ' || n, 'SN-' || lpad(n::text, 6, '0'),
               (array['available', 'assigned', 'in_repair', 'retired'])[1 + (n % 4)],
               (array['new', 'good', 'fair'])[1 + (n % 3)]
        from generate_series(1, 1000) as n`,
  );
  // Ensure the planner sees the real cardinality (ANALYZE).
  await testDb.execute(sql`analyze assets`);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('1k-row workspace behaviour (informational, PGlite engine)', () => {
  it('lists 1000 assets in pages with a stable total', async () => {
    const started = performance.now();
    const page1 = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets?page=1&pageSize=100&sort=assetTag&order=asc`)
      .set('Cookie', owner.cookie);
    const firstPageMs = performance.now() - started;
    console.info(`[perf] list page 1 (100 rows): ${firstPageMs.toFixed(1)}ms`);
    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(1000);
    expect(page1.body.items.length).toBe(100);

    const page10 = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets?page=10&pageSize=100&sort=assetTag&order=asc`)
      .set('Cookie', owner.cookie);
    expect(page10.status).toBe(200);
    const lastTag = page10.body.items.at(-1)?.assetTag;
    expect(lastTag).toBe('PERF-01000');
  });

  it('free-text search over 1k rows stays interactive', async () => {
    const started = performance.now();
    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets?q=${encodeURIComponent('PERF-00042')}`)
      .set('Cookie', owner.cookie);
    const searchMs = performance.now() - started;
    console.info(`[perf] search q=PERF-00042: ${searchMs.toFixed(1)}ms`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('filtered list (status=assigned, ~250 rows) paginates correctly', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets?status=assigned&pageSize=100`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(100); // ~250 for a mod-4 distribution over 1000
    expect(res.body.items.every((a: { status: string }) => a.status === 'assigned')).toBe(true);
  });

  it('history for an asset returns in bounded time', async () => {
    const list = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets?pageSize=1`)
      .set('Cookie', owner.cookie);
    const assetId = list.body.items[0].id as string;
    const started = performance.now();
    const history = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/history`)
      .set('Cookie', owner.cookie);
    const historyMs = performance.now() - started;
    console.info(`[perf] history: ${historyMs.toFixed(1)}ms`);
    expect(history.status).toBe(200);
  });
});
