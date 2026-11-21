import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import request from 'supertest';
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

let client: PGlite;
let app: INestApplication;
let provider: Server;
let issuer: string;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwk: JWK;
interface TestIdentity {
  email: string;
  sub: string;
  emailVerified?: boolean;
}

const pendingGrants = new Map<string, TestIdentity & { nonce: string }>();

const CLIENT_ID = 'assetnest-client';

function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolveBody(data));
    req.on('error', reject);
  });
}

async function signIdToken({
  nonce,
  email,
  sub,
  emailVerified,
}: TestIdentity & { nonce: string }): Promise<string> {
  return new SignJWT({ email, email_verified: emailVerified, name: 'OIDC User', nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'e2e-key' })
    .setIssuer(issuer)
    .setAudience(CLIENT_ID)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-oidc',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: './var/e2e-oidc',
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
};

const http = () => request(app.getHttpServer());

beforeAll(async () => {
  const generated = await generateKeyPair('RS256');
  privateKey = generated.privateKey;
  jwk = { ...(await exportJWK(generated.publicKey)), kid: 'e2e-key', alg: 'RS256', use: 'sig' };

  provider = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/.well-known/openid-configuration') {
      json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
      return;
    }
    if (url.pathname === '/jwks') {
      json(res, 200, { keys: [jwk] });
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      const code = params.get('code') ?? '';
      const grant = pendingGrants.get(code);
      if (
        params.get('grant_type') !== 'authorization_code' ||
        params.get('client_id') !== CLIENT_ID ||
        !grant ||
        !params.get('code_verifier')
      ) {
        json(res, 400, { error: 'invalid_request' });
        return;
      }
      pendingGrants.delete(code);
      const idToken = await signIdToken(grant);
      json(res, 200, { id_token: idToken, token_type: 'Bearer' });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });
  await new Promise<void>((resolveProvider) => provider.listen(0, '127.0.0.1', resolveProvider));
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('no provider port');
  issuer = `http://127.0.0.1:${address.port}`;

  client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder });
  const testDb = pgliteDb as unknown as Database;
  await seedRoles(testDb);

  const config: AppConfig = loadConfig({
    ...testEnv,
    OIDC_ENABLED: 'true',
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_REDIRECT_URI: 'http://localhost:5173/api/v1/auth/oidc/callback',
    OIDC_ALLOWED_DOMAINS: 'example.com',
    OIDC_AUTO_CREATE: 'true',
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

  // Bootstrap a local account so the linking test can merge an existing user.
  const register = await http()
    .post('/api/v1/auth/register')
    .send({ displayName: 'Local', email: 'local@example.com', password: 'local-passphrase-123' });
  expect(register.status).toBe(201);
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  await new Promise<void>((resolveProvider) => provider.close(() => resolveProvider()));
});

async function startLogin(): Promise<{ cookieHeader: string; state: string; nonce: string }> {
  const start = await http().get('/api/v1/auth/oidc/start');
  expect(start.status).toBe(302);
  expect(start.headers['cache-control']).toBe('no-store');
  const setCookies = asStringArray(start.headers['set-cookie'] as string | string[] | undefined);
  const cookieHeader = setCookies.map((cookie) => cookie.split(';')[0]!).join('; ');
  const values = new Map<string, string>();
  for (const cookie of setCookies) {
    const pair = cookie.split(';')[0]!;
    const eq = pair.indexOf('=');
    values.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const state = values.get('assetnest_oidc_state');
  const nonce = values.get('assetnest_oidc_nonce');
  if (!state || !nonce) throw new Error('missing OIDC cookies');
  return { cookieHeader, state, nonce };
}

async function callbackFor(identity: TestIdentity) {
  const start = await startLogin();
  const code = randomUUID();
  pendingGrants.set(code, { ...identity, nonce: start.nonce });
  const callback = await http()
    .get('/api/v1/auth/oidc/callback')
    .query({ code, state: start.state })
    .set('Cookie', start.cookieHeader);
  expect(callback.headers['cache-control']).toBe('no-store');
  return callback;
}

function findSessionCookie(callback: { headers: Record<string, unknown> }): string | undefined {
  const setCookies = asStringArray(callback.headers['set-cookie'] as string | string[] | undefined);
  return setCookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0];
}

describe('OIDC single sign-on (e2e)', () => {
  it('auto-creates an account and establishes a session', async () => {
    const callback = await callbackFor({
      email: 'user@example.com',
      sub: 'oidc-subject-1',
      emailVerified: true,
    });
    expect(callback.status).toBe(302);
    expect(callback.headers['location']).toBe('http://localhost:5173');

    const sessionCookie = findSessionCookie(callback);
    expect(sessionCookie).toBeDefined();

    const me = await http().get('/api/v1/auth/me').set('Cookie', sessionCookie!);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('user@example.com');
  });

  it('rejects a state mismatch', async () => {
    const start = await startLogin();
    const callback = await http()
      .get('/api/v1/auth/oidc/callback?code=test-code&state=wrong-state')
      .set('Cookie', start.cookieHeader);
    expect(callback.status).toBe(400);
    expect(callback.body.code).toBe('OIDC_STATE_INVALID');
  });

  it('rejects an email domain outside the allowlist', async () => {
    const callback = await callbackFor({
      email: 'user@other.com',
      sub: 'oidc-subject-2',
      emailVerified: true,
    });
    expect(callback.status).toBe(403);
    expect(callback.body.code).toBe('OIDC_DOMAIN_NOT_ALLOWED');
  });

  it('links an existing local account by verified email', async () => {
    const callback = await callbackFor({
      email: 'local@example.com',
      sub: 'oidc-subject-local',
      emailVerified: true,
    });
    expect(callback.status).toBe(302);

    const sessionCookie = findSessionCookie(callback);
    const me = await http().get('/api/v1/auth/me').set('Cookie', sessionCookie!);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('local@example.com');
  });

  it('requires an explicit verified-email claim before linking or provisioning', async () => {
    const callback = await callbackFor({ email: 'unverified@example.com', sub: 'missing-verification' });
    expect(callback.status).toBe(403);
    expect(callback.body.code).toBe('OIDC_EMAIL_UNVERIFIED');
    expect(findSessionCookie(callback)).toBeUndefined();
  });

  it('keeps a linked account bound to its original subject', async () => {
    const identity = { email: 'bound@example.com', sub: 'original-subject', emailVerified: true };
    expect((await callbackFor(identity)).status).toBe(302);

    const callback = await callbackFor({ ...identity, sub: 'different-subject' });
    expect(callback.status).toBe(403);
    expect(callback.body.code).toBe('OIDC_ACCOUNT_UNAVAILABLE');
    expect(findSessionCookie(callback)).toBeUndefined();
    expect((await callbackFor(identity)).status).toBe(302);
  });

  it('still checks the current email domain after an account is bound', async () => {
    const identity = { email: 'domain@example.com', sub: 'domain-subject', emailVerified: true };
    expect((await callbackFor(identity)).status).toBe(302);

    const callback = await callbackFor({ ...identity, email: 'domain@other.com' });
    expect(callback.status).toBe(403);
    expect(callback.body.code).toBe('OIDC_DOMAIN_NOT_ALLOWED');
    expect(findSessionCookie(callback)).toBeUndefined();
  });

  it('allows only one provider subject to provision an account for an email', async () => {
    const identity = { email: 'concurrent@example.com', emailVerified: true };
    const callbacks = await Promise.all([
      callbackFor({ ...identity, sub: 'first-concurrent-subject' }),
      callbackFor({ ...identity, sub: 'second-concurrent-subject' }),
    ]);
    expect(callbacks.map((callback) => callback.status).sort()).toEqual([302, 403]);
    expect(callbacks.filter(findSessionCookie)).toHaveLength(1);
  });
});
