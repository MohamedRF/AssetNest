import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { sha256Hex } from '../common/crypto.js';
import { SESSION_COOKIE } from './auth.constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../../packages/db/migrations');

let client: PGlite;
let app: INestApplication;
let testDb: Database;
let userId: string;

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
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-session-hardening',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 13).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-session-hardening',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
  SESSION_IDLE_TIMEOUT_MINUTES: '10',
  SESSION_ABSOLUTE_TIMEOUT_HOURS: '12',
};

const http = () => request(app.getHttpServer());

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
    .send({ displayName: 'Hardening', email: 'hardening@example.com', password: 'hardening-passphrase-1' });
  expect(register.status).toBe(201);
  userId = register.body.user.id as string;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
});

describe('session hardening (P6-04)', () => {
  it('rejects and revokes a session past the idle timeout', async () => {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'hardening@example.com', password: 'hardening-passphrase-1' });
    expect(login.status).toBe(200);
    const cookie = sessionCookieOf(login);

    // Simulate 20 minutes of inactivity.
    await testDb
      .update(schema.sessions)
      .set({ lastSeenAt: new Date(Date.now() - 20 * 60_000) })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));

    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);

    const token = cookie.slice(cookie.indexOf('=') + 1);
    const [session] = await testDb
      .select({ revokedAt: schema.sessions.revokedAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, sha256Hex(token)));
    // The idle-expired session is revoked, not left usable.
    expect(session?.revokedAt).toBeInstanceOf(Date);
  });

  it('rejects a session past the absolute lifetime even if recently active', async () => {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'hardening@example.com', password: 'hardening-passphrase-1' });
    expect(login.status).toBe(200);
    const cookie = sessionCookieOf(login);

    // Recently active, but created 13 hours ago (absolute cap is 12h).
    await testDb
      .update(schema.sessions)
      .set({ createdAt: new Date(Date.now() - 13 * 3_600_000), lastSeenAt: new Date() })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));

    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
  });
});
