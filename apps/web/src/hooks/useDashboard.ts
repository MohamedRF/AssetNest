import type { OperationResult } from '@assetnest/sdk';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { assetsApi } from '../lib/assets-api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { useAuditList } from './useAuditList';

export function useDashboard() {
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const canSeeAuditLog =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'auditor';

  const assetsQuery = useQuery({
    queryKey: ['dashboard-assets-total', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => assetsApi.list(workspaceId, { pageSize: 1 }),
    staleTime: 30_000,
  });

  const warrantiesQuery = useQuery({
    queryKey: ['dashboard-warranties-due', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      api.get<OperationResult<'listWarranties'>>(`/workspaces/${workspaceId}/warranties?expiringDays=90`),
    staleTime: 60_000,
  });

  const plansQuery = useQuery({
    queryKey: ['dashboard-maintenance-overdue', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      api.get<OperationResult<'listMaintenancePlans'>>(`/workspaces/${workspaceId}/maintenance/plans`),
    staleTime: 60_000,
  });

  const activityQuery = useQuery({
    queryKey: ['dashboard-audit-log', workspaceId],
    enabled: workspaceId !== undefined && canSeeAuditLog,
    queryFn: () =>
      api.get<OperationResult<'listWorkspaceAuditLog'>>(`/workspaces/${workspaceId}/audit-log?limit=8`),
    staleTime: 15_000,
  });

  const { canManageAudits, query: auditsQuery } = useAuditList(workspaceId, workspace?.role);

  return {
    hasWorkspace: workspaceId !== undefined,
    canManageAudits,
    canSeeAuditLog,
    activityQuery,
    statsError:
      assetsQuery.isError ||
      warrantiesQuery.isError ||
      plansQuery.isError ||
      (canManageAudits && auditsQuery.isError),
    stats: {
      totalAssets: assetsQuery.data?.total,
      warrantyDue: warrantiesQuery.data?.warranties.length,
      maintenanceOverdue: plansQuery.data?.plans.filter((plan) => plan.dueState === 'overdue').length,
      openAudits: auditsQuery.data?.audits.filter((audit) => audit.status === 'open').length,
    },
  };
}
