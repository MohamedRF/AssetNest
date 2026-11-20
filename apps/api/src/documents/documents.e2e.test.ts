import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { seedRoles, type Database } from '@assetnest/db';
import * as schema from '@assetnest/db/schema';
import { AppModule } from '../app.module.js';
import { configureApp, createOpenApiDocument } from '../bootstrap.js';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { SESSION_COOKIE } from '../auth/auth.constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../../../packages/db/migrations');

let client: PGlite;
let app: INestApplication;
const storageRoot = mkdtempSync(join(tmpdir(), 'assetnest-docs-'));

function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function sessionCookieOf(res: { headers: Record<string, unknown> }): string {
  const cookie = asStringArray(res.headers['set-cookie'] as string | string[] | undefined).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  );
  if (!cookie) throw new Error('expected a session cookie to be set');
  return cookie.split(';')[0]!;
}

const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://pglite-embedded/assetnest-e2e-docs',
  SESSION_SECRET: 'e2e-secret-that-is-long-enough-to-be-safe-000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: storageRoot,
  MAIL_TRANSPORT: 'log',
  AI_ENABLED: 'false',
  MCP_ENABLED: 'false',
  WEBHOOKS_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const http = () => request(app.getHttpServer());

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
]);
const TEXT_BYTES = Buffer.from('hello assetnest document retention policy\nline two\n');

let owner: { cookie: string; csrfToken: string };
let workspaceId: string;
let assetId: string;
let documentId: string;

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

  const register = await http()
    .post('/api/v1/auth/register')
    .send({ displayName: 'Owner', email: 'owner@example.com', password: 'owner-passphrase-123' });
  owner = { cookie: sessionCookieOf(register), csrfToken: register.body.csrfToken as string };
  const ws = await http()
    .post('/api/v1/workspaces')
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ name: 'Docs WS', slug: 'docs-ws', mode: 'office' });
  workspaceId = (ws.body as { id: string }).id;
  const asset = await http()
    .post(`/api/v1/workspaces/${workspaceId}/assets`)
    .set('Cookie', owner.cookie)
    .set('x-csrf-token', owner.csrfToken)
    .send({ assetTag: 'DOC-0001', displayName: 'Documented asset' });
  assetId = (asset.body as { id: string }).id;
}, 90_000);

afterAll(async () => {
  await app?.close();
  await client?.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('documents (e2e)', () => {
  it('exposes the multipart upload and streamed download in OpenAPI', () => {
    const { paths } = createOpenApiDocument(app);
    const upload = paths['/api/v1/workspaces/{workspaceId}/assets/{assetId}/documents']?.post;
    expect(upload?.requestBody).toMatchObject({
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            required: ['file', 'kind'],
            properties: {
              file: { type: 'string', format: 'binary' },
              kind: { type: 'string' },
            },
          },
        },
      },
    });
    const download = paths['/api/v1/workspaces/{workspaceId}/documents/{documentId}/download']?.get;
    expect(download?.responses['200']).toMatchObject({
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    });
    expect(download?.responses['200']).not.toHaveProperty('content.application/json');
  });

  it('uploads a PDF with magic-byte verification and returns its metadata', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .field('kind', 'invoice')
      .attach('file', PDF_BYTES, { filename: 'invoice-2026-001.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.mime).toBe('application/pdf');
    expect(res.body.size).toBe(PDF_BYTES.length);
    expect(res.body.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.originalName).toBe('invoice-2026-001.pdf');
    expect(res.body).not.toHaveProperty('objectKey');
    documentId = res.body.id as string;
  });

  it('rejects a text file masquerading as a PDF (415)', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .field('kind', 'invoice')
      .attach('file', TEXT_BYTES, { filename: 'evil.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('uploads a genuine PNG', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .field('kind', 'photo')
      .attach('file', PNG_BYTES, { filename: 'photo.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.mime).toBe('image/png');
  });

  it('stores a traversal filename safely — multer strips path segments; the app keeps metadata verbatim', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .field('kind', 'other')
      .attach('file', PDF_BYTES, { filename: '../../escape-cr-lf.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    // multer reduces '../../escape-cr-lf.pdf' to a bare basename; objectKey is always a UUID regardless.
    expect(res.body.originalName).toBe('escape-cr-lf.pdf');
    expect(res.body.originalName).not.toMatch(/[\\/]/);
  });

  it('downloads the document with sanitized Content-Disposition', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/documents/${documentId}/download`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const disposition = String(res.headers['content-disposition']);
    expect(disposition).toContain('attachment');
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(Buffer.from(res.body).equals(PDF_BYTES)).toBe(true);
  });

  it('lists documents for the asset without leaking object keys', async () => {
    const res = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect((res.body.documents as unknown[]).length).toBe(3);
    expect(JSON.stringify(res.body)).not.toContain('objectKey');
  });

  it('soft-deletes a document; it disappears from list and download', async () => {
    const del = await http()
      .delete(`/api/v1/workspaces/${workspaceId}/documents/${documentId}`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken);
    expect(del.status).toBe(200);

    const list = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`)
      .set('Cookie', owner.cookie);
    expect(JSON.stringify(list.body)).not.toContain(documentId);

    const download = await http()
      .get(`/api/v1/workspaces/${workspaceId}/documents/${documentId}/download`)
      .set('Cookie', owner.cookie);
    expect(download.status).toBe(404);
  });

  it('rejects uploads from a plain member (documents:write required)', async () => {
    const invite = await http()
      .post(`/api/v1/workspaces/${workspaceId}/invites`)
      .set('Cookie', owner.cookie)
      .set('x-csrf-token', owner.csrfToken)
      .send({ email: 'plainmember@example.com', roleKey: 'member' });
    const token = new URL(invite.body.acceptUrl as string).searchParams.get('token')!;
    await http()
      .post('/api/v1/auth/invites/accept')
      .send({ token, displayName: 'Plain', password: 'plain-member-passphrase-1' });
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'plainmember@example.com', password: 'plain-member-passphrase-1' });
    const memberCookie = sessionCookieOf(login);
    const memberCsrf = login.body.csrfToken as string;

    const res = await http()
      .post(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', memberCsrf)
      .field('kind', 'invoice')
      .attach('file', PDF_BYTES, { filename: 'forbidden.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);

    const read = await http()
      .get(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`)
      .set('Cookie', memberCookie);
    expect(read.status).toBe(200);
  });
});
