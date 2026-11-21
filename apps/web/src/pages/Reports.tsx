import type { OperationOptions, OperationResult } from '@assetnest/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Download, FilePlus2, Loader2, ShieldCheck, Wrench, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { api, getApiBaseUrl, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';

type ReportKind = OperationOptions<'createExport'>['body']['report'];

const REPORTS: ReadonlyArray<{
  kind: ReportKind;
  title: string;
  description: string;
  icon: typeof FileSpreadsheet;
}> = [
  {
    kind: 'assets',
    title: 'Asset register',
    description: 'Asset tags, serial numbers, status, condition, locations, and purchase details.',
    icon: FileSpreadsheet,
  },
  {
    kind: 'warranties',
    title: 'Warranty coverage',
    description: 'Warranty providers, coverage dates, and expiry status.',
    icon: ShieldCheck,
  },
  {
    kind: 'maintenance',
    title: 'Maintenance records',
    description: 'Service history with vendor, cost, and currency.',
    icon: Wrench,
  },
];

export function Reports() {
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Effective permission for report/export access in this workspace. Members
  // (and anyone without reports:read) must not fetch or see export metadata.
  const canRead =
    workspace?.role === 'owner' ||
    workspace?.role === 'admin' ||
    workspace?.role === 'manager' ||
    workspace?.role === 'auditor';

  const exportsQuery = useQuery({
    queryKey: ['exports', workspaceId],
    enabled: canRead && workspaceId !== undefined,
    queryFn: () => api.get<OperationResult<'listExports'>>(`/workspaces/${workspaceId}/exports`),
  });

  const exportsEnabled = exportsQuery.data?.policy?.enabled ?? true;
  const exportMaxAgeDays = exportsQuery.data?.policy?.maxAgeDays ?? null;

  const generate = useMutation({
    mutationFn: (report: ReportKind) =>
      api.post<OperationResult<'createExport'>>(`/workspaces/${workspaceId}/exports`, { report }),
    onSuccess: async (created) => {
      toast({ title: 'Report generated', description: 'Your download has started.', variant: 'success' });
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" description="Generate and download CSV reports for this workspace." />

      {!canRead ? (
        <p className="rounded-xl border border-warning/40 bg-warning-subtle p-4 text-sm text-warning-subtle-foreground">
          Your role can view assets but not run exports. Ask an auditor, manager, admin or owner.
        </p>
      ) : exportsQuery.isError ? (
        <p role="alert">Could not load the workspace export policy.</p>
      ) : exportsQuery.isPending ? (
        <p role="status">Loading the workspace export policy…</p>
      ) : !exportsEnabled ? (
        <p className="rounded-xl border border-warning/40 bg-warning-subtle p-4 text-sm text-warning-subtle-foreground">
          Exports are turned off by this workspace’s export policy. An owner or admin can re-enable them in
          Settings.
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

      {canRead && exportsQuery.isSuccess && exportsEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent exports</CardTitle>
            <CardDescription>
              Most recent first — files are private to this workspace.
              {exportMaxAgeDays !== null
                ? ` Files older than ${exportMaxAgeDays} day${exportMaxAgeDays === 1 ? '' : 's'} are hidden and cannot be downloaded.`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {exports.length === 0 && (
              <p className="text-sm text-muted-foreground">No exports yet. Generate one above.</p>
            )}
            <ul className="flex flex-col divide-y divide-border">
              {exports.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <FileSpreadsheet aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {row.report} —{' '}
                    <span className="text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</span>
                  </span>
                  <Badge variant={row.status === 'completed' ? 'success' : 'warning'}>{row.status}</Badge>
                  {row.status === 'completed' && (
                    <a
                      href={`${getApiBaseUrl()}/workspaces/${workspaceId}/exports/${row.id}/download`}
                      download
                      aria-label={`Download ${row.report} export`}
                      className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Download aria-hidden="true" className="h-4 w-4" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
