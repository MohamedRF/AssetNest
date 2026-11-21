import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '@assetnest/config';
import { users } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { generateToken } from '../common/crypto.js';
import { httpCode, isUniqueViolation } from '../common/problem.js';
import type { PublicUser } from './auth.service.js';
import { emailSchema } from './dto.js';

export const OIDC_STATE_COOKIE = 'assetnest_oidc_state';
export const OIDC_NONCE_COOKIE = 'assetnest_oidc_nonce';
export const OIDC_VERIFIER_COOKIE = 'assetnest_oidc_verifier';

export interface OidcClaims {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  preferred_username?: string;
}

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
});
const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

interface DiscoveryDocument {
  authorizationEndpoint: URL;
  tokenEndpoint: URL;
  jwksUri: URL;
}

interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
}

function formEncode(value: string): string {
  return new URLSearchParams([['', value]]).toString().slice(1);
}

const accountColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  status: users.status,
};

function activeAccount({ status, ...account }: PublicUser & { status: string }): PublicUser {
  if (status !== 'active') {
    throw httpCode(HttpStatus.FORBIDDEN, 'This account is unavailable', 'OIDC_ACCOUNT_UNAVAILABLE');
  }
  return account;
}

async function fetchProviderJson(
  url: URL,
  init: RequestInit,
  code: string,
  message: string,
): Promise<unknown> {
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(`Unexpected provider response status ${response.status}`);
    }
    return await response.json();
  } catch (cause) {
    throw new HttpException({ code, message }, HttpStatus.BAD_GATEWAY, { cause });
  }
}

/**
 * Provider-neutral OIDC relying-party implementation (authorization code flow
 * with PKCE). The issuer is operator-configured and trusted; discovery and JWKS
 * are fetched over HTTPS (or loopback in tests) with redirects disabled.
 */
@Injectable()
export class OidcService {
  private discoveryCache: { document: DiscoveryDocument; expiresAt: number } | null = null;
  private jwksCache: { uri: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  enabled(): boolean {
    return this.config.OIDC_ENABLED;
  }

  private providerConfig(): { issuer: string; clientId: string } {
    const { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId } = this.config;
    if (!issuer || !clientId) {
      throw httpCode(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'OIDC is enabled but incomplete',
        'OIDC_NOT_CONFIGURED',
      );
    }
    return { issuer, clientId };
  }

  redirectUri(): string {
    return (
      this.config.OIDC_REDIRECT_URI ??
      new URL('/api/v1/auth/oidc/callback', this.config.PUBLIC_APP_URL).toString()
    );
  }

  async buildAuthorizationUrl(): Promise<AuthorizationRequest> {
    const { clientId } = this.providerConfig();
    const { authorizationEndpoint } = await this.discovery();
    const state = generateToken();
    const nonce = generateToken();
    const verifier = generateToken();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const target = new URL(authorizationEndpoint);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('client_id', clientId);
    target.searchParams.set('redirect_uri', this.redirectUri());
    target.searchParams.set('scope', this.config.OIDC_SCOPES);
    target.searchParams.set('state', state);
    target.searchParams.set('nonce', nonce);
    target.searchParams.set('code_challenge', challenge);
    target.searchParams.set('code_challenge_method', 'S256');
    return { url: target.toString(), state, nonce, verifier };
  }

  private providerEndpoint(value: string): URL {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const allowHttp = this.config.NODE_ENV !== 'production' && loopback && url.protocol === 'http:';
    if ((url.protocol !== 'https:' && !allowHttp) || url.username || url.password || url.hash) {
      throw httpCode(HttpStatus.BAD_GATEWAY, 'OIDC discovery document is invalid', 'OIDC_DISCOVERY_INVALID');
    }
    return url;
  }

  private async discovery(): Promise<DiscoveryDocument> {
    const { issuer } = this.providerConfig();
    const cached = this.discoveryCache;
    if (cached && Date.now() < cached.expiresAt) {
      return cached.document;
    }
    const url = this.providerEndpoint(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
    const response = await fetchProviderJson(
      url,
      { headers: { accept: 'application/json' } },
      'OIDC_DISCOVERY_FAILED',
      'OIDC discovery failed',
    );
    const parsed = discoverySchema.safeParse(response);
    if (!parsed.success || parsed.data.issuer !== issuer) {
      throw httpCode(HttpStatus.BAD_GATEWAY, 'OIDC discovery document is invalid', 'OIDC_DISCOVERY_INVALID');
    }
    const document = {
      authorizationEndpoint: this.providerEndpoint(parsed.data.authorization_endpoint),
      tokenEndpoint: this.providerEndpoint(parsed.data.token_endpoint),
      jwksUri: this.providerEndpoint(parsed.data.jwks_uri),
    };
    this.discoveryCache = { document, expiresAt: Date.now() + 5 * 60_000 };
    return document;
  }

  private jwks(document: DiscoveryDocument): ReturnType<typeof createRemoteJWKSet> {
    const uri = document.jwksUri.toString();
    const cached = this.jwksCache;
    if (cached?.uri === uri) {
      return cached.set;
    }
    const set = createRemoteJWKSet(document.jwksUri, {
      timeoutDuration: 10_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    this.jwksCache = { uri, set };
    return set;
  }

  async exchangeCode(code: string, verifier: string): Promise<string> {
    const { clientId } = this.providerConfig();
    const document = await this.discovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(),
      code_verifier: verifier,
    });
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    const secret = this.config.OIDC_CLIENT_SECRET;
    if (secret && this.config.OIDC_CLIENT_AUTH_METHOD === 'client_secret_basic') {
      const credentials = `${formEncode(clientId)}:${formEncode(secret)}`;
      headers['authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
    } else {
      body.set('client_id', clientId);
      if (secret) body.set('client_secret', secret);
    }
    const response = await fetchProviderJson(
      document.tokenEndpoint,
      { method: 'POST', headers, body },
      'OIDC_TOKEN_EXCHANGE_FAILED',
      'OIDC token exchange failed',
    );
    const parsed = tokenResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw httpCode(
        HttpStatus.BAD_GATEWAY,
        'OIDC token response did not include an id_token',
        'OIDC_ID_TOKEN_MISSING',
      );
    }
    return parsed.data.id_token;
  }

  async verifyCode(code: string, verifier: string, nonce: string): Promise<OidcClaims> {
    const idToken = await this.exchangeCode(code, verifier);
    return this.verifyIdToken(idToken, nonce);
  }

  async verifyIdToken(idToken: string, nonce: string): Promise<OidcClaims> {
    const { issuer, clientId } = this.providerConfig();
    const document = await this.discovery();
    let payload: Record<string, unknown>;
    try {
      const result = await jwtVerify(idToken, this.jwks(document), {
        issuer,
        audience: clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
        algorithms: [
          'RS256',
          'RS384',
          'RS512',
          'PS256',
          'PS384',
          'PS512',
          'ES256',
          'ES384',
          'ES512',
          'EdDSA',
        ],
      });
      payload = result.payload as Record<string, unknown>;
    } catch {
      throw httpCode(HttpStatus.UNAUTHORIZED, 'OIDC id_token is invalid', 'OIDC_ID_TOKEN_INVALID');
    }
    if (typeof payload.sub !== 'string' || !/^[\x20-\x7E]{1,255}$/.test(payload.sub)) {
      throw httpCode(
        HttpStatus.UNAUTHORIZED,
        'OIDC id_token has an invalid subject',
        'OIDC_ID_TOKEN_INVALID',
      );
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (
      audiences.some((audience) => audience !== clientId) ||
      (payload.azp !== undefined && payload.azp !== clientId)
    ) {
      throw httpCode(HttpStatus.UNAUTHORIZED, 'OIDC id_token is invalid', 'OIDC_ID_TOKEN_INVALID');
    }
    if (payload.nonce !== nonce) {
      throw httpCode(HttpStatus.UNAUTHORIZED, 'OIDC nonce mismatch', 'OIDC_NONCE_MISMATCH');
    }
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      preferred_username:
        typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
    };
  }

  private verifiedEmail(claims: OidcClaims): string {
    if (!claims.email) {
      throw httpCode(
        HttpStatus.BAD_REQUEST,
        'Your identity provider did not release an email address',
        'OIDC_EMAIL_REQUIRED',
      );
    }
    if (!claims.emailVerified) {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Your email address is not verified with the identity provider',
        'OIDC_EMAIL_UNVERIFIED',
      );
    }
    const parsed = emailSchema.safeParse(claims.email.trim());
    if (!parsed.success) {
      throw httpCode(
        HttpStatus.BAD_REQUEST,
        'Your identity provider returned an invalid email',
        'OIDC_EMAIL_INVALID',
      );
    }
    const email = parsed.data;
    const allowed = this.config.OIDC_ALLOWED_DOMAINS;
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (allowed.length > 0 && !allowed.includes(domain)) {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Your email domain is not allowed to sign in here',
        'OIDC_DOMAIN_NOT_ALLOWED',
      );
    }
    return email;
  }

  private async findBySubject(subject: string): Promise<PublicUser | null> {
    const [account] = await this.db
      .select(accountColumns)
      .from(users)
      .where(eq(users.authSubject, subject))
      .limit(1);
    return account ? activeAccount(account) : null;
  }

  /** Resolve (or provision) the local account for a verified subject. */
  async loginFromClaims(claims: OidcClaims): Promise<PublicUser> {
    const { issuer } = this.providerConfig();
    const subject = `${issuer}:${claims.sub}`;
    const policyEmail = this.config.OIDC_ALLOWED_DOMAINS.length > 0 ? this.verifiedEmail(claims) : null;
    const bySubject = await this.findBySubject(subject);
    if (bySubject) return bySubject;

    const email = policyEmail ?? this.verifiedEmail(claims);
    try {
      const [byEmail] = await this.db
        .select({ id: users.id, authSubject: users.authSubject, status: users.status })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      if (byEmail) {
        if (byEmail.authSubject === null && byEmail.status === 'active') {
          const [linked] = await this.db
            .update(users)
            .set({ authSubject: subject, updatedAt: new Date() })
            .where(and(eq(users.id, byEmail.id), isNull(users.authSubject), eq(users.status, 'active')))
            .returning(accountColumns);
          if (linked) return activeAccount(linked);
        }
      } else {
        if (!this.config.OIDC_AUTO_CREATE) {
          throw httpCode(
            HttpStatus.FORBIDDEN,
            'No local account matches this identity and automatic creation is disabled',
            'OIDC_NO_ACCOUNT',
          );
        }
        const displayName = (claims.name?.trim() || claims.preferred_username?.trim() || email).slice(0, 120);
        const [created] = await this.db
          .insert(users)
          .values({ email, displayName, authSubject: subject, passwordHash: null })
          .returning(accountColumns);
        if (created) return activeAccount(created);
      }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    // Concurrent requests may complete binding first. Only the same subject can reuse that binding.
    const concurrent = await this.findBySubject(subject);
    if (concurrent) return concurrent;
    throw httpCode(HttpStatus.FORBIDDEN, 'This account is unavailable', 'OIDC_ACCOUNT_UNAVAILABLE');
  }
}
