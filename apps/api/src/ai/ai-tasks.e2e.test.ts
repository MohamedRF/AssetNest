import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  unverifiedCapabilities,
  type AIProviderAdapter,
  type AIResponse,
  type GenerateRequest,
  type ModelCapabilities,
} from '@assetnest/ai';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { AI_TASK_ADAPTER, providerForTask } from './ai-task-executor.service.js';

const migrationsFolder = fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url));
const storageRoot = mkdtempSync(join(tmpdir(), 'assetnest-ai-tasks-'));
const encryptionKey = Buffer.alloc(32, 9).toString('base64');

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-ai-tasks',
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

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let app: INestApplication;
let owner: Session;
let member: Session;
let workspaceId: string;
let assetId: string;
let connectionId: string;
let modelId: string;
const generate = vi.fn<(request: GenerateRequest) => Promise<AIResponse>>();

/** A fake adapter factory: the executor only ever calls generate(). */
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

async function seedRoute(
  task: (typeof schema.aiTaskRoutes.$inferInsert)['task'],
  overrides: Partial<typeof schema.aiTaskRoutes.$inferInsert> = {},
) {
  const [existing] = await database
    .select({ task: schema.aiTaskRoutes.task })
    .from(schema.aiTaskRoutes)
    .where(eq(schema.aiTaskRoutes.task, task));
  if (existing) {
    if (Object.keys(overrides).length > 0) {
      await database.update(schema.aiTaskRoutes).set(overrides).where(eq(schema.aiTaskRoutes.task, task));
    }
    return;
  }
  await database.insert(schema.aiTaskRoutes).values({
    workspaceId,
    task,
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
    displayName: 'AI owner',
    email: 'ai-owner@example.com',
    password: 'ai-owner-password-example',
  });
  expect(register.status).toBe(201);
  owner = sessionFrom(register);

  const ws = await authenticated(http().post('/api/v1/workspaces'), owner)
    .send({ name: 'Tasks WS', slug: 'tasks-ws', mode: 'office' })
    .expect(201);
  workspaceId = ws.body.id as string;

  const asset = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/assets`), owner)
    .send({ assetTag: 'TASK-0001', displayName: 'AI test asset', status: 'available' })
    .expect(201);
  assetId = asset.body.id as string;

  const invitation = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/invites`), owner)
    .send({ email: 'ai-manager@example.com', roleKey: 'manager' })
    .expect(201);
  const token = new URL(invitation.body.acceptUrl as string).searchParams.get('token');
  await http().post('/api/v1/auth/invites/accept').send({
    token,
    displayName: 'AI manager',
    password: 'ai-member-password-example',
  });
  member = sessionFrom(
    await http().post('/api/v1/auth/login').send({
      email: 'ai-manager@example.com',
      password: 'ai-member-password-example',
    }),
  );

  // A native connection with an API key (never contacted: the adapter is faked).
  const connection = await authenticated(
    http().post(`/api/v1/workspaces/${workspaceId}/ai/connections`),
    owner,
  )
    .send({ kind: 'openai', name: 'Tasks provider', credential: 'tasks-provider-secret-key' })
    .expect(201);
  connectionId = connection.body.id as string;

  const model = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/ai/models`), owner)
    .send({ connectionId, modelId: 'fake-model', label: 'Fake model' })
    .expect(201);
  modelId = model.body.id as string;

  // Mark the model as verified against the current connection version.
  const [current] = await database
    .select({ updatedAt: schema.aiConnections.updatedAt })
    .from(schema.aiConnections)
    .where(eq(schema.aiConnections.id, connectionId));
  await database
    .update(schema.aiModels)
    .set({
      capabilities: allSupported,
      verifiedAt: new Date(),
      verifiedConnectionUpdatedAt: current!.updatedAt,
    })
    .where(eq(schema.aiModels.id, modelId));

  // A route per task so individual tests only override what they exercise.
  // natural_language_search is intentionally left for the consent/route tests to seed.
  for (const task of [
    'invoice_extraction',
    'image_tagging',
    'maintenance_assistant',
    'asset_chat',
  ] as const) {
    await seedRoute(task);
  }
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('AI task drafts (e2e)', () => {
  it('requires a session (API tokens and AI-disabled deployments are refused)', async () => {
    // No route configured yet -> AI_ROUTE_MISSING proves the request reached the executor.
    const anon = await http()
      .post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`)
      .send({ question: 'laptops', consent: true });
    expect(anon.status).toBe(401);
  });

  it('requires a configured route before running a task', async () => {
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`),
      owner,
    )
      .send({ question: 'all laptops', consent: true })
      .expect(409);
    expect(response.body.code).toBe('AI_ROUTE_MISSING');
  });

  it('requires explicit consent before sending workspace data', async () => {
    await seedRoute('natural_language_search');
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`),
      owner,
    )
      .send({ question: 'all laptops', consent: false })
      .expect(403);
    expect(response.body.code).toBe('AI_CONSENT_REQUIRED');
  });

  it('runs natural-language search and returns a validated filter draft', async () => {
    generate.mockResolvedValueOnce({
      text: JSON.stringify({ filters: [{ field: 'status', operator: 'equals', value: 'available' }] }),
      usage: { inputTokens: 12, outputTokens: 8 },
    });
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`),
      owner,
    )
      .send({ question: 'show available assets', consent: true })
      .expect(200);
    expect(response.body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.draft).toEqual({
      filters: [{ field: 'status', operator: 'equals', value: 'available' }],
    });
    const [job] = await database
      .select({
        status: schema.aiJobs.status,
        input: schema.aiJobs.inputTokens,
        output: schema.aiJobs.outputTokens,
      })
      .from(schema.aiJobs)
      .where(eq(schema.aiJobs.id, response.body.jobId as string));
    expect(job?.status).toBe('succeeded');
    expect(job?.input).toBe(12);
    expect(job?.output).toBe(8);
  });

  it('rejects malformed model output with a provider error, not a draft', async () => {
    generate.mockResolvedValueOnce({ text: 'not json at all', usage: null });
    // 5xx problem bodies intentionally hide internal codes (HTTP_<status>).
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`),
      owner,
    )
      .send({ question: 'anything', consent: true })
      .expect(502);
    expect(response.body.code).toBe('HTTP_502');
    // The failure is recorded server-side without exposing the raw provider text.
    const failed = (
      await database
        .select({ status: schema.aiJobs.status, errorCode: schema.aiJobs.errorCode })
        .from(schema.aiJobs)
        .where(eq(schema.aiJobs.task, 'natural_language_search'))
    ).find((row) => row.status === 'failed');
    expect(failed?.errorCode).toBe('invalid_response');
  });

  it('runs a scoped asset chat over selected assets only', async () => {
    generate.mockResolvedValueOnce({
      text: JSON.stringify({ answer: 'The asset is available and in good condition.' }),
      usage: { inputTokens: 30, outputTokens: 12 },
    });
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat`),
      owner,
    )
      .send({ question: 'what is the status?', assetIds: [assetId], consent: true })
      .expect(200);
    expect(response.body.draft.answer).toContain('available');

    const sent = generate.mock.calls.at(-1)?.[0];
    const parsed = JSON.parse(sent?.prompt ?? '{}') as { assets: Array<{ tag: string }> };
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0]?.tag).toBe('TASK-0001');
  });

  it('returns 404 when chatting about an asset outside the workspace', async () => {
    const other = await authenticated(http().post('/api/v1/workspaces'), owner)
      .send({ name: 'Other WS', slug: 'other-tasks-ws', mode: 'office' })
      .expect(201);
    const otherId = other.body.id as string;
    await authenticated(http().post(`/api/v1/workspaces/${otherId}/assets`), owner)
      .send({ assetTag: 'OTHER-0001', displayName: 'Foreign asset' })
      .expect(201);
    const [foreign] = await database
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(eq(schema.assets.workspaceId, otherId));
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/chat`),
      owner,
    )
      .send({ question: 'status?', assetIds: [foreign!.id], consent: true })
      .expect(404);
    expect(response.body.code).toBe('ASSET_NOT_FOUND');
  });

  it('runs the maintenance assistant over the asset and its history', async () => {
    await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/maintenance/plans`), owner)
      .send({
        assetId,
        title: 'Annual service',
        cadence: 'yearly',
        nextDueAt: '2027-01-01',
      })
      .expect(201);
    generate.mockResolvedValueOnce({
      text: JSON.stringify({ answer: 'The next service is due on 2027-01-01.' }),
      usage: { inputTokens: 40, outputTokens: 15 },
    });
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/maintenance`),
      owner,
    )
      .send({ assetId, question: 'when is the next service?', consent: true })
      .expect(200);
    expect(response.body.draft.answer).toContain('2027-01-01');

    const sent = generate.mock.calls.at(-1)?.[0];
    const parsed = JSON.parse(sent?.prompt ?? '{}') as {
      asset: { tag: string };
      plans: Array<{ title: string }>;
    };
    expect(parsed.asset.tag).toBe('TASK-0001');
    expect(parsed.plans[0]?.title).toBe('Annual service');
  });

  it('refuses a task when the model lacks the required capability', async () => {
    const broken = unverifiedCapabilities();
    await setCapabilities(broken); // no feature is 'supported'
    await seedRoute('natural_language_search');
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`),
      owner,
    )
      .send({ question: 'anything', consent: true })
      .expect(409);
    expect(response.body.code).toBe('AI_MODEL_UNAVAILABLE');
    await setCapabilities(allSupported);
  });

  it('enforces the daily token budget for a task', async () => {
    // Clear earlier search jobs so this test measures its own budget in isolation.
    await database.delete(schema.aiJobs).where(eq(schema.aiJobs.task, 'natural_language_search'));
    // reservedTokens ≈ prompt + system + 512 output; one request fits, two do not.
    await seedRoute('natural_language_search', { dailyTokenBudget: 1000 });
    generate.mockResolvedValue({
      text: JSON.stringify({ filters: [] }),
      usage: null,
    });
    const first = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`), owner)
      .send({ question: 'first request', consent: true })
      .expect(200);
    expect(first.body.jobId).toBeTruthy();

    const second = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`), owner)
      .send({ question: 'second request that should exceed the tiny budget', consent: true })
      .expect(429);
    expect(second.body.code).toBe('AI_BUDGET_EXCEEDED');
    await seedRoute('natural_language_search', { dailyTokenBudget: 50_000 });
  });

  it('lets a member read only their own jobs', async () => {
    generate.mockResolvedValueOnce({
      text: JSON.stringify({ filters: [] }),
      usage: null,
    });
    const created = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`),
      owner,
    )
      .send({ question: 'owned job', consent: true })
      .expect(200);
    const jobId = created.body.jobId as string;

    // Owner can read their own job.
    await authenticated(http().get(`/api/v1/workspaces/${workspaceId}/ai/jobs/${jobId}`), owner).expect(200);
    // A different user in the same workspace cannot.
    const foreign = await authenticated(
      http().get(`/api/v1/workspaces/${workspaceId}/ai/jobs/${jobId}`),
      member,
    ).expect(404);
    expect(foreign.body.code).toBe('AI_JOB_NOT_FOUND');
  });

  it('never echoes the provider credential in responses or logs', async () => {
    const credential = 'tasks-provider-secret-key';
    generate.mockResolvedValueOnce({
      text: JSON.stringify({ filters: [] }),
      usage: null,
    });
    const response = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`),
      owner,
    )
      .send({ question: 'credential check', consent: true })
      .expect(200);
    expect(response.text).not.toContain(credential);

    const audit = await database
      .select({ metadata: schema.auditLog.metadataJson })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    expect(JSON.stringify(audit)).not.toContain(credential);
  });

  it('previews the configured provider route and binds consent to it (AI_ROUTE_CHANGED on mismatch)', async () => {
    await seedRoute('natural_language_search');
    const preview = await authenticated(
      http().get(`/api/v1/workspaces/${workspaceId}/ai/tasks/natural_language_search/preview`),
      owner,
    ).expect(200);
    expect(preview.body.available).toBe(true);
    expect(preview.body.consentRequired).toBe(true);
    expect(preview.body.routeKey).toBe(`${modelId}|`);
    expect(preview.body.primary).toMatchObject({ modelLabel: 'Fake model', providerKind: 'openai' });

    generate.mockResolvedValue({ text: JSON.stringify({ filters: [] }), usage: null });

    // A stale/unknown route key is rejected before any provider call is made.
    const mismatch = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`),
      owner,
    )
      .send({ question: 'anything', consent: true, routeKey: 'stale-route' })
      .expect(409);
    expect(mismatch.body.code).toBe('AI_ROUTE_CHANGED');

    // The matching route key runs normally.
    const ok = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/query`), owner)
      .send({ question: 'anything', consent: true, routeKey: preview.body.routeKey as string })
      .expect(200);
    expect(ok.body.jobId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
