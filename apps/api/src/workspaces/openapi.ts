import { WORKSPACE_ROLES } from '@assetnest/domain';
import { z } from 'zod';
import { workspaceSummarySchema } from '../auth/openapi.js';
import { openApiSchema } from '../common/openapi.js';
import { inviteRoleSchema } from './dto.js';

const workspaceContextSummarySchema = workspaceSummarySchema.extend({
  role: z.enum([...WORKSPACE_ROLES, 'automation']),
});

export const workspaceListResponse = openApiSchema(z.object({ workspaces: z.array(workspaceSummarySchema) }));
export const workspaceCreatedResponse = openApiSchema(
  workspaceSummarySchema.extend({ role: z.literal('owner') }),
);
export const workspaceUpdatedResponse = openApiSchema(workspaceContextSummarySchema);
export const workspaceDetailsResponse = openApiSchema(
  workspaceContextSummarySchema.extend({
    settings: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
    memberCount: z.int().nonnegative(),
  }),
);

export const memberListResponse = openApiSchema(
  z.object({
    members: z.array(
      z.object({
        userId: z.uuid(),
        membershipId: z.uuid(),
        displayName: z.string(),
        email: z.email(),
        role: z.enum(WORKSPACE_ROLES),
        status: z.enum(['invited', 'active', 'suspended']),
        joinedAt: z.iso.datetime(),
      }),
    ),
  }),
);

export const roleChangedResponse = openApiSchema(
  z.object({ ok: z.literal(true), userId: z.uuid(), role: z.enum(WORKSPACE_ROLES) }),
);

export const auditLogListResponse = openApiSchema(
  z.object({
    entries: z.array(
      z.object({
        id: z.uuid(),
        workspaceId: z.uuid(),
        actorId: z.uuid().nullable(),
        action: z.string(),
        resource: z.string(),
        resourceId: z.uuid().nullable(),
        metadataJson: z.record(z.string(), z.unknown()),
        occurredAt: z.iso.datetime(),
      }),
    ),
  }),
);

export const inviteCreatedResponse = openApiSchema(
  z.object({
    inviteId: z.uuid(),
    email: z.email(),
    roleKey: inviteRoleSchema,
    expiresAt: z.iso.datetime(),
    acceptUrl: z.url().describe('One-time invitation URL containing the acceptance token'),
  }),
);

export const inviteListResponse = openApiSchema(
  z.object({
    invites: z.array(
      z.object({
        id: z.uuid(),
        email: z.email(),
        roleKey: inviteRoleSchema,
        status: z.enum(['pending', 'accepted', 'revoked']),
        expiresAt: z.iso.datetime(),
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
);
