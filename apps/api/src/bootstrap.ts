import { VersioningType, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from '@assetnest/config';
import { correlationMiddleware } from './common/correlation.middleware.js';
import { securityHeadersMiddleware } from './common/security-headers.middleware.js';
import { ProblemDetailsFilter } from './common/filter/problem-details.filter.js';

/**
 * Applies the production app configuration shared by main.ts and the e2e
 * tests: global prefix, URI versioning, strict CORS, security headers,
 * correlation middleware and the RFC7807 problem-details filter.
 *
 * Order matters: middleware registered via app.use() runs before Nest routes.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.enableShutdownHooks();

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Strict CORS: the single configured web origin only, with credentials.
  app.enableCors({ origin: config.PUBLIC_APP_URL, credentials: true });

  app.use(securityHeadersMiddleware);
  app.use(correlationMiddleware);

  app.useGlobalFilters(new ProblemDetailsFilter());

  // Express sets X-Powered-By by default; turn it off without extra deps.
  const instance = app.getHttpAdapter().getInstance() as { disable?: (name: string) => void };
  instance.disable?.('x-powered-by');
}

export function setupSwagger(app: INestApplication): void {
  const docConfig = new DocumentBuilder()
    .setTitle('AssetNest API')
    .setDescription(
      'AssetNest — self-hostable, web-only asset management API.\n\n' +
        'All routes live under `/api/v1`. Errors are RFC 7807 problem-details ' +
        '(`type`, `title`, `status`, `detail`, `instance`, `code`, `requestId`).\n\n' +
        'Authentication (when enabled) is via the httpOnly `assetnest_session` ' +
        'cookie sent with `credentials`, or an `Authorization: Bearer <token>` ' +
        'header for API clients. Never place tokens in URLs.',
    )
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addCookieAuth('assetnest_session', { type: 'apiKey', in: 'cookie' }, 'cookieAuth')
    .build();

  const document = SwaggerModule.createDocument(app, docConfig);
  // Not behind the global prefix/versioning on purpose: docs live at /api/docs.
  SwaggerModule.setup('api/docs', app, document);
}
