import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@assetnest/domain';

export const PERMISSIONS_KEY = 'assetnest:requirePermissions';
/**
 * Declares the workspace permission(s) required by a route.
 * Enforced by WorkspaceGuard — which also resolves workspace membership —
 * so the decorator is only meaningful on routes with a `:workspaceId` param.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
