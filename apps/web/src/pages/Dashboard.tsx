import { ArrowRight, ClipboardCheck, History, Package, ShieldCheck, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useDashboard } from '../hooks/useDashboard';

const WORKSPACE_LINKS = [
  {
    label: 'Browse assets',
    description: 'Find equipment by tag, name, or serial number.',
    href: '/assets',
  },
  {
    label: 'Browse locations',
    description: 'See where equipment is stored.',
    href: '/locations',
  },
  {
    label: 'Workspace settings',
    description: 'Manage your workspace and appearance.',
    href: '/settings',
  },
] as const;

export function Dashboard() {
  const { stats, statsError, activityQuery, canSeeAuditLog, canManageAudits, hasWorkspace } = useDashboard();
  const recentActivity = activityQuery.data?.entries ?? [];

  if (!hasWorkspace) {
    return (
      <EmptyState
        icon={Package}
        title="Create a workspace first"
        description="Set up a Home or Office workspace to start tracking your equipment."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  const actionLabel = (action: string): string =>
    ({
      'asset.created': 'Asset registered',
      'asset.updated': 'Asset updated',
      'asset.archived': 'Asset archived',
      'asset.assigned': 'Asset assigned',
      'asset.returned': 'Asset returned',
      'asset.transferred': 'Asset transferred',
      'asset.status_changed': 'Status changed',
      'warranty.created': 'Warranty added',
      'warranty.updated': 'Warranty updated',
      'maintenance.record_created': 'Service recorded',
      'maintenance.plan_created': 'Maintenance plan created',
      'workspace.created': 'Workspace created',
      'workspace.updated': 'Workspace updated',
      'invite.accepted': 'Member joined',
      'invite.created': 'Invite created',
      'invite.revoked': 'Invite revoked',
      'member.role_changed': 'Role changed',
      'member.removed': 'Member removed',
      'category.created': 'Category added',
      'category.updated': 'Category updated',
      'location.created': 'Location created',
      'location.updated': 'Location updated',
      'vendor.created': 'Vendor added',
      'vendor.updated': 'Vendor updated',
      'document.uploaded': 'Document uploaded',
      'document.deleted': 'Document removed',
    })[action] ?? action.replace(/[._]/g, ' ');

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Overview"
        description="Inventory, upcoming warranties, maintenance, and recent activity."
      />

      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${canManageAudits ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}
      >
        <StatCard
          label="Total assets"
          value={stats.totalAssets ?? '—'}
          icon={Package}
          tone="accent"
          hint="In the registry"
        />
        <StatCard
          label="Warranties due"
          value={stats.warrantyDue ?? '—'}
          icon={ShieldCheck}
          tone="warning"
          hint="Expired or due within 90 days"
        />
        <StatCard
          label="Maintenance overdue"
          value={stats.maintenanceOverdue ?? '—'}
          icon={Wrench}
          tone="danger"
          hint="Past due date"
        />
        {canManageAudits && (
          <StatCard
            label="Open audits"
            value={stats.openAudits ?? '—'}
            icon={ClipboardCheck}
            tone="info"
            hint="Inventory counts in progress"
          />
        )}
      </div>
      {statsError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          Could not refresh some workspace totals. Reload to try again.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Every lifecycle change is appended to the audit log.</CardDescription>
          </CardHeader>
          <CardContent>
            {!canSeeAuditLog ? (
              <p className="text-sm leading-6 text-muted-foreground">
                Recent activity is visible to owners, admins and auditors. Your own custody trail lives on
                each asset's detail page.
              </p>
            ) : activityQuery.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading recent activity…
              </p>
            ) : activityQuery.isError ? (
              <p role="alert" className="text-sm text-danger">
                Could not load recent activity.
              </p>
            ) : recentActivity.length === 0 ? (
              <EmptyState
                icon={History}
                title="No activity yet"
                description="Create your first asset, assign it or move it — entries appear here the moment they happen."
              />
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {recentActivity.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2.5">
                    <span className="text-sm font-medium">{actionLabel(entry.action)}</span>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={entry.occurredAt}>
                      {entry.occurredAt ? new Date(entry.occurredAt).toLocaleString() : ''}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Workspace shortcuts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {WORKSPACE_LINKS.map((step) => (
                <li key={step.label}>
                  <Link
                    to={step.href}
                    className="group flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {step.label}
                        <ArrowRight
                          aria-hidden="true"
                          className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                        {step.description}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
