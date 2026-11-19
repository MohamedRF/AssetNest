import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';

export interface DashboardStats {
  totalAssets: number;
  warrantyDue: number;
  maintenanceOverdue: number;
  openAudits: number;
}

export interface DashboardData {
  stats: DashboardStats;
  /** Honest empty list — recent activity lands with Phase 2's event/audit feed. */
  recentActivity: ReadonlyArray<never>;
  /** True while stats are placeholder zeros rather than live API data. */
  isPlaceholder: boolean;
}

const PLACEHOLDER_STATS: DashboardStats = {
  totalAssets: 0,
  warrantyDue: 0,
  maintenanceOverdue: 0,
  openAudits: 0,
};

/**
 * Live dashboard stats. Only total assets is wired today — warranty/maintenance/audits
 * have no endpoints yet (Phase 2/3), so they stay honestly at zero rather than inventing numbers.
 */
export function useDashboard(): DashboardData {
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;

  const assetsQuery = useQuery({
    queryKey: ['dashboard-assets-total', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ total: number }>(`/workspaces/${workspaceId}/assets?pageSize=1`),
    staleTime: 30_000,
  });

  if (assetsQuery.data) {
    return {
      stats: { ...PLACEHOLDER_STATS, totalAssets: assetsQuery.data.total },
      recentActivity: [],
      isPlaceholder: false,
    };
  }
  return { stats: PLACEHOLDER_STATS, recentActivity: [], isPlaceholder: true };
}
