import { z } from 'zod';
import { WORKSPACE_ROLES, WORKSPACE_MODES } from '@assetnest/domain';

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    'Slug must be lowercase letters, digits and hyphens (2-63 chars)',
  );

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Workspace name is required').max(120),
  mode: z.enum(['home', 'office']).default('office'),
  slug: slugSchema.optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    mode: z.enum(['home', 'office']).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided');
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

/** 'owner' is never grantable through invites — only via explicit ownership transfer. */
export const inviteRoleSchema = z.enum(['admin', 'manager', 'member', 'auditor']);

export const createInviteSchema = z.object({
  email: z
    .email('Enter a valid email address')
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  roleKey: inviteRoleSchema,
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const changeRoleSchema = z.object({
  roleKey: z.enum(['owner', 'admin', 'manager', 'member', 'auditor']),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(128),
  displayName: z.string().trim().min(1, 'Display name is required').max(120),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128)
    .refine((v) => v.trim().length >= 12, 'Password must not be mostly whitespace'),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
