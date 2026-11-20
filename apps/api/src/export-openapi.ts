import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import type { AppConfig } from '@assetnest/config';
import { configureApp, createOpenApiDocument } from './bootstrap.js';
import { APP_CONFIG } from './common/tokens.js';

const destination = process.argv[2];
if (!destination) throw new Error('Provide an output path for the OpenAPI document.');

// This CLI runs in its own process and only scans controller metadata. Use
// isolated settings so local secrets or feature flags cannot change the export.
process.env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://127.0.0.1:1/openapi-export',
  SESSION_SECRET: randomBytes(32).toString('base64'),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
const { AppModule } = await import('./app.module.js');
const app = await NestFactory.create(AppModule, { abortOnError: false, logger: false });
try {
  configureApp(app, app.get<AppConfig>(APP_CONFIG));
  const document = createOpenApiDocument(app);
  await writeFile(destination, `${JSON.stringify(document, null, 2)}\n`);
} finally {
  await app.close();
}
