import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { AppConfig } from '@assetnest/config';
import type { Request, Response } from 'express';
import { APP_CONFIG } from '../common/tokens.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { Public } from '../common/public.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { deriveCsrfToken } from '../common/csrf.js';
import { SESSION_COOKIE } from './auth.constants.js';
import { sessionCookieOptions, clearSessionCookieOptions } from './session-cookie.js';
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from './dto.js';
import { AuthService } from './auth.service.js';
import { CurrentAuth, CurrentUser } from './current-user.decorator.js';
import type { AuthContext } from './session-auth.guard.js';
import type { PublicUser } from './auth.service.js';
import {
  ApiSessionCsrf,
  clearSessionCookieHeader,
  okResponse,
  sessionCookieHeader,
  sessionIdentityResponse,
  sessionsResponse,
} from './openapi.js';

@ApiTags('Authentication')
@ApiProblemResponse()
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private setSessionCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.config));
  }

  private clearSessionCookie(res: Response) {
    res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(this.config));
  }

  @Public()
  @Post('register')
  @ApiOperation({ operationId: 'register', summary: 'Create the bootstrap account and sign in' })
  @ApiBody({ schema: openApiSchema(registerSchema, 'input') })
  @ApiCreatedResponse({ schema: sessionIdentityResponse, headers: { 'Set-Cookie': sessionCookieHeader } })
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.registerBootstrap(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setSessionCookie(res, result.sessionToken);
    return { user: result.user, workspaces: result.workspaces, csrfToken: result.csrfToken };
  }

  @Public()
  @Post('login')
  @ApiOperation({ operationId: 'login', summary: 'Create a browser session' })
  @ApiBody({ schema: openApiSchema(loginSchema, 'input') })
  @ApiOkResponse({ schema: sessionIdentityResponse, headers: { 'Set-Cookie': sessionCookieHeader } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setSessionCookie(res, result.sessionToken);
    return { user: result.user, workspaces: result.workspaces, csrfToken: result.csrfToken };
  }

  @Post('logout')
  @ApiOperation({ operationId: 'logout' })
  @ApiSecurity('cookieAuth')
  @ApiSessionCsrf()
  @ApiOkResponse({ schema: okResponse, headers: { 'Set-Cookie': clearSessionCookieHeader } })
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(auth.sessionId);
    this.clearSessionCookie(res);
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ operationId: 'getCurrentUser' })
  @ApiSecurity('cookieAuth')
  @ApiOkResponse({ schema: sessionIdentityResponse })
  async me(@CurrentAuth() auth: AuthContext) {
    const workspaces = await this.authService.listWorkspaces(auth.user.id);
    return {
      user: auth.user,
      workspaces,
      csrfToken: deriveCsrfToken(auth.sessionToken, this.config.SESSION_SECRET),
    };
  }

  @Get('sessions')
  @ApiOperation({ operationId: 'listSessions' })
  @ApiSecurity('cookieAuth')
  @ApiOkResponse({ schema: sessionsResponse })
  async sessions(@CurrentUser() user: PublicUser, @CurrentAuth() auth: AuthContext) {
    return { sessions: await this.authService.listSessions(user.id, auth.sessionId) };
  }

  @Delete('sessions/:id')
  @ApiOperation({ operationId: 'revokeSession' })
  @ApiSecurity('cookieAuth')
  @ApiSessionCsrf()
  @ApiOkResponse({ schema: okResponse, headers: { 'Set-Cookie': clearSessionCookieHeader } })
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.authService.revokeOwnSession(user.id, id);
    if (id === auth.sessionId) {
      // Revoking the current session signs this browser out.
      this.clearSessionCookie(res);
    }
    return { ok: true };
  }
}
