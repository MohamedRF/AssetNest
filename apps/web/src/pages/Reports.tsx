import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Download, FilePlus2, Loader2, ShieldCheck, Wrench, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { api, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';

type ReportKind = 'assets' | 'warranties' | 'maintenance';

interface ExportRow {
  id: string;
  report: ReportKind;
  status: string;
  createdAt: string;
}

const REPORTS: ReadonlyArray<{
  kind: ReportKind;
  title: string;
  description: string;
  icon: typeof FileSpreadsheet;
}> = [
  {
    kind: 'assets',
    title: 'Asset register',
    description:
      'Tag, name, serial, status, condition, purchase, location, category, tags — everything with its workspace scoped.',
    icon: FileSpreadsheet,
  },
  {
    kind: 'warranties',
    title: 'Warranty coverage',
    description: 'Provider, start and expiry dates with a derived expired/active flag, ordered by expiry.',
    icon: ShieldCheck,
  },
  {
    kind: 'maintenance',
    title: 'Maintenance records',
    description: 'Service history with vendor, cost and currency — feeds your accountant at tax time.',
    icon: Wrench,
  },
];

export function Reports() {
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const exportsQuery = useQuery({
    queryKey: ['exports', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ exports: ExportRow[] }>(`/workspaces/${workspaceId}/exports`),
  });

  const generate = useMutation({
    mutationFn: (report: ReportKind) =>
      api.post<{ id: string; downloadUrl: string }>(`/workspaces/${workspaceId}/exports`, { report }),
    onSuccess: async (created) => {
      toast({ title: 'Report generated', description: 'Download started below.', variant: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['exports', workspaceId] });
      // Trigger the download immediately for convenience.
      const anchor = document.createElement('a');
      anchor.href = created.downloadUrl;
      anchor.download = 'assetnest-export.csv';
      anchor.click();
    },
    onError: (error) => {
      toast({
        title: 'Could not generate the report',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  if (!workspaceId) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Create a workspace first"
        description="Reports are workspace-scoped and never aggregate across tenants."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  const exports = exportsQuery.data?.exports ?? [];
  const canRead =
    workspace?.role === 'owner' ||
    workspace?.role === 'admin' ||
    workspace?.role === 'manager' ||
    workspace?.role === 'auditor';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        demo={false}
        title="Reports"
        description="Generate workspace-scoped CSV exports. Everything below is generated from live data and downloads immediately."
      />

      {!canRead ? (
        <p className="rounded-xl border border-warning/40 bg-warning-subtle p-4 text-sm text-warning-subtle-foreground">
          Your role can view assets but not run exports. Ask an auditor, manager, admin or owner.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {REPORTS.map((report) => (
            <Card key={report.kind}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <report.icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  {report.title}
                </CardTitle>
                <CardDescription>{report.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={generate.isPending}
                  onClick={() => generate.mutate(report.kind)}
                >
                  {generate.isPending ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <FilePlus2 aria-hidden="true" className="h-4 w-4" />
                  )}
                  Generate CSV
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent exports</CardTitle>
          <CardDescription>Most recent first — files are private to this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {exportsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading exports…</p>}
          {!exportsQuery.isLoading && exports.length === 0 && (
            <p className="text-sm text-muted-foreground">No exports yet. Generate one above.</p>
          )}
          <ul className="flex flex-col divide-y divide-border">
            {[...exports].reverse().map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <FileSpreadsheet aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {row.report} —{' '}
                  <span className="text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</span>
                </span>
                <Badge variant={row.status === 'completed' ? 'success' : 'warning'}>{row.status}</Badge>
                <a
                  href={`/api/v1/workspaces/${workspaceId}/exports/${row.id}/download`}
                  download
                  aria-label={`Download ${row.report} export`}
                  className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Download aria-hidden="true" className="h-4 w-4" />
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
