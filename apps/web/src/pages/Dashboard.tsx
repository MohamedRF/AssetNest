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
import { Badge } from '../components/ui/badge';
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
  const { stats, isPlaceholder } = useDashboard();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Overview"
        description="A calm snapshot of what you own, what is due, and what needs attention."
        actions={
          isPlaceholder ? (
            <Badge variant="outline" title="Counts shown are derived placeholders until the API connects">
              Demo placeholders
            </Badge>
          ) : undefined
        }
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
          hint="In progress"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Assignments, movements, repairs and disposals show up here.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={History}
              title="No activity yet"
              description="Once assets start moving, every change is recorded in an append-only history. Activity entries appear here as soon as the API connects (Phase 1)."
            />
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
