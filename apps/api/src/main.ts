import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@assetnest/config';
import { AppModule } from './app.module.js';
import { JsonLoggerService, writeFatalBootstrapError } from './common/logging/json-logger.service.js';
import { configureApp, setupSwagger } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  // Fail fast: invalid environment aborts boot before the port is bound.
  const config = loadConfig();
  const logger = new JsonLoggerService('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger,
  });

  configureApp(app, config);
  setupSwagger(app);

  await app.listen(config.API_PORT);
  logger.log(`AssetNest API listening on port ${config.API_PORT} (env: ${config.NODE_ENV})`);
}

bootstrap().catch((error: unknown) => {
  writeFatalBootstrapError(error);
  process.exitCode = 1;
});
