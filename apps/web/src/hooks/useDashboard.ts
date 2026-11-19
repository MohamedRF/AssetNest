import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';

export interface DashboardStats {
  totalAssets: number;
  warrantyDue: number;
  maintenanceOverdue: number;
  openAudits: number;
}

export interface ActivityEntry {
  id: string;
  action: string;
  resource: string;
  occurredAt: string;
}

export interface DashboardData {
  stats: DashboardStats;
  recentActivity: ReadonlyArray<ActivityEntry>;
  canSeeAuditLog: boolean;
  /** True while any stat is still a placeholder (API unreachable or error). */
  isPlaceholder: boolean;
}

const PLACEHOLDER_STATS: DashboardStats = {
  totalAssets: 0,
  warrantyDue: 0,
  maintenanceOverdue: 0,
  openAudits: 0,
};

interface WarrantyList {
  warranties: Array<{ id: string; derivedStatus: string }>;
}
interface PlanList {
  plans: Array<{ id: string; dueState: string }>;
}
interface AuditLogList {
  entries: Array<{ id: string; action: string; resource: string; occurred_at?: string; occurredAt?: string }>;
}

/**
 * Live operational summary. `openAudits` stays a fixed honest zero until
 * Phase 3 ships audits. Recent activity reads the workspace audit log
 * (owner/admin only — regular members get a polite empty note).
 */
export function useDashboard(): DashboardData {
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const canSeeAuditLog = workspace?.role === 'owner' || workspace?.role === 'admin';

  const assetsQuery = useQuery({
    queryKey: ['dashboard-assets-total', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ total: number }>(`/workspaces/${workspaceId}/assets?pageSize=1`),
    staleTime: 30_000,
  });

  const warrantiesQuery = useQuery({
    queryKey: ['dashboard-warranties-due', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<WarrantyList>(`/workspaces/${workspaceId}/warranties?expiringDays=90`),
    staleTime: 60_000,
  });

  const plansQuery = useQuery({
    queryKey: ['dashboard-maintenance-overdue', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<PlanList>(`/workspaces/${workspaceId}/maintenance/plans`),
    staleTime: 60_000,
  });

  const activityQuery = useQuery({
    queryKey: ['dashboard-audit-log', workspaceId],
    enabled: workspaceId !== undefined && canSeeAuditLog,
    queryFn: () => api.get<AuditLogList>(`/workspaces/${workspaceId}/audit-log?limit=8`),
    staleTime: 15_000,
  });

  const stats: DashboardStats = {
    totalAssets: assetsQuery.data?.total ?? PLACEHOLDER_STATS.totalAssets,
    warrantyDue: warrantiesQuery.data?.warranties.length ?? PLACEHOLDER_STATS.warrantyDue,
    maintenanceOverdue:
      plansQuery.data?.plans.filter((plan) => plan.dueState === 'overdue').length ??
      PLACEHOLDER_STATS.maintenanceOverdue,
    openAudits: 0,
  };

  const isPlaceholder = assetsQuery.isError && warrantiesQuery.isError && plansQuery.isError;

  const recentActivity: ActivityEntry[] = (activityQuery.data?.entries ?? []).map((entry) => ({
    id: entry.id,
    action: entry.action,
    resource: entry.resource,
    occurredAt: entry.occurredAt ?? entry.occurred_at ?? '',
  }));

  return { stats, recentActivity, canSeeAuditLog, isPlaceholder };
}
