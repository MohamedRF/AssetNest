import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  AIProviderError,
  unverifiedCapabilities,
  type AIProviderAdapter,
  type AIResponse,
  type GenerateRequest,
  type ModelCapabilities,
} from '@assetnest/ai';
import { agUiEventSchema, type AgUiEvent } from '@assetnest/contracts';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { AssetsService } from '../assets/assets.service.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';
import { configureApp } from '../bootstrap.js';
import { JsonLoggerService } from '../common/logging/json-logger.service.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { AI_TASK_ADAPTER, type providerForTask } from './ai-task-executor.service.js';

/**
 * AG-UI asset-chat streaming pilot (P5-10 extension).
 *
 * Verifies the SSE endpoint emits a spec-conformant AG-UI lifecycle
 * (RUN_STARTED → optional STEP_* → RUN_FINISHED | RUN_ERROR), that the
 * existing JSON chat contract is unchanged, and that failures after the stream
 * opens and cross-workspace requests terminate safely via RUN_ERROR.
 */

const migrationsFolder = fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url));
const storageRoot = mkdtempSync(join(tmpdir(), 'assetnest-ai-chat-stream-'));
const encryptionKey = Buffer.alloc(32, 7).toString('base64');

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-chat-stream',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: encryptionKey,
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: storageRoot,
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'true',
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

/** A fully capable model so any task can run; individual tests override as needed. */
const allSupported: ModelCapabilities = {
  features: {
    text: 'supported',
    vision: 'supported',
    structured_output: 'supported',
    tool_calling: 'supported',
    embeddings: 'supported',
    streaming: 'supported',
    image_input: 'supported',
    file_input: 'supported',
    token_usage: 'supported',
  },
  contextLimit: 128_000,
};

/** Parse an SSE body into typed AG-UI events (frames separated by a blank line). */
function parseAgUiEvents(body: string): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  for (const frame of body.split('\n\n')) {
    if (frame.trim() === '') continue;
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''));
    if (dataLines.length === 0) continue;
    events.push(agUiEventSchema.parse(JSON.parse(dataLines.join('\n'))));
  }
  return events;
}

/** Assert the run lifecycle is well-formed: one start, one terminal, terminal is last. */
function expectValidLifecycle(events: AgUiEvent[]) {
  expect(events.length).toBeGreaterThan(0);
  expect(events[0]?.type).toBe('RUN_STARTED');
  const terminal = events.filter((e) => e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR');
  expect(terminal).toHaveLength(1);
  expect(events.at(-1)?.type).toBe(terminal[0]?.type);
  // No events after the terminal event.
  expect(events.indexOf(terminal[0]!)).toBe(events.length - 1);
}

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let app: INestApplication;
let owner: Session;
let workspaceId: string;
let assetId: string;
let modelId: string;
let routeKey: string;
const generate = vi.fn<(request: GenerateRequest) => Promise<AIResponse>>();

const fakeAdapter: AIProviderAdapter = {
  id: 'openai',
  async validateConfig() {},
  async discoverModels() {
    return [{ id: 'fake-model', label: 'Fake model' }];
  },
  async capabilities() {
    return allSupported;
  },
  generate: (request) => generate(request),
};
const adapterFactory = vi.fn(() => fakeAdapter) as unknown as typeof providerForTask;

async function seedAssetChatRoute(overrides: Partial<typeof schema.aiTaskRoutes.$inferInsert> = {}) {
  const [existing] = await database
    .select({ task: schema.aiTaskRoutes.task })
    .from(schema.aiTaskRoutes)
    .where(eq(schema.aiTaskRoutes.task, 'asset_chat'));
  if (existing) {
    if (Object.keys(overrides).length > 0) {
      await database
        .update(schema.aiTaskRoutes)
        .set(overrides)
        .where(eq(schema.aiTaskRoutes.task, 'asset_chat'));
    }
    return;
  }
  await database.insert(schema.aiTaskRoutes).values({
    workspaceId,
    task: 'asset_chat',
    modelId,
    allowProviderData: true,
    ...overrides,
  });
}

async function setCapabilities(capabilities: ModelCapabilities) {
  await database.update(schema.aiModels).set({ capabilities }).where(eq(schema.aiModels.id, modelId));
}

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder });
  await seedRoles(database as unknown as Database);

  const config: AppConfig = loadConfig(testEnv);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(DATABASE)
    .useValue(database)
    .overrideProvider(AI_TASK_ADAPTER)
    .useValue(adapterFactory)
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();

  const register = await http().post('/api/v1/auth/register').send({
    displayName: 'Stream owner',
    email: 'stream-owner@example.com',
    password: 'stream-owner-password-example',
  });
  expect(register.status).toBe(201);
  owner = sessionFrom(register);

  const ws = await authenticated(http().post('/api/v1/workspaces'), owner)
    .send({ name: 'Stream WS', slug: 'stream-ws', mode: 'office' })
    .expect(201);
  workspaceId = ws.body.id as string;

  const asset = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/assets`), owner)
    .send({ assetTag: 'STRM-0001', displayName: 'Stream test asset', status: 'available' })
    .expect(201);
  assetId = asset.body.id as string;

  const connection = await authenticated(
    http().post(`/api/v1/workspaces/${workspaceId}/ai/connections`),
    owner,
  )
    .send({ kind: 'openai', name: 'Stream provider', credential: 'stream-provider-secret-key' })
    .expect(201);

  const model = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/ai/models`), owner)
    .send({ connectionId: connection.body.id as string, modelId: 'fake-model', label: 'Fake model' })
    .expect(201);
  modelId = model.body.id as string;

  const [current] = await database
    .select({ updatedAt: schema.aiConnections.updatedAt })
    .from(schema.aiConnections)
    .where(eq(schema.aiConnections.id, connection.body.id as string));
  await database
    .update(schema.aiModels)
    .set({
      capabilities: allSupported,
      verifiedAt: new Date(),
      verifiedConnectionUpdatedAt: current!.updatedAt,
    })
    .where(eq(schema.aiModels.id, modelId));

  await seedAssetChatRoute();
  const preview = await authenticated(
    http().get(`/api/v1/workspaces/${workspaceId}/ai/tasks/asset_chat/preview`),
    owner,
  ).expect(200);
  routeKey = preview.body.routeKey as string;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('AG-UI asset chat stream (e2e)', () => {
  beforeEach(() => {
    generate.mockReset();
  });

  it('requires a session (no token auth for the chat stream)', async () => {
    const anon = await http()
      .post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat/stream`)
      .send({ question: 'status?', assetIds: [assetId], consent: true, routeKey });
    expect(anon.status).toBe(401);
  });

  it('streams a spec-conformant run with progress steps and the validated answer', async () => {
    generate.mockResolvedValueOnce({
      text: JSON.stringify({ answer: 'The asset is available and in good condition.' }),
      usage: { inputTokens: 30, outputTokens: 12 },
    });

    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat/stream`),
      owner,
    )
      .send({ question: 'what is the status?', assetIds: [assetId], consent: true, routeKey })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-store, no-transform');
    const events = parseAgUiEvents(response.text);
    expectValidLifecycle(events);
    expect(events.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'STEP_STARTED',
      'STEP_FINISHED',
      'STEP_STARTED',
      'STEP_FINISHED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);

    // Progress steps are the real phases of the read-only chat.
    const steps = events.filter((e) => e.type === 'STEP_STARTED' || e.type === 'STEP_FINISHED');
    expect(steps.map((e) => (e as { stepName: string }).stepName)).toEqual([
      'retrieve_asset_context',
      'retrieve_asset_context',
      'generate_response',
      'generate_response',
    ]);

    // The answer is delivered as a single validated text chunk.
    const content = events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT');
    expect(content).toHaveLength(1);
    expect((content[0] as { delta: string }).delta).toBe('The asset is available and in good condition.');
    expect((events[0] as { runId: string }).runId).toMatch(/^[0-9a-f-]{36}$/);

    // Only the selected asset's authorized record was sent to the provider.
    const sent = generate.mock.calls.at(-1)?.[0];
    const parsed = JSON.parse(sent?.prompt ?? '{}') as { assets: Array<{ tag: string }> };
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0]?.tag).toBe('STRM-0001');
  });

  it('emits RUN_ERROR (no text) when the provider fails after the stream opened', async () => {
    generate.mockRejectedValueOnce(new AIProviderError('unavailable'));

    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat/stream`),
      owner,
    )
      .send({ question: 'what is the status?', assetIds: [assetId], consent: true, routeKey })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    const events = parseAgUiEvents(response.text);
    expectValidLifecycle(events);
    expect(events.at(-1)?.type).toBe('RUN_ERROR');
    expect(events.some((e) => e.type === 'TEXT_MESSAGE_START')).toBe(false);
    const error = events.at(-1) as { code?: string; message: string };
    expect(error.code).toBe('AI_PROVIDER_UNAVAILABLE');
    // Safe, generic message — no provider internals.
    expect(error.message).toBe('The configured AI provider could not complete this request.');
    expect(response.text).not.toContain('stream-provider-secret-key');
  });

  it('terminates safely and records a structured diagnostic on unexpected failures', async () => {
    const loadAsset = vi
      .spyOn(app.get(AssetsService), 'get')
      .mockRejectedValueOnce(new Error('sensitive details from the database driver'));
    const logError = vi.spyOn(JsonLoggerService.prototype, 'error').mockImplementation(() => undefined);
    try {
      const response = await authenticated(
        http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat/stream`),
        owner,
      )
        .send({ question: 'status?', assetIds: [assetId], consent: true, routeKey })
        .expect(200);

      const events = parseAgUiEvents(response.text);
      expectValidLifecycle(events);
      expect(events.at(-1)).toMatchObject({
        type: 'RUN_ERROR',
        code: 'AI_STREAM_ERROR',
        message: 'The AI request could not be completed.',
      });
      expect(response.text).not.toContain('sensitive details');
      expect(logError).toHaveBeenCalledWith('Unexpected asset chat stream failure', {
        code: 'AI_STREAM_ERROR',
      });
      expect(generate).not.toHaveBeenCalled();
    } finally {
      loadAsset.mockRestore();
      logError.mockRestore();
    }
  });

  it('terminates with RUN_ERROR for an asset outside the workspace (no cross-tenant leak)', async () => {
    const other = await authenticated(http().post('/api/v1/workspaces'), owner)
      .send({ name: 'Foreign WS', slug: 'foreign-stream-ws', mode: 'office' })
      .expect(201);
    await authenticated(http().post(`/api/v1/workspaces/${other.body.id as string}/assets`), owner)
      .send({ assetTag: 'FORG-0001', displayName: 'Foreign asset' })
      .expect(201);
    const [foreign] = await database
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(eq(schema.assets.assetTag, 'FORG-0001'));

    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat/stream`),
      owner,
    )
      .send({ question: 'status?', assetIds: [foreign!.id], consent: true, routeKey })
      .expect(200);

    const events = parseAgUiEvents(response.text);
    expectValidLifecycle(events);
    expect(events.at(-1)?.type).toBe('RUN_ERROR');
    expect((events.at(-1) as { code?: string }).code).toBe('ASSET_NOT_FOUND');
    // The provider was never called for a cross-tenant asset.
    expect(response.text).not.toContain('FORG-0001');
    expect(generate).not.toHaveBeenCalled();
  });

  it('refuses the stream when the model lacks the required capability', async () => {
    await setCapabilities(unverifiedCapabilities());
    try {
      const response = await authenticated(
        http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat/stream`),
        owner,
      )
        .send({ question: 'anything', assetIds: [assetId], consent: true, routeKey })
        .expect(200);
      const events = parseAgUiEvents(response.text);
      expect(events.at(-1)?.type).toBe('RUN_ERROR');
      expect((events.at(-1) as { code?: string }).code).toBe('AI_MODEL_UNAVAILABLE');
    } finally {
      await setCapabilities(allSupported);
    }
  });

  it('keeps the existing JSON chat contract working', async () => {
    generate.mockResolvedValueOnce({
      text: JSON.stringify({ answer: 'The JSON chat answer.' }),
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat`),
      owner,
    )
      .send({ question: 'status?', assetIds: [assetId], consent: true })
      .expect(200);
    expect(response.body.draft.answer).toBe('The JSON chat answer.');
    expect(response.body.jobId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('requires explicit consent for the stream', async () => {
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat/stream`),
      owner,
    )
      .send({ question: 'anything', assetIds: [assetId], consent: false, routeKey })
      .expect(200);
    const events = parseAgUiEvents(response.text);
    expect(events.at(-1)?.type).toBe('RUN_ERROR');
    expect((events.at(-1) as { code?: string }).code).toBe('AI_CONSENT_REQUIRED');
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects a missing provider route key before opening the stream', async () => {
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat/stream`),
      owner,
    )
      .send({ question: 'status?', assetIds: [assetId], consent: true })
      .expect(400);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.detail).toContain('routeKey');
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects a stale provider route key without forwarding asset data', async () => {
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat/stream`),
      owner,
    )
      .send({ question: 'status?', assetIds: [assetId], consent: true, routeKey: 'old-route-key' })
      .expect(200);

    const events = parseAgUiEvents(response.text);
    expectValidLifecycle(events);
    expect(events.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'AI_ROUTE_CHANGED' });
    expect(generate).not.toHaveBeenCalled();
  });
});
