import { z } from 'zod';
import { WORKFLOW_ACTIONS, permissionsForRole, WORKSPACE_ROLES } from '@assetnest/domain';

export const workflowRuleSchema = z.object({
  action: z.enum(WORKFLOW_ACTIONS),
  requiredApprovals: z.number().int('Approvals must be a whole number').min(1).max(10),
  approverRoles: z
    .array(z.enum(WORKSPACE_ROLES))
    .min(1, 'Select at least one approver role')
    .refine(
      (roles) => roles.every((role) => permissionsForRole(role).includes('approvals:manage')),
      'Approver roles must have approval management permission',
    ),
  selfApproval: z.boolean().default(false),
});
export type WorkflowRuleInput = z.infer<typeof workflowRuleSchema>;

export const setWorkflowRulesSchema = z
  .object({ rules: z.array(workflowRuleSchema).max(WORKFLOW_ACTIONS.length) })
  .refine(
    (value) => new Set(value.rules.map((rule) => rule.action)).size === value.rules.length,
    'Each action may appear at most once',
  );
export type SetWorkflowRulesInput = z.infer<typeof setWorkflowRulesSchema>;

export const createApprovalRequestSchema = z.object({
  action: z.enum(WORKFLOW_ACTIONS),
  resourceType: z.literal('asset'),
  resourceId: z.uuid(),
  context: z.record(z.string(), z.unknown()).default({}),
});
export type CreateApprovalRequestInput = z.infer<typeof createApprovalRequestSchema>;

export const decideApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
});
export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;

export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled', 'executed']);
