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
} from '@assetnest/ai';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';
import { configureApp } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { JsonLoggerService } from '../common/logging/json-logger.service.js';
import { AI_TASK_ADAPTER, providerForTask } from './ai-task-executor.service.js';

/**
 * P5 hardening: a failed persistence write of a private invoice/photo draft
 * must never leak the draft body or the failing SQL's bound parameters into
 * logs or the HTTP response. A BEFORE UPDATE trigger forces the ai_jobs write
 * to fail with a message that echoes the draft; we assert the sentinel appears
 * in neither the public error nor the server log.
 */

const migrationsFolder = fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url));
const storageRoot = mkdtempSync(join(tmpdir(), 'assetnest-ai-draft-log-'));
const encryptionKey = Buffer.alloc(32, 7).toString('base64');

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-ai-draft-log',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: encryptionKey,
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: storageRoot,
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'true',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const SENTINEL = 'SENTINEL-DRAFT-SECRET-42-do-not-leak';

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

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let app: INestApplication;
let owner: Session;
let workspaceId: string;
let documentId: string;
const generate = vi.fn<(request: GenerateRequest) => Promise<AIResponse>>();

const fakeAdapter: AIProviderAdapter = {
  id: 'openai',
  async validateConfig() {},
  async discoverModels() {
    return [{ id: 'fake-model', label: 'Fake model' }];
  },
  async capabilities() {
    return unverifiedCapabilities();
  },
  generate: (request) => generate(request),
};
const adapterFactory = vi.fn(() => fakeAdapter) as unknown as typeof providerForTask;

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
    displayName: 'Draft log owner',
    email: 'draft-log-owner@example.com',
    password: 'draft-log-owner-password-1',
  });
  owner = sessionFrom(register);

  const ws = await authenticated(http().post('/api/v1/workspaces'), owner)
    .send({ name: 'Draft Log WS', slug: 'draft-log-ws', mode: 'office' })
    .expect(201);
  workspaceId = ws.body.id as string;

  const asset = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/assets`), owner)
    .send({ assetTag: 'DRAFT-0001', displayName: 'Draft asset', status: 'available' })
    .expect(201);

  const upload = await authenticated(
    http().post(`/api/v1/workspaces/${workspaceId}/assets/${asset.body.id}/documents`),
    owner,
  )
    .field('kind', 'invoice')
    .attach('file', Buffer.from('Invoice 100 — Vendor: Acme\nWidget x1 9.99\n'), {
      filename: 'invoice.txt',
      contentType: 'text/plain',
    })
    .expect(201);
  documentId = upload.body.id as string;

  const connection = await authenticated(
    http().post(`/api/v1/workspaces/${workspaceId}/ai/connections`),
    owner,
  )
    .send({ kind: 'openai', name: 'Draft provider', credential: 'draft-provider-secret-key' })
    .expect(201);

  const model = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/ai/models`), owner)
    .send({ connectionId: connection.body.id, modelId: 'fake-model', label: 'Fake model' })
    .expect(201);

  const [current] = await database
    .select({ updatedAt: schema.aiConnections.updatedAt })
    .from(schema.aiConnections)
    .where(eq(schema.aiConnections.id, connection.body.id as string));
  await database
    .update(schema.aiModels)
    .set({
      capabilities: {
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
      },
      verifiedAt: new Date(),
      verifiedConnectionUpdatedAt: current!.updatedAt,
    })
    .where(eq(schema.aiModels.id, model.body.id as string));

  await database.insert(schema.aiTaskRoutes).values({
    workspaceId,
    task: 'invoice_extraction',
    modelId: model.body.id as string,
    allowProviderData: true,
  });

  // Force every ai_jobs UPDATE to fail, echoing the (private) draft in the error.
  await database.execute(
    sql`create or replace function fail_ai_jobs_update() returns trigger as $fn$ begin raise exception 'forced draft persistence failure: %', coalesce(new.output::text, ''); end $fn$ language plpgsql`,
  );
  await database.execute(
    sql`create trigger fail_ai_jobs_update_trg before update on ai_jobs for each row execute function fail_ai_jobs_update()`,
  );
}, 90_000);

afterAll(async () => {
  try {
    await database?.execute(sql`drop trigger if exists fail_ai_jobs_update_trg on ai_jobs`);
    await database?.execute(sql`drop function if exists fail_ai_jobs_update()`);
  } catch {
    // best-effort cleanup
  }
  await app?.close();
  await client?.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

function serializeLogArg(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

describe('AI draft persistence privacy (e2e)', () => {
  it('keeps the draft and bound parameters out of logs and the public error when the write fails', async () => {
    generate.mockResolvedValueOnce({
      text: JSON.stringify({
        vendor: SENTINEL,
        invoiceNo: null,
        purchaseDate: null,
        currency: 'USD',
        items: [
          {
            name: 'Widget',
            model: null,
            serialNumber: null,
            price: '9.99',
            warrantyEndsOn: null,
            confidence: 0.9,
            evidence: null,
          },
        ],
      }),
      usage: { inputTokens: 10, outputTokens: 8 },
    });

    const errorSpy = vi.spyOn(JsonLoggerService.prototype, 'error');
    let response: request.Response;
    try {
      response = await authenticated(
        http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/extract-invoice`),
        owner,
      ).send({ documentId, consent: true });
    } finally {
      // keep spy results
    }

    // Public error is a sanitized 500 — never the raw provider output.
    expect(response!.status).toBe(500);
    expect(response!.text).not.toContain(SENTINEL);
    expect(response!.text).not.toContain('params:');

    // The server log must not contain the draft or bound SQL parameters either.
    const logged = errorSpy.mock.calls.flatMap((call) => call.map(serializeLogArg)).join('\n');
    expect(logged).not.toContain(SENTINEL);
    expect(logged.toLowerCase()).not.toContain('params:');
    errorSpy.mockRestore();
  });
});
