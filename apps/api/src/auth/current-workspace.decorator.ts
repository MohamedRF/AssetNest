import { createParamDecorator, type ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import type { WorkspaceContext, RequestWithWorkspace } from './workspace.guard.js';

/** Extracts the resolved workspace context; present only on :workspaceId routes past WorkspaceGuard. */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithWorkspace>();
    if (!request.workspace) {
      throw new HttpException(
        { message: 'Workspace context required', code: 'WORKSPACE_CONTEXT_REQUIRED' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return request.workspace;
  },
);
