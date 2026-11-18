import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { AppModule } from '../app.module.js';
import { configureApp, setupSwagger } from '../bootstrap.js';
import { APP_CONFIG } from '../common/tokens.js';

/**
 * E2E-ish tests against a real Nest application instance.
 *
 * The database URL points at an unreachable address on purpose: /health/live
 * must still return 200 (it never touches the DB) and /health/ready must
 * return 503 with a leak-free body.
 */
const testEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: 'http://localhost:5173',
  API_PORT: '3000',
  DATABASE_URL: 'postgresql://127.0.0.1:1/assetnest-unreachable',
  SESSION_SECRET: 'test-session-secret-with-at-least-32-bytes!!',
  ENCRYPTION_KEY: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
};

const testConfig: AppConfig = loadConfig(testEnv);

describe('health endpoints', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(testConfig)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, testConfig);
    setupSwagger(app);
    await app.init();
  }, 15000);

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health/live returns 200 without touching the database', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /api/v1/health/ready returns 503 with a leak-free body when the DB is unreachable', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'down' } });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('ECONNREFUSED');
    expect(raw).not.toContain('127.0.0.1');
    expect(raw).not.toContain('assetnest-unreachable');
    expect(raw).not.toContain('postgresql');
  }, 10000);

  it('GET /api/v1/health/ready does not leak headers either', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  }, 10000);

  it('GET /api/v1/version returns the service name, version and node', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/version');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('assetnest-api');
    expect(res.body.version).toBe('0.1.0');
    expect(res.body.node).toBe(process.version);
  });

  it('reflects a client-provided safe x-request-id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', 'client-req-42');
    expect(res.headers['x-request-id']).toBe('client-req-42');
  });

  it('serves the swagger UI setup at /api/docs (json)', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('AssetNest API');
  });
});
