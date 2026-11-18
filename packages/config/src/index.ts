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

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_ROOT: z.string().min(1).default('./var/private-files'),

  MAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  AI_ENABLED: boolFromString,
  MCP_ENABLED: boolFromString,
  WEBHOOKS_ENABLED: boolFromString,

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
    REDIS_CONFIGURED: Boolean(config.REDIS_URL),
  };
}
