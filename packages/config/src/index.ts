import { z } from 'zod';

/**
 * Runtime configuration for every AssetNest process (api / worker / scripts).
 * Validation is fail-fast: an invalid environment aborts boot with an explicit
 * list of problems instead of starting in an undefined state.
 *
 * Secrets are never logged. Use `publicConfig()` for surfaces that may be
 * printed (all values are non-secret).
 */

const boolFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const privateAiOrigins = z
  .string()
  .default('')
  .transform((value, ctx) => {
    const origins = new Set<string>();
    for (const entry of value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)) {
      try {
        const url = new URL(entry);
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== '/'
        )
          throw new Error('Expected an HTTP(S) origin');
        origins.add(url.origin);
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'Expected comma-separated HTTP(S) origins without credentials or paths',
        });
        return z.NEVER;
      }
    }
    return [...origins];
  });

const base64Key32 = z.string().refine(
  (v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  },
  { message: 'ENCRYPTION_KEY must be base64-encoded 32 bytes (generate: openssl rand -base64 32)' },
);

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PUBLIC_APP_URL: z.url().default('http://localhost:5173'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).optional(),
  /** Max connections in the pg pool. Embedded/socket Postgres (pglite) requires 1. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 bytes of random material'),
  ENCRYPTION_KEY: base64Key32,
  // Session hardening: 0 disables the respective idle/absolute cap.
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(0).max(10080).default(120),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(0).max(8760).default(12),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_ROOT: z.string().min(1).default('./var/private-files'),

  MAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  AI_ENABLED: boolFromString,
  AI_PRIVATE_ORIGINS: privateAiOrigins,
  // OIDC / enterprise SSO (optional, provider-neutral).
  OIDC_ENABLED: boolFromString,
  OIDC_ISSUER: z.url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_REDIRECT_URI: z.url().optional(),
  OIDC_SCOPES: z.string().default('openid email profile'),
  OIDC_AUTO_CREATE: boolFromString,
  OIDC_ALLOWED_DOMAINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  OIDC_CLIENT_AUTH_METHOD: z
    .enum(['client_secret_basic', 'client_secret_post'])
    .default('client_secret_post'),
  MCP_ENABLED: boolFromString,
  WEBHOOKS_ENABLED: boolFromString,
  /** Opt-in only: allow webhooks to private/loopback destinations (never in multi-tenant deployments). */
  WEBHOOKS_ALLOW_PRIVATE: boolFromString,

  SEED_ADMIN_EMAIL: z.email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new ConfigError(issues);
  }
  const config = parsed.data;
  if (config.MAIL_TRANSPORT === 'smtp' && (!config.SMTP_HOST || !config.SMTP_FROM)) {
    throw new ConfigError(['MAIL_TRANSPORT=smtp requires SMTP_HOST and SMTP_FROM to be set']);
  }
  if (config.NODE_ENV === 'production' && !config.PUBLIC_APP_URL.startsWith('https://')) {
    throw new ConfigError(['NODE_ENV=production requires PUBLIC_APP_URL to use https://']);
  }
  if (config.OIDC_ENABLED) {
    const missing: string[] = [];
    if (!config.OIDC_ISSUER) missing.push('OIDC_ISSUER');
    if (!config.OIDC_CLIENT_ID) missing.push('OIDC_CLIENT_ID');
    if (missing.length > 0) {
      throw new ConfigError([`OIDC_ENABLED=true requires ${missing.join(', ')}`]);
    }
    const issuer = new URL(config.OIDC_ISSUER!);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname);
    const allowLoopbackHttp = config.NODE_ENV !== 'production' && loopback && issuer.protocol === 'http:';
    if (
      (issuer.protocol !== 'https:' && !allowLoopbackHttp) ||
      issuer.username ||
      issuer.password ||
      config.OIDC_ISSUER!.includes('?') ||
      config.OIDC_ISSUER!.includes('#')
    ) {
      throw new ConfigError([
        'OIDC_ISSUER must be an HTTPS URL without credentials, query or fragment (HTTP loopback is allowed outside production)',
      ]);
    }
    if (config.OIDC_REDIRECT_URI) {
      const redirect = new URL(config.OIDC_REDIRECT_URI);
      if (
        redirect.username ||
        redirect.password ||
        config.OIDC_REDIRECT_URI.includes('#') ||
        (redirect.protocol !== 'https:' &&
          (config.NODE_ENV === 'production' || redirect.protocol !== 'http:'))
      ) {
        throw new ConfigError([
          'OIDC_REDIRECT_URI must use HTTPS in production and cannot contain credentials or a fragment',
        ]);
      }
    }
  }
  return config;
}

/** Non-secret subset safe to print in logs or diagnostics. */
export function publicConfig(config: AppConfig): Record<string, string | number | boolean> {
  return {
    NODE_ENV: config.NODE_ENV,
    PUBLIC_APP_URL: config.PUBLIC_APP_URL,
    API_PORT: config.API_PORT,
    STORAGE_DRIVER: config.STORAGE_DRIVER,
    MAIL_TRANSPORT: config.MAIL_TRANSPORT,
    AI_ENABLED: config.AI_ENABLED,
    MCP_ENABLED: config.MCP_ENABLED,
    WEBHOOKS_ENABLED: config.WEBHOOKS_ENABLED,
    WEBHOOKS_ALLOW_PRIVATE: config.WEBHOOKS_ALLOW_PRIVATE,
    OIDC_ENABLED: config.OIDC_ENABLED,
    OIDC_ISSUER: config.OIDC_ISSUER ?? '',
    SESSION_IDLE_TIMEOUT_MINUTES: config.SESSION_IDLE_TIMEOUT_MINUTES,
    SESSION_ABSOLUTE_TIMEOUT_HOURS: config.SESSION_ABSOLUTE_TIMEOUT_HOURS,
    REDIS_CONFIGURED: Boolean(config.REDIS_URL),
  };
}
