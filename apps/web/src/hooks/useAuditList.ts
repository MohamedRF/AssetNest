import { useQuery } from '@tanstack/react-query';
import type { OperationResult } from '@assetnest/sdk';
import { api } from '../lib/api';

export function canAccessAuditSessions(role: string | undefined) {
  return ['owner', 'admin', 'manager', 'auditor'].includes(role ?? '');
}

export function useAuditList(workspaceId: string | undefined, role: string | undefined) {
  const canManageAudits = canAccessAuditSessions(role);
  const query = useQuery({
    queryKey: ['audits', workspaceId],
    enabled: workspaceId !== undefined && canManageAudits,
    queryFn: ({ signal }) =>
      api.get<OperationResult<'listAudits'>>(`/workspaces/${workspaceId}/audits`, signal),
  });

  return { canManageAudits, query };
}
