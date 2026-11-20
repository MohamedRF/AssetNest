import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AIProviderError, type ProviderTransport } from '@assetnest/ai';
import { loadConfig } from '@assetnest/config';
import { decryptSecret, seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { AI_PROVIDER_TRANSPORT } from './ai-connection-diagnostics.service.js';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const environment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-ai',
  SESSION_SECRET: 'test-only-ai-session-secret-more-than-32-characters',
  ENCRYPTION_KEY: encryptionKey,
};

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

function connections(workspaceId: string, connectionId?: string) {
  const path = `/api/v1/workspaces/${workspaceId}/ai/connections`;
  return connectionId ? `${path}/${connectionId}` : path;
}

describe('AI workspace connections', () => {
  let postgres: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let enabledApp: INestApplication;
  let disabledApp: INestApplication;
  let owner: Session;
  let member: Session;
  let workspaceId: string;
  let otherWorkspaceId: string;
  const providerRequest = vi.fn<ProviderTransport['request']>();
  const buildProviderTransport = vi.fn(() => ({ request: providerRequest }));

  const http = () => request(enabledApp.getHttpServer());

  async function appFor(enableAi: boolean) {
    const config = loadConfig({ ...environment, AI_ENABLED: String(enableAi) });
    const appModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(DATABASE)
      .useValue(database)
      .overrideProvider(AI_PROVIDER_TRANSPORT)
      .useValue(buildProviderTransport)
      .compile();
    const app = appModule.createNestApplication();
    configureApp(app, config);
    await app.init();
    return app;
  }

  beforeAll(async () => {
    postgres = new PGlite();
    database = drizzle(postgres, { schema });
    const migrationsFolder = fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url));
    await migrate(database, { migrationsFolder });
    await seedRoles(database as unknown as Database);

    enabledApp = await appFor(true);
    disabledApp = await appFor(false);

    const register = await http().post('/api/v1/auth/register').send({
      displayName: 'AI owner',
      email: 'ai-owner@example.com',
      password: 'ai-owner-password-example',
    });
    expect(register.status).toBe(201);
    owner = sessionFrom(register);

    const first = await authenticated(http().post('/api/v1/workspaces'), owner)
      .send({ name: 'AI workspace', slug: 'ai-workspace', mode: 'office' })
      .expect(201);
    workspaceId = first.body.id as string;

    const second = await authenticated(http().post('/api/v1/workspaces'), owner)
      .send({ name: 'Other workspace', slug: 'other-ai-workspace', mode: 'office' })
      .expect(201);
    otherWorkspaceId = second.body.id as string;

    const invitation = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/invites`), owner)
      .send({ email: 'ai-member@example.com', roleKey: 'member' })
      .expect(201);
    const token = new URL(invitation.body.acceptUrl as string).searchParams.get('token');
    await http().post('/api/v1/auth/invites/accept').send({
      token,
      displayName: 'AI member',
      password: 'ai-member-password-example',
    });
    const login = await http().post('/api/v1/auth/login').send({
      email: 'ai-member@example.com',
      password: 'ai-member-password-example',
    });
    expect(login.status).toBe(200);
    member = sessionFrom(login);
  }, 90_000);

  afterAll(async () => {
    await disabledApp?.close();
    await enabledApp?.close();
    await postgres?.close();
  });

  it('returns 404 with AI disabled and keeps core routes accessible', async () => {
    const disabled = request(disabledApp.getHttpServer());
    const response = await authenticated(disabled.get(connections(workspaceId)), owner).expect(404);
    expect(response.body.code).toBe('AI_DISABLED');
    await authenticated(disabled.get(`/api/v1/workspaces/${workspaceId}`), owner).expect(200);
  });

  it('requires ai:configure and enforces membership and CSRF', async () => {
    await http().get(connections(workspaceId)).expect(401);
    await authenticated(http().get(connections(workspaceId)), member).expect(403);
    await authenticated(http().get(connections(otherWorkspaceId)), member).expect(404);
    await http()
      .post(connections(workspaceId))
      .set('Cookie', owner.cookie)
      .send({ kind: 'openai', name: 'No CSRF' })
      .expect(403);
  });

  it('encrypts provider keys and never returns plaintext or ciphertext', async () => {
    const credential = 'test-native-credential-do-not-echo';
    const created = await authenticated(http().post(connections(workspaceId)), owner)
      .send({ kind: 'openai', name: 'Native provider', credential })
      .expect(201);
    const connectionId = created.body.id as string;
    expect(created.body).toMatchObject({
      kind: 'openai',
      endpoint: null,
      hasCredential: true,
      enabled: true,
    });
    expect(created.text).not.toContain(credential);
    expect(created.body).not.toHaveProperty('encryptedCredential');

    const [stored] = await database
      .select({
        ciphertext: schema.aiConnections.encryptedCredential,
        mode: schema.aiConnections.credentialMode,
      })
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, connectionId));
    expect(stored?.mode).toBe('api_key');
    expect(stored?.ciphertext).toMatch(/^v1:/);
    const ciphertext = stored?.ciphertext;
    if (!ciphertext) throw new Error('Expected encrypted credential');
    expect(decryptSecret(ciphertext, encryptionKey)).toBe(credential);
    expect(created.text).not.toContain(ciphertext);

    const list = await authenticated(http().get(connections(workspaceId)), owner).expect(200);
    expect(list.body.connections).toContainEqual(
      expect.objectContaining({ id: connectionId, hasCredential: true }),
    );
    expect(list.text).not.toContain(credential);
    expect(list.text).not.toContain(ciphertext);

    await authenticated(http().patch(connections(otherWorkspaceId, connectionId)), owner)
      .send({ enabled: false })
      .expect(404);
    await authenticated(http().delete(connections(otherWorkspaceId, connectionId)), owner).expect(404);
    await authenticated(http().patch(connections(workspaceId, connectionId)), owner)
      .send({ credential: null })
      .expect(400);

    const removed = await authenticated(http().delete(connections(workspaceId, connectionId)), owner).expect(
      204,
    );
    expect(removed.text).toBe('');
    const audit = await database
      .select({ action: schema.auditLog.action, metadata: schema.auditLog.metadataJson })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.resourceId, connectionId));
    expect(audit.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['ai_connection.created', 'ai_connection.deleted']),
    );
    expect(JSON.stringify(audit)).not.toContain(credential);
    expect(JSON.stringify(audit)).not.toContain(ciphertext);
  });

  it('requires explicit credential replacement or removal when endpoints change', async () => {
    const created = await authenticated(http().post(connections(workspaceId)), owner)
      .send({
        kind: 'openai_compatible',
        name: 'Compatible provider',
        endpoint: 'https://93.184.216.34/v1',
        credential: 'test-compatible-credential',
      })
      .expect(201);
    const path = connections(workspaceId, created.body.id as string);

    const blocked = await authenticated(http().patch(path), owner)
      .send({ endpoint: 'https://93.184.216.35/v1' })
      .expect(400);
    expect(blocked.body.code).toBe('AI_CREDENTIAL_REPLACEMENT_REQUIRED');

    const retained = await authenticated(http().patch(path), owner).send({ enabled: false }).expect(200);
    expect(retained.body).toMatchObject({ hasCredential: true, enabled: false });

    const replacement = 'test-rotated-compatible-credential';
    const rotated = await authenticated(http().patch(path), owner)
      .send({ endpoint: 'https://93.184.216.35/v1', credential: replacement })
      .expect(200);
    expect(rotated.body).toMatchObject({ endpoint: 'https://93.184.216.35/v1', hasCredential: true });
    expect(rotated.text).not.toContain(replacement);
    const [stored] = await database
      .select({ ciphertext: schema.aiConnections.encryptedCredential })
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, created.body.id as string));
    if (!stored?.ciphertext) throw new Error('Expected rotated encrypted credential');
    expect(decryptSecret(stored.ciphertext, encryptionKey)).toBe(replacement);

    const cleared = await authenticated(http().patch(path), owner)
      .send({ endpoint: 'https://93.184.216.36/v1', credential: null })
      .expect(200);
    expect(cleared.body).toMatchObject({ endpoint: 'https://93.184.216.36/v1', hasCredential: false });
  });

  it('rejects duplicate connection names within a workspace', async () => {
    const endpoint = 'https://93.184.216.34/v1';
    const input = { kind: 'openai_compatible', name: 'Duplicate provider', endpoint };
    await authenticated(http().post(connections(workspaceId)), owner)
      .send(input)
      .expect(201);
    const conflict = await authenticated(http().post(connections(workspaceId)), owner)
      .send(input)
      .expect(409);
    expect(conflict.body.code).toBe('AI_CONNECTION_NAME_EXISTS');
    await authenticated(http().post(connections(otherWorkspaceId)), owner)
      .send(input)
      .expect(201);
  });

  it('rejects unsafe endpoints and invalid provider configurations before writes', async () => {
    const endpoint = 'https://secret-user:secret-password@93.184.216.34/v1';
    for (const body of [
      { kind: 'openai_compatible', name: 'Embedded credentials', endpoint },
      { kind: 'ollama', name: 'Unconfigured private origin', endpoint: 'http://127.0.0.1:11434/' },
      { kind: 'openai_compatible', name: 'Missing endpoint' },
      { kind: 'openai', name: 'Missing native credential' },
    ]) {
      const rejected = await authenticated(http().post(connections(workspaceId)), owner)
        .send(body)
        .expect(400);
      expect(rejected.text).not.toContain('secret-password');
    }
    const rows = await database
      .select({ name: schema.aiConnections.name })
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.workspaceId, workspaceId));
    expect(rows.map(({ name }) => name)).not.toContain('Embedded credentials');
  });

  it('lists provider models without generation, redacts echoes, and audits diagnostic results', async () => {
    const credential = 'test-only-diagnostics-credential';
    const created = await authenticated(http().post(connections(workspaceId)), owner)
      .send({ kind: 'openai', name: 'Diagnostic provider', credential })
      .expect(201);
    const id = created.body.id as string;
    const path = `${connections(workspaceId, id)}/test`;
    providerRequest.mockResolvedValueOnce({
      data: [{ id: credential }, ...Array.from({ length: 105 }, (_, i) => ({ id: `model-${i}` }))],
    });

    const tested = await authenticated(http().post(path), owner).expect(200);
    expect(tested.body.models).toHaveLength(100);
    expect(tested.body.models[0]).toEqual({ id: 'model-0', label: 'model-0' });
    expect(tested.text).not.toContain(credential);
    expect(buildProviderTransport).toHaveBeenLastCalledWith('openai', null, credential, []);
    expect(providerRequest).toHaveBeenLastCalledWith({
      path: '/models',
      method: 'GET',
      signal: expect.any(AbortSignal),
    });

    providerRequest.mockRejectedValueOnce(new AIProviderError('invalid_credentials'));
    const rejected = await authenticated(http().post(path), owner).expect(422);
    expect(rejected.body.code).toBe('AI_PROVIDER_INVALID_CREDENTIALS');

    const audit = await database
      .select({ metadata: schema.auditLog.metadataJson })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.resourceId, id), eq(schema.auditLog.action, 'ai_connection.tested')));
    expect(audit).toEqual(
      expect.arrayContaining([
        { metadata: expect.objectContaining({ modelCount: 100 }) },
        { metadata: expect.objectContaining({ code: 'invalid_credentials' }) },
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain(credential);
  });

  it('prevents API tokens, disabled connections and other workspaces from contacting providers', async () => {
    const created = await authenticated(http().post(connections(workspaceId)), owner)
      .send({
        kind: 'openai',
        name: 'Disabled diagnostic provider',
        credential: 'test-disabled-provider-key',
        enabled: false,
      })
      .expect(201);
    const id = created.body.id as string;
    const path = `${connections(workspaceId, id)}/test`;
    const token = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/api-tokens`), owner)
      .send({ name: 'AI automation', scopes: ['ai:configure'] })
      .expect(201);
    const called = providerRequest.mock.calls.length;

    const denied = await http()
      .post(path)
      .set('Authorization', `Bearer ${token.body.token as string}`)
      .expect(403);
    expect(denied.body.code).toBe('AI_CONNECTION_TEST_SESSION_REQUIRED');

    const disabled = await authenticated(http().post(path), owner).expect(409);
    expect(disabled.body.code).toBe('AI_CONNECTION_DISABLED');
    await authenticated(http().post(`${connections(otherWorkspaceId, id)}/test`), owner).expect(404);
    await authenticated(request(disabledApp.getHttpServer()).post(path), owner).expect(404);
    expect(providerRequest.mock.calls).toHaveLength(called);
  });
});
