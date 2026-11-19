import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { Test } from '@nestjs/testing';

// MCP_ENABLED deliberately NOT set (nor in the env below): the endpoint must not exist.
const { AppModule } = await import('../app.module.js');

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../../packages/db/migrations');

let client: PGlite;
let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder });
  const testDb = pgliteDb as unknown as Database;
  await seedRoles(testDb);

  const config: AppConfig = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_APP_URL: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-mcp-disabled',
    SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    STORAGE_DRIVER: 'local',
    STORAGE_ROOT: './var/e2e-mcp-disabled',
    MAIL_TRANSPORT: 'log',
    AI_ENABLED: 'false',
    MCP_ENABLED: 'false',
    WEBHOOKS_ENABLED: 'false',
  });
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

describe('MCP disabled (default)', () => {
  it('POST /api/v1/mcp does not exist (404)', async () => {
    const res = await http()
      .post('/api/v1/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set('MCP-Protocol-Version', '2026-07-28')
      .set('Mcp-Method', 'server/discover')
      .send({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} });
    expect(res.status).toBe(404);
  });

  it('core REST endpoints stay unaffected (health live)', async () => {
    const res = await http().get('/api/v1/health/live');
    expect(res.status).toBe(200);
  });
});
