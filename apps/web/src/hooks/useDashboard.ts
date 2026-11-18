/**
 * Dashboard data source.
 *
 * TODO(api): replace the placeholder constants with a query against
 * GET /api/v1/dashboard (or the asset/warranty/maintenance/audit endpoints)
 * once the API ships in Phase 1. Shape stays the same so the page needs no
 * structural changes.
 */
export interface DashboardStats {
  totalAssets: number;
  warrantyDue: number;
  maintenanceOverdue: number;
  openAudits: number;
}

export interface DashboardData {
  stats: DashboardStats;
  /** Honest empty list — recent activity lands with the API (Phase 1). */
  recentActivity: ReadonlyArray<never>;
  /** True while showing derived placeholder values rather than API data. */
  isPlaceholder: boolean;
}

const PLACEHOLDER_STATS: DashboardStats = {
  totalAssets: 0,
  warrantyDue: 0,
  maintenanceOverdue: 0,
  openAudits: 0,
};

export function useDashboard(): DashboardData {
  return {
    stats: PLACEHOLDER_STATS,
    recentActivity: [],
    isPlaceholder: true,
  };
}
