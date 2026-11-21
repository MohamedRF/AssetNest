import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { OidcController } from './oidc.controller.js';
import { OidcService } from './oidc.service.js';
import { SessionGuard } from './session-auth.guard.js';
import { CsrfGuard } from './csrf.guard.js';
import { WorkspaceGuard } from './workspace.guard.js';

/**
 * Global guards (order matters): SessionGuard → CsrfGuard → WorkspaceGuard.
 * SessionGuard authenticates; CsrfGuard validates mutating session requests;
 * WorkspaceGuard resolves :workspaceId membership + @RequirePermissions.
 */
@Module({
  controllers: [AuthController, OidcController],
  providers: [
    AuthService,
    OidcService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: WorkspaceGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
