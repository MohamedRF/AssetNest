import type { OperationOptions, OperationResult } from '@assetnest/sdk';
import { api } from './api';

export type ApprovalRule = OperationResult<'listApprovalRules'>['rules'][number];
export type ApprovalRequest = OperationResult<'listApprovalRequests'>['requests'][number];

function approvalsPath(workspaceId: string | undefined) {
  if (!workspaceId) throw new TypeError('A workspace is required');
  return `/workspaces/${encodeURIComponent(workspaceId)}/approvals`;
}

export const approvalRulesKey = (workspaceId: string | undefined) => ['approval-rules', workspaceId];
export const approvalRequestsKey = (workspaceId: string | undefined) => ['approval-requests', workspaceId];

export const approvalsApi = {
  rules: (workspaceId: string | undefined) =>
    api.get<OperationResult<'listApprovalRules'>>(`${approvalsPath(workspaceId)}/rules`),
  setRules: (workspaceId: string, body: OperationOptions<'setApprovalRules'>['body']) =>
    api.put<OperationResult<'setApprovalRules'>>(`${approvalsPath(workspaceId)}/rules`, body),
  requests: (workspaceId: string | undefined, query?: OperationOptions<'listApprovalRequests'>['query']) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const path = `${approvalsPath(workspaceId)}/requests`;
    return api.get<OperationResult<'listApprovalRequests'>>(search.size ? `${path}?${search}` : path);
  },
  request: (workspaceId: string, body: OperationOptions<'createApprovalRequest'>['body']) =>
    api.post<OperationResult<'createApprovalRequest'>>(`${approvalsPath(workspaceId)}/requests`, body),
  decide: (workspaceId: string, id: string, body: OperationOptions<'decideApprovalRequest'>['body']) =>
    api.post<OperationResult<'decideApprovalRequest'>>(
      `${approvalsPath(workspaceId)}/requests/${encodeURIComponent(id)}/decide`,
      body,
    ),
  cancel: (workspaceId: string, id: string) =>
    api.post<OperationResult<'cancelApprovalRequest'>>(
      `${approvalsPath(workspaceId)}/requests/${encodeURIComponent(id)}/cancel`,
    ),
};
