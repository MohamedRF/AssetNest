import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  AIProviderError,
  type AIProviderAdapter,
  type AIResponse,
  type GenerateRequest,
  type ModelCapabilities,
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
import { AI_TASK_ADAPTER, providerForTask } from './ai-task-executor.service.js';

/**
 * P5-07 completion: deterministic coverage for invoice extraction, photo
 * suggestions, provider fallback, explicit approval, permission denial and a
 * partial (rolled-back) approval. All provider calls are mocked; the invoice
 * and photo are synthetic fixtures.
 */

const migrationsFolder = fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url));
const storageRoot = mkdtempSync(join(tmpdir(), 'assetnest-ai-invoice-'));
const encryptionKey = Buffer.alloc(32, 4).toString('base64');

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-ai-invoice',
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

// Minimal valid PNG (1x1). CRC is not validated by the server's PNG parser; we
// build correct chunk lengths so the parser accepts it.
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}
function buildPng(): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', Buffer.from('fake-image-data')),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const INVOICE_TEXT = 'Invoice 42 — Acme\nWidget x1 9.99\nGadget x2 19.98\n';

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let app: INestApplication;
let owner: Session;
let member: Session;
let workspaceId: string;
let assetId: string;
let invoiceDocId: string;
let photoDocId: string;
let primaryModelId: string;
let fallbackModelId: string;
const generate = vi.fn<(request: GenerateRequest) => Promise<AIResponse>>();

const fakeAdapter: AIProviderAdapter = {
  id: 'openai',
  async validateConfig() {},
  async discoverModels() {
    return [{ id: 'primary-model', label: 'Primary' }];
  },
  async capabilities() {
    return allSupported;
  },
  generate: (request) => generate(request),
};
const adapterFactory = vi.fn(() => fakeAdapter) as unknown as typeof providerForTask;

async function verifyModel(modelId: string) {
  const [connection] = await database
    .select({ updatedAt: schema.aiConnections.updatedAt })
    .from(schema.aiConnections)
    .where(eq(schema.aiConnections.workspaceId, workspaceId));
  await database
    .update(schema.aiModels)
    .set({
      capabilities: allSupported,
      verifiedAt: new Date(),
      verifiedConnectionUpdatedAt: connection!.updatedAt,
    })
    .where(eq(schema.aiModels.id, modelId));
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
    displayName: 'Invoice owner',
    email: 'invoice-owner@example.com',
    password: 'invoice-owner-password-1',
  });
  owner = sessionFrom(register);

  const ws = await authenticated(http().post('/api/v1/workspaces'), owner)
    .send({ name: 'Invoice WS', slug: 'invoice-ws', mode: 'office' })
    .expect(201);
  workspaceId = ws.body.id as string;

  const asset = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/assets`), owner)
    .send({ assetTag: 'SRC-0001', displayName: 'Source asset' })
    .expect(201);
  assetId = asset.body.id as string;

  const invoiceUpload = await authenticated(
    http().post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`),
    owner,
  )
    .field('kind', 'invoice')
    .attach('file', Buffer.from(INVOICE_TEXT), { filename: 'invoice.txt', contentType: 'text/plain' })
    .expect(201);
  invoiceDocId = invoiceUpload.body.id as string;

  const photoUpload = await authenticated(
    http().post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`),
    owner,
  )
    .field('kind', 'photo')
    .attach('file', buildPng(), { filename: 'photo.png', contentType: 'image/png' })
    .expect(201);
  photoDocId = photoUpload.body.id as string;

  const invitation = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/invites`), owner)
    .send({ email: 'invoice-member@example.com', roleKey: 'member' })
    .expect(201);
  const token = new URL(invitation.body.acceptUrl as string).searchParams.get('token');
  await http()
    .post('/api/v1/auth/invites/accept')
    .send({ token, displayName: 'Member', password: 'invoice-member-password-1' });
  member = sessionFrom(
    await http().post('/api/v1/auth/login').send({
      email: 'invoice-member@example.com',
      password: 'invoice-member-password-1',
    }),
  );

  const connection = await authenticated(
    http().post(`/api/v1/workspaces/${workspaceId}/ai/connections`),
    owner,
  )
    .send({ kind: 'openai', name: 'Invoice provider', credential: 'invoice-provider-secret' })
    .expect(201);

  const primary = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/ai/models`), owner)
    .send({ connectionId: connection.body.id, modelId: 'primary-model', label: 'Primary' })
    .expect(201);
  primaryModelId = primary.body.id as string;
  const fallback = await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/ai/models`), owner)
    .send({ connectionId: connection.body.id, modelId: 'fallback-model', label: 'Fallback' })
    .expect(201);
  fallbackModelId = fallback.body.id as string;

  await verifyModel(primaryModelId);
  await verifyModel(fallbackModelId);

  await database.insert(schema.aiTaskRoutes).values([
    {
      workspaceId,
      task: 'invoice_extraction',
      modelId: primaryModelId,
      fallbackModelId,
      allowProviderData: true,
    },
    { workspaceId, task: 'image_tagging', modelId: primaryModelId, allowProviderData: true },
  ]);
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

const invoiceDraft = {
  vendor: 'Acme',
  invoiceNo: '42',
  purchaseDate: '2026-01-01',
  currency: 'USD',
  items: [
    {
      name: 'Widget',
      model: 'W-1',
      serialNumber: 'SN-1',
      price: '9.99',
      warrantyEndsOn: null,
      confidence: 0.9,
      evidence: 'Widget x1 9.99',
    },
    {
      name: 'Gadget',
      model: null,
      serialNumber: null,
      price: '19.98',
      warrantyEndsOn: null,
      confidence: 0.8,
      evidence: 'Gadget x2',
    },
  ],
};

describe('invoice extraction, photo, fallback and approval (e2e)', () => {
  it('extracts an invoice draft from a private text document', async () => {
    generate.mockResolvedValueOnce({
      text: JSON.stringify(invoiceDraft),
      usage: { inputTokens: 20, outputTokens: 30 },
    });
    const res = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/extract-invoice`),
      owner,
    )
      .send({ documentId: invoiceDocId, consent: true })
      .expect(200);
    expect(res.body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.draft.vendor).toBe('Acme');
    expect(res.body.draft.items).toHaveLength(2);
  });

  it('suggests asset details from a private PNG photo', async () => {
    generate.mockResolvedValueOnce({
      text: JSON.stringify({
        category: 'Laptop',
        model: 'Model X',
        visibleSerial: { value: 'SN-9', evidence: 'label' },
        confidence: 0.7,
      }),
      usage: { inputTokens: 10, outputTokens: 12 },
    });
    const res = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/asset-suggestions`),
      owner,
    )
      .send({ documentId: photoDocId, consent: true })
      .expect(200);
    expect(res.body.draft.category).toBe('Laptop');
    expect(res.body.draft.visibleSerial.value).toBe('SN-9');
  });

  it('falls back to the configured fallback model on a transient primary error', async () => {
    generate.mockImplementation(async (req) => {
      if (req.model === 'primary-model') throw new AIProviderError('unavailable');
      return { text: JSON.stringify(invoiceDraft), usage: { inputTokens: 5, outputTokens: 5 } };
    });
    const res = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/extract-invoice`),
      owner,
    ).send({ documentId: invoiceDocId, consent: true });
    const [route] = await database
      .select()
      .from(schema.aiTaskRoutes)
      .where(eq(schema.aiTaskRoutes.task, 'invoice_extraction'));
    const models = generate.mock.calls.map((call) => call[0]?.model);
    expect(
      res.status,
      `calls=${JSON.stringify(models)} routeModel=${route?.modelId} routeFallback=${route?.fallbackModelId}`,
    ).toBe(200);
    expect(res.body.draft.vendor).toBe('Acme');
    // The fallback model actually served the request.
    expect(models).toContain('fallback-model');
    generate.mockReset();
  });

  it('retrieves a stored draft, approves it atomically, and is idempotent on repeat', async () => {
    generate.mockResolvedValueOnce({ text: JSON.stringify(invoiceDraft), usage: null });
    const extracted = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/extract-invoice`),
      owner,
    )
      .send({ documentId: invoiceDocId, consent: true })
      .expect(200);
    const jobId = extracted.body.jobId as string;

    // Retrieve the stored draft for review.
    const fetched = await authenticated(
      http().get(`/api/v1/workspaces/${workspaceId}/ai/tasks/invoice-drafts/${jobId}`),
      owner,
    ).expect(200);
    expect(fetched.body.draft.items).toHaveLength(2);

    const approveBody = {
      jobId,
      assets: [
        {
          assetTag: 'INV-0001',
          displayName: 'Widget',
          serialNumber: 'SN-1',
          amount: '9.99',
          currency: 'USD',
          purchasedAt: '2026-01-01',
        },
        { assetTag: 'INV-0002', displayName: 'Gadget', amount: '19.98', currency: 'USD' },
      ],
    };
    const approved = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/approve-invoice`),
      owner,
    )
      .send(approveBody)
      .expect(200);
    expect(approved.body.alreadyApproved).toBe(false);
    expect(approved.body.assets).toHaveLength(2);

    const assets = await database
      .select({ tag: schema.assets.assetTag })
      .from(schema.assets)
      .where(eq(schema.assets.workspaceId, workspaceId));
    const tags = assets.map((a) => a.tag);
    expect(tags).toContain('INV-0001');
    expect(tags).toContain('INV-0002');

    const approvals = await database
      .select({ assetIds: schema.aiApprovalActions.assetIds })
      .from(schema.aiApprovalActions)
      .where(eq(schema.aiApprovalActions.jobId, jobId));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.assetIds).toHaveLength(2);

    // Repeat approval returns the same result and creates nothing new.
    const again = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/approve-invoice`),
      owner,
    )
      .send({ jobId, assets: [{ assetTag: 'INV-9999', displayName: 'Should not exist' }] })
      .expect(200);
    expect(again.body.alreadyApproved).toBe(true);
    const afterTags = await database
      .select({ tag: schema.assets.assetTag })
      .from(schema.assets)
      .where(eq(schema.assets.workspaceId, workspaceId));
    expect(afterTags.some((a) => a.tag === 'INV-9999')).toBe(false);
  });

  it('denies approval and draft retrieval to a plain member (ai:use / assets:write required)', async () => {
    generate.mockResolvedValue({ text: JSON.stringify(invoiceDraft), usage: null });
    const extracted = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/extract-invoice`),
      owner,
    )
      .send({ documentId: invoiceDocId, consent: true })
      .expect(200);
    const jobId = extracted.body.jobId as string;

    const approve = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/approve-invoice`),
      member,
    ).send({ jobId, assets: [{ assetTag: 'INV-0500', displayName: 'Nope' }] });
    expect(approve.status).toBe(403);

    const draft = await authenticated(
      http().get(`/api/v1/workspaces/${workspaceId}/ai/tasks/invoice-drafts/${jobId}`),
      member,
    );
    expect(draft.status).toBe(403);
  });

  it('rolls back the whole approval on a partial failure (duplicate tag), creating no assets or approval', async () => {
    // Pre-existing tag that will collide inside the approval transaction.
    await authenticated(http().post(`/api/v1/workspaces/${workspaceId}/assets`), owner)
      .send({ assetTag: 'DUP-0001', displayName: 'Already here' })
      .expect(201);

    generate.mockResolvedValueOnce({ text: JSON.stringify(invoiceDraft), usage: null });
    const extracted = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/extract-invoice`),
      owner,
    )
      .send({ documentId: invoiceDocId, consent: true })
      .expect(200);
    const jobId = extracted.body.jobId as string;

    const res = await authenticated(
      http().post(`/api/v1/workspaces/${workspaceId}/ai/tasks/approve-invoice`),
      owner,
    ).send({
      jobId,
      assets: [
        { assetTag: 'INV-0600', displayName: 'Would be first' },
        { assetTag: 'DUP-0001', displayName: 'Collides' },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSET_TAG_EXISTS');

    // No partial writes survived.
    const dupCount = await database.execute<{ count: string }>(
      sql`select count(*)::text as count from assets where workspace_id = ${workspaceId} and asset_tag = 'DUP-0001'`,
    );
    expect(Number(dupCount.rows[0]?.count ?? '0')).toBe(1);
    const invCount = await database.execute<{ count: string }>(
      sql`select count(*)::text as count from assets where workspace_id = ${workspaceId} and asset_tag = 'INV-0600'`,
    );
    expect(Number(invCount.rows[0]?.count ?? '0')).toBe(0);
    const approvals = await database
      .select({ id: schema.aiApprovalActions.id })
      .from(schema.aiApprovalActions)
      .where(eq(schema.aiApprovalActions.jobId, jobId));
    expect(approvals).toHaveLength(0);
  });
});
