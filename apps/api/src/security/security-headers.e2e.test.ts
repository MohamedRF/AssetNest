import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-security-headers',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-security-headers',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

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
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('security headers and browser hardening (P6-05)', () => {
  it('sets baseline security headers and hides the framework banner', async () => {
    const res = await http().get('/api/v1/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('returns RFC7807 problem details with a request id', async () => {
    const res = await http().get('/api/v1/definitely-not-a-route');
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ title: expect.any(String), status: 404, code: expect.any(String) });
    expect(res.body.requestId).toBeDefined();
  });

  it('restricts CORS to the configured web origin', async () => {
    const allowed = await http().get('/api/v1/health/live').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await http().get('/api/v1/health/live').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets HttpOnly and SameSite on the session cookie', async () => {
    const register = await http()
      .post('/api/v1/auth/register')
      .send({ displayName: 'Security', email: 'security@example.com', password: 'security-passphrase-1' });
    expect(register.status).toBe(201);
    const setCookie = (register.headers['set-cookie'] as unknown as string[]) ?? [];
    const sessionCookie = setCookie.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
  });
});
