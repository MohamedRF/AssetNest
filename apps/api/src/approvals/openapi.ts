import { z } from 'zod';
import { WORKFLOW_ACTIONS, WORKSPACE_ROLES } from '@assetnest/domain';
import { openApiSchema } from '../common/openapi.js';
import {
  createApprovalRequestSchema,
  decideApprovalSchema,
  setWorkflowRulesSchema,
  workflowRuleSchema,
} from './dto.js';

export const setWorkflowRulesRequestSchema = setWorkflowRulesSchema;
export const createApprovalRequestSchemaOut = createApprovalRequestSchema;
export const decideApprovalRequestSchema = decideApprovalSchema;

const approvalStatus = z.enum(['pending', 'approved', 'rejected', 'cancelled', 'executed']);
const approvalDecision = z.enum(['approved', 'rejected']);

export const workflowRulesResponse = openApiSchema(z.object({ rules: z.array(workflowRuleSchema) }));

export const approvalRequestViewSchema = z.object({
  id: z.uuid(),
  action: z.enum(WORKFLOW_ACTIONS),
  resourceType: z.string(),
  resourceId: z.uuid().nullable(),
  requestedBy: z.uuid().nullable(),
  status: approvalStatus,
  requiredApprovals: z.number().int(),
  approverRoles: z.array(z.enum(WORKSPACE_ROLES)),
  selfApproval: z.boolean(),
  context: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  executedAt: z.iso.datetime().nullable(),
  decisions: z.array(
    z.object({
      actorId: z.uuid().nullable(),
      decision: approvalDecision,
      note: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export const approvalRequestResponse = openApiSchema(approvalRequestViewSchema);
export const approvalRequestListResponse = openApiSchema(
  z.object({ requests: z.array(approvalRequestViewSchema) }),
);
