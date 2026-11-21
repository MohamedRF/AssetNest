import { VersioningType, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject, type ParameterObject } from '@nestjs/swagger';
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
  // Accept up to 2 MiB JSON bodies (CSV imports carry inline text); the
  // Express default of 100 kb was rejecting them with 413. The method is
  // typed on NestExpressApplication, not INestApplication.
  const withBodyParser = app as unknown as {
    useBodyParser?: (type: 'json', options: { limit: string }) => void;
  };
  withBodyParser.useBodyParser?.('json', { limit: '2mb' });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Strict CORS: only the configured web origin (and same-origin/no-origin
  // requests) is allowed. A function is used so the header is never echoed for
  // an arbitrary attacker-controlled Origin.
  const allowedOrigin = new URL(config.PUBLIC_APP_URL).origin;
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || origin === allowedOrigin) callback(null, true);
      else callback(null, false);
    },
    credentials: true,
  });

  app.use(securityHeadersMiddleware);
  app.use(correlationMiddleware);

  app.useGlobalFilters(new ProblemDetailsFilter());

  // Express sets X-Powered-By by default; turn it off without extra deps.
  const instance = app.getHttpAdapter().getInstance() as { disable?: (name: string) => void };
  instance.disable?.('x-powered-by');
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const docConfig = new DocumentBuilder()
    .setTitle('AssetNest API')
    .setDescription(
      'AssetNest — self-hostable, web-only asset management API.\n\n' +
        'All routes live under `/api/v1`. Errors are RFC 7807 problem-details ' +
        '(`type`, `title`, `status`, `detail`, `instance`, `code`, `requestId`).\n\n' +
        'Browser sessions use the httpOnly `assetnest_session` cookie and an ' +
        '`x-csrf-token` header for mutations. Automation uses opaque, workspace-scoped ' +
        '`anst_` bearer tokens on supported routes. Never place tokens in URLs.',
    )
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'anst_' }, 'bearer')
    .addCookieAuth('assetnest_session', { type: 'apiKey', in: 'cookie' }, 'cookieAuth')
    .build();

  const document = SwaggerModule.createDocument(app, docConfig);
  // Workspace IDs are often read by guards and custom decorators. Swagger
  // reflection cannot infer them, so declare all route-template parameters.
  for (const [path, item] of Object.entries(document.paths)) {
    const parameters = [...path.matchAll(/\{(?<name>[^}]+)\}/g)].map<ParameterObject>((match) => ({
      name: match[1]!,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    if (parameters.length > 0) item.parameters = parameters;
  }
  return document;
}

export function setupSwagger(app: INestApplication): void {
  // Not behind the global prefix/versioning on purpose: docs live at /api/docs.
  SwaggerModule.setup('api/docs', app, createOpenApiDocument(app));
}
