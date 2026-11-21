import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  History,
  Package,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useDashboard } from '../hooks/useDashboard';

const GETTING_STARTED_STEPS = [
  {
    label: 'Create your workspace',
    description: 'Set the workspace name, mode (home or office) and default currency.',
    href: '/settings',
  },
  {
    label: 'Add your first location',
    description: 'Model the real world — building, floor, room or storage spot.',
    href: '/locations',
  },
  {
    label: 'Add your first asset',
    description: 'Tag it, capture the serial and get it into the registry.',
    href: '/assets/new',
  },
] as const;

export function Dashboard() {
  const { stats, recentActivity, canSeeAuditLog } = useDashboard();

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
    })[action] ?? action;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Overview"
        demo={false}
        description="A calm snapshot of what you own, what is due, and what needs attention."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total assets"
          value={stats.totalAssets}
          icon={Package}
          tone="accent"
          hint="In the registry"
        />
        <StatCard
          label="Warranty due"
          value={stats.warrantyDue}
          icon={ShieldCheck}
          tone="warning"
          hint="Expiring soon"
        />
        <StatCard
          label="Maintenance overdue"
          value={stats.maintenanceOverdue}
          icon={Wrench}
          tone="danger"
          hint="Past due date"
        />
        <StatCard
          label="Open audits"
          value={stats.openAudits}
          icon={ClipboardCheck}
          tone="info"
          hint="Arrives with audits (Phase 3)"
        />
      </div>

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
            <CardTitle>Get started with AssetNest</CardTitle>
            <CardDescription>Three steps from an empty workspace to a first tagged asset.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col">
              {GETTING_STARTED_STEPS.map((step, index) => (
                <li key={step.label}>
                  <Link
                    to={step.href}
                    className="group flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground group-hover:border-accent group-hover:text-accent"
                    >
                      {index + 1}
                    </span>
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
            </ol>
            <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-success" />
              Checklist progress appears here once your workspace is connected.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
