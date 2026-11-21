import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, publicConfig } from './index.js';

const validEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/assetnest',
  SESSION_SECRET: 'x'.repeat(48),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('loadConfig', () => {
  it('parses a minimal valid environment with safe defaults', () => {
    const config = loadConfig({ ...validEnv });
    expect(config.NODE_ENV).toBe('development');
    expect(config.API_PORT).toBe(3000);
    expect(config.AI_ENABLED).toBe(false);
    expect(config.STORAGE_DRIVER).toBe('local');
  });

  it('fails fast with a readable issue list when secrets are missing', () => {
    try {
      loadConfig({});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const issues = (err as ConfigError).issues.join('\n');
      expect(issues).toContain('DATABASE_URL');
      expect(issues).toContain('SESSION_SECRET');
      expect(issues).toContain('ENCRYPTION_KEY');
    }
  });

  it('rejects an ENCRYPTION_KEY that is not 32 bytes', () => {
    expect(() => loadConfig({ ...validEnv, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      ConfigError,
    );
  });

  it('rejects non-https PUBLIC_APP_URL in production', () => {
    expect(() =>
      loadConfig({ ...validEnv, NODE_ENV: 'production', PUBLIC_APP_URL: 'http://example.com' }),
    ).toThrow(ConfigError);
  });

  it('requires SMTP settings when MAIL_TRANSPORT=smtp', () => {
    expect(() => loadConfig({ ...validEnv, MAIL_TRANSPORT: 'smtp' })).toThrow(ConfigError);
  });

  it('applies session-hardening defaults and leaves OIDC off', () => {
    const config = loadConfig({ ...validEnv });
    expect(config.SESSION_IDLE_TIMEOUT_MINUTES).toBe(120);
    expect(config.SESSION_ABSOLUTE_TIMEOUT_HOURS).toBe(12);
    expect(config.OIDC_ENABLED).toBe(false);
    expect(config.OIDC_AUTO_CREATE).toBe(false);
  });

  it('requires issuer and client id when OIDC is enabled', () => {
    expect(() => loadConfig({ ...validEnv, OIDC_ENABLED: 'true' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ ...validEnv, OIDC_ENABLED: 'true', OIDC_ISSUER: 'https://idp.example.com' }),
    ).toThrow(ConfigError);
  });

  it('rejects a non-https OIDC issuer in production', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        NODE_ENV: 'production',
        PUBLIC_APP_URL: 'https://app.example.com',
        OIDC_ENABLED: 'true',
        OIDC_ISSUER: 'http://idp.example.com',
        OIDC_CLIENT_ID: 'assetnest',
      }),
    ).toThrow(ConfigError);
  });

  it('allows local OIDC discovery in development and rejects issuer credentials and queries', () => {
    const enabled = { ...validEnv, OIDC_ENABLED: 'true', OIDC_CLIENT_ID: 'assetnest' };
    expect(loadConfig({ ...enabled, OIDC_ISSUER: 'http://127.0.0.1:8080/realms/test' }).OIDC_ENABLED).toBe(
      true,
    );
    expect(() => loadConfig({ ...enabled, OIDC_ISSUER: 'https://user@idp.example.com' })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ ...enabled, OIDC_ISSUER: 'https://idp.example.com/?tenant=test' })).toThrow(
      ConfigError,
    );
  });

  it('requires HTTPS for the production OIDC callback', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        NODE_ENV: 'production',
        PUBLIC_APP_URL: 'https://app.example.com',
        OIDC_ENABLED: 'true',
        OIDC_ISSUER: 'https://idp.example.com',
        OIDC_CLIENT_ID: 'assetnest',
        OIDC_REDIRECT_URI: 'http://app.example.com/api/v1/auth/oidc/callback',
      }),
    ).toThrow(ConfigError);
  });

  it('publicConfig never includes secret material', () => {
    const config = loadConfig({ ...validEnv });
    const printed = JSON.stringify(publicConfig(config));
    expect(printed).not.toContain(validEnv.SESSION_SECRET);
    expect(printed).not.toContain(validEnv.ENCRYPTION_KEY);
    expect(printed).not.toContain('pass@localhost');
  });
});
