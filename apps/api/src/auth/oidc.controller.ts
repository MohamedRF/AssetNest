import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppConfig } from '@assetnest/config';
import type { Request, Response } from 'express';
import { APP_CONFIG } from '../common/tokens.js';
import { openApiSchema } from '../common/openapi.js';
import { Public } from '../common/public.decorator.js';
import { parseCookies } from '../common/cookies.js';
import { digestsEqual } from '../common/crypto.js';
import { httpCode } from '../common/problem.js';
import { SESSION_COOKIE } from './auth.constants.js';
import { sessionCookieOptions } from './session-cookie.js';
import { AuthService } from './auth.service.js';
import { OIDC_NONCE_COOKIE, OIDC_STATE_COOKIE, OIDC_VERIFIER_COOKIE, OidcService } from './oidc.service.js';

const OIDC_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Optional enterprise SSO (OIDC authorization-code + PKCE). Both endpoints are
 * public because the browser arrives from the identity provider; all state is
 * carried in short-lived HttpOnly cookies and validated server-side.
 */
@ApiTags('Authentication')
@Controller({ path: 'auth/oidc', version: '1' })
export class OidcController {
  constructor(
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private cookieBase() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure: this.config.NODE_ENV === 'production',
    };
  }

  private cookieName(name: string): string {
    return this.config.NODE_ENV === 'production' ? `__Host-${name}` : name;
  }

  private stateCookie(res: Response, name: string, value: string) {
    res.cookie(this.cookieName(name), value, { ...this.cookieBase(), maxAge: OIDC_COOKIE_MAX_AGE_MS });
  }

  private clearOidcCookies(res: Response) {
    for (const name of [OIDC_STATE_COOKIE, OIDC_NONCE_COOKIE, OIDC_VERIFIER_COOKIE]) {
      res.clearCookie(this.cookieName(name), this.cookieBase());
    }
  }

  @Public()
  @Get('config')
  @ApiOperation({ operationId: 'getAuthMethods', summary: 'Public auth capabilities (e.g. SSO enabled)' })
  @ApiOkResponse({
    schema: openApiSchema(z.object({ oidcEnabled: z.boolean() })),
  })
  getConfig() {
    return { oidcEnabled: this.oidc.enabled() };
  }

  @Public()
  @Get('start')
  @ApiExcludeEndpoint()
  @ApiOperation({ operationId: 'startOidcLogin' })
  async start(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.oidc.enabled()) {
      throw httpCode(404, 'SSO is not enabled', 'OIDC_DISABLED');
    }
    const { url, state, nonce, verifier } = await this.oidc.buildAuthorizationUrl();
    this.stateCookie(res, OIDC_STATE_COOKIE, state);
    this.stateCookie(res, OIDC_NONCE_COOKIE, nonce);
    this.stateCookie(res, OIDC_VERIFIER_COOKIE, verifier);
    res.redirect(url);
  }

  @Public()
  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(@Req() req: Request, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.oidc.enabled()) {
      throw httpCode(404, 'SSO is not enabled', 'OIDC_DISABLED');
    }
    const cookies = parseCookies(req.headers.cookie);
    const stateCookie = cookies.get(this.cookieName(OIDC_STATE_COOKIE));
    const nonce = cookies.get(this.cookieName(OIDC_NONCE_COOKIE));
    const verifier = cookies.get(this.cookieName(OIDC_VERIFIER_COOKIE));
    const queryState = typeof req.query['state'] === 'string' ? req.query['state'] : undefined;
    const code = typeof req.query['code'] === 'string' ? req.query['code'] : undefined;

    if (!stateCookie || !queryState || !digestsEqual(stateCookie, queryState)) {
      throw httpCode(400, 'Invalid or missing OIDC state', 'OIDC_STATE_INVALID');
    }
    this.clearOidcCookies(res);
    if (req.query['error'] !== undefined) {
      throw httpCode(400, 'The identity provider could not complete sign-in', 'OIDC_PROVIDER_ERROR');
    }
    if (!code || !nonce || !verifier) {
      throw httpCode(400, 'OIDC callback is missing the code or session cookies', 'OIDC_CALLBACK_INVALID');
    }

    const claims = await this.oidc.verifyCode(code, verifier, nonce);
    const user = await this.oidc.loginFromClaims(claims);
    const session = await this.authService.createSessionFor(user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.cookie(SESSION_COOKIE, session.sessionToken, sessionCookieOptions(this.config));
    res.redirect(this.config.PUBLIC_APP_URL);
  }
}
