import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { loadConfig, type AppConfig } from '@assetnest/config';
import type { Database } from '@assetnest/db';
import { OidcService } from './oidc.service.js';

let server: Server;
let issuer: string;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwk: JWK;

const CLIENT_ID = 'assetnest-client';
const BASIC_CLIENT_ID = 'client :id';
const CLIENT_SECRET = 'secret: with spaces+';

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

async function signToken(claims: Record<string, unknown>, nonce: string): Promise<string> {
  return new SignJWT({ email: 'user@example.com', email_verified: true, name: 'Test User', ...claims, nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(CLIENT_ID)
    .setSubject('subject-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .setJti('token-1')
    .sign(privateKey);
}

function config(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_APP_URL: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://unit/oidc',
    SESSION_SECRET: 'unit-secret-that-is-long-enough-000000000000',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    OIDC_ENABLED: 'true',
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_REDIRECT_URI: 'http://localhost:5173/api/v1/auth/oidc/callback',
    ...overrides,
  });
}

beforeAll(async () => {
  const generated = await generateKeyPair('RS256');
  privateKey = generated.privateKey;
  jwk = { ...(await exportJWK(generated.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/.well-known/openid-configuration') {
      json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/login/authorize?realm=test`,
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
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const params = new URLSearchParams(body);
      const code = params.get('code');
      const expectedBasic = Buffer.from('client+%3Aid:secret%3A+with+spaces%2B').toString('base64');
      const credentialsMatch =
        code === 'basic'
          ? req.headers.authorization === `Basic ${expectedBasic}` &&
            !params.has('client_id') &&
            !params.has('client_secret')
          : !req.headers.authorization &&
            params.get('client_id') === CLIENT_ID &&
            params.get('client_secret') === (code === 'post' ? CLIENT_SECRET : null);
      if (params.get('grant_type') !== 'authorization_code' || !credentialsMatch) {
        json(res, 400, { error: 'invalid_client' });
        return;
      }
      json(res, 200, { id_token: 'test-token' });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  issuer = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('OIDC service', () => {
  const service = (overrides?: NodeJS.ProcessEnv) => new OidcService({} as Database, config(overrides));

  it('uses the discovered authorization URL and preserves its query parameters', async () => {
    const request = await service().buildAuthorizationUrl();
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe(`${issuer}/login/authorize`);
    expect(url.searchParams.get('realm')).toBe('test');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(request.state);
    expect(url.searchParams.get('nonce')).toBe(request.nonce);
    expect(request.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('rejects provider metadata for a different issuer', async () => {
    await expect(service({ OIDC_ISSUER: `${issuer}/` }).buildAuthorizationUrl()).rejects.toMatchObject({
      status: 502,
      response: { code: 'OIDC_DISCOVERY_INVALID' },
    });
  });

  it.each([
    ['public', {}],
    ['post', { OIDC_CLIENT_SECRET: CLIENT_SECRET, OIDC_CLIENT_AUTH_METHOD: 'client_secret_post' }],
    [
      'basic',
      {
        OIDC_CLIENT_ID: BASIC_CLIENT_ID,
        OIDC_CLIENT_SECRET: CLIENT_SECRET,
        OIDC_CLIENT_AUTH_METHOD: 'client_secret_basic',
      },
    ],
  ])('exchanges the authorization code using %s client credentials', async (mode, overrides) => {
    await expect(service(overrides).exchangeCode(mode, 'test-verifier')).resolves.toBe('test-token');
  });

  it('verifies a valid id_token and returns claims', async () => {
    const request = await service().buildAuthorizationUrl();
    const token = await signToken({}, request.nonce);
    const claims = await service().verifyIdToken(token, request.nonce);
    expect(claims.sub).toBe('subject-1');
    expect(claims.email).toBe('user@example.com');
  });

  it('rejects a nonce mismatch', async () => {
    const request = await service().buildAuthorizationUrl();
    const token = await signToken({}, 'different-nonce');
    await expect(service().verifyIdToken(token, request.nonce)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects an expired token', async () => {
    const request = await service().buildAuthorizationUrl();
    const token = await new SignJWT({ nonce: request.nonce, email: 'user@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setSubject('subject-1')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 600)
      .sign(privateKey);
    await expect(service().verifyIdToken(token, request.nonce)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects a signed token without an expiration', async () => {
    const nonce = 'expiry-test';
    const token = await new SignJWT({ nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setSubject('subject-1')
      .setIssuedAt()
      .sign(privateKey);
    await expect(service().verifyIdToken(token, nonce)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a signed token with an additional untrusted audience', async () => {
    const nonce = 'audience-test';
    const token = await new SignJWT({ nonce, azp: CLIENT_ID })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience([CLIENT_ID, 'another-client'])
      .setSubject('subject-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    await expect(service().verifyIdToken(token, nonce)).rejects.toMatchObject({ status: 401 });
  });
});
