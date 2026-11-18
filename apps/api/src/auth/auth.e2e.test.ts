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
import { SESSION_COOKIE } from './auth.constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../../packages/db/migrations');

/** Real end-to-end auth flow: embedded PostgreSQL (PGlite) + supertest. */
let client: PGlite;
let testDb: Database;
let app: INestApplication;

interface ProblemBody {
  code: string;
  title: string;
  status: number;
  detail: string;
  requestId: string;
}

interface AuthBody {
  user: { id: string; email: string; displayName: string };
  workspaces: Array<{ id: string; name: string; slug: string; mode: string; role: string }>;
  csrfToken: string;
}

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function sessionCookieOf(setCookie: string[] | undefined): string | undefined {
  return setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
}

beforeAll(async () => {
  client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder });
  testDb = pgliteDb as unknown as Database;
  await seedRoles(testDb);

  const config: AppConfig = loadConfig(testEnv);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
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

describe('auth bootstrap and sessions (e2e)', () => {
  it('GET /auth/me without a cookie returns 401 problem details', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    const body = res.body as ProblemBody;
    expect(body.code).toBe('SESSION_REQUIRED');
    expect(body.requestId).toBeTruthy();
  });

  it('bootstrap register creates the first user and sets a session cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ displayName: 'Admin User', email: 'Admin@Example.com', password: 'a-very-long-passphrase' });
    expect(res.status).toBe(201);
    const body = res.body as AuthBody;
    expect(body.user.email).toBe('admin@example.com');
    expect(body.workspaces).toEqual([]);
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionCookieOf(asStringArray(res.headers['set-cookie']))).toBeTruthy();
    expect(asStringArray(res.headers['set-cookie']).join(';')).toContain('HttpOnly');
  });

  it('registration is closed once a user exists', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ displayName: 'Second User', email: 'second@example.com', password: 'another-long-passphrase' });
    expect(res.status).toBe(403);
    expect((res.body as ProblemBody).code).toBe('REGISTRATION_CLOSED');
  });

  it('login rejects wrong passwords without revealing which part failed', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong-password-altogether' });
    expect(res.status).toBe(401);
    expect((res.body as ProblemBody).code).toBe('INVALID_CREDENTIALS');
  });

  it('login with correct credentials returns workspaces, csrfToken and a cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ADMIN@example.com', password: 'a-very-long-passphrase' });
    expect(res.status).toBe(200);
    const body = res.body as AuthBody;
    expect(body.csrfToken).toBeTruthy();
    expect(sessionCookieOf(asStringArray(res.headers['set-cookie']))).toBeTruthy();
  });

  it('GET /auth/me with the session cookie returns the account', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'a-very-long-passphrase' });
    const cookie = sessionCookieOf(asStringArray(login.headers['set-cookie']))!;

    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect((res.body as AuthBody).user.email).toBe('admin@example.com');
    expect((res.body as AuthBody).csrfToken).toBeTruthy();
  });

  it('mutating requests without the CSRF token are rejected with 403', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'a-very-long-passphrase' });
    const cookie = sessionCookieOf(asStringArray(login.headers['set-cookie']))!;

    const res = await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect((res.body as ProblemBody).code).toBe('CSRF_TOKEN_INVALID');
  });

  it('login → logout with CSRF → session is revoked server-side', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'a-very-long-passphrase' });
    const cookie = sessionCookieOf(asStringArray(login.headers['set-cookie']))!;
    const csrfToken = (login.body as AuthBody).csrfToken;

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrfToken);
    expect(logout.status).toBe(200);

    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
  });

  it('GET /auth/sessions lists the account sessions with isCurrent flagged', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'a-very-long-passphrase' });
    const cookie = sessionCookieOf(asStringArray(login.headers['set-cookie']))!;

    const res = await request(app.getHttpServer()).get('/api/v1/auth/sessions').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const sessionsList = (
      res.body as { sessions: Array<{ id: string; isCurrent: boolean; tokenHash?: never }> }
    ).sessions;
    expect(sessionsList.length).toBeGreaterThanOrEqual(1);
    expect(sessionsList.some((s) => s.isCurrent)).toBe(true);
    expect(JSON.stringify(sessionsList)).not.toContain('tokenHash');
  });

  it('locks the account after 5 failed attempts and rejects even the right password', async () => {
    const passwordHash = await argon2.hash('the-correct-passphrase', { type: argon2.argon2id });
    await testDb.execute(
      sql`insert into users (email, display_name, password_hash) values ('lockme@example.com', 'Lock Me', ${passwordHash})`,
    );

    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'lockme@example.com', password: 'wrong-password-here' });
      expect(res.status).toBe(401);
    }

    const locked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'lockme@example.com', password: 'the-correct-passphrase' });
    expect(locked.status).toBe(403);
    expect((locked.body as ProblemBody).code).toBe('ACCOUNT_LOCKED');

    // Lockout expires (simulate the passage of time) — then the correct password works again.
    await testDb.execute(
      sql`update users set locked_until = now() - interval '1 minute' where email = 'lockme@example.com'`,
    );
    const allowed = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'lockme@example.com', password: 'the-correct-passphrase' });
    expect(allowed.status).toBe(200);
  });

  it('login validates the body and rejects weak input with 400 VALIDATION_FAILED', async () => {
    const badEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'whatever-password' });
    expect(badEmail.status).toBe(400);
    expect((badEmail.body as ProblemBody).code).toBe('VALIDATION_FAILED');

    const weakPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ displayName: 'Weak Pw', email: 'weak@example.com', password: 'short' });
    expect(weakPassword.status).toBe(400);
  });
});
