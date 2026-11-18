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
  UsePipes,
} from '@nestjs/common';
import type { AppConfig } from '@assetnest/config';
import type { Request, Response } from 'express';
import { APP_CONFIG } from '../common/tokens.js';
import { Public } from '../common/public.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { deriveCsrfToken } from '../common/csrf.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './auth.constants.js';
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from './dto.js';
import { AuthService } from './auth.service.js';
import { CurrentAuth, CurrentUser } from './current-user.decorator.js';
import type { AuthContext } from './session-auth.guard.js';
import type { PublicUser } from './auth.service.js';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private sessionCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure: this.config.NODE_ENV === 'production',
      maxAge: SESSION_TTL_SECONDS * 1000,
    };
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, this.sessionCookieOptions());
  }

  private clearSessionCookie(res: Response) {
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.config.NODE_ENV === 'production',
    });
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(@Body() body: RegisterInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.registerBootstrap(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setSessionCookie(res, result.sessionToken);
    return { user: result.user, workspaces: result.workspaces, csrfToken: result.csrfToken };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setSessionCookie(res, result.sessionToken);
    return { user: result.user, workspaces: result.workspaces, csrfToken: result.csrfToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(auth.sessionId);
    this.clearSessionCookie(res);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext) {
    const workspaces = await this.authService.listWorkspaces(auth.user.id);
    return {
      user: auth.user,
      workspaces,
      csrfToken: deriveCsrfToken(auth.sessionToken, this.config.SESSION_SECRET),
    };
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: PublicUser, @CurrentAuth() auth: AuthContext) {
    return { sessions: await this.authService.listSessions(user.id, auth.sessionId) };
  }

  @Delete('sessions/:id')
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
