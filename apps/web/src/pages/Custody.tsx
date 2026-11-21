import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UsersRound } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { api } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';

interface CustodyRow {
  assignmentId: string;
  assetId: string;
  assetTag: string;
  displayName: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  role: string;
  assignedAt: string;
  notes: string | null;
}

export function Custody() {
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;

  const custodyQuery = useQuery({
    queryKey: ['custody', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ assignments: CustodyRow[] }>(`/workspaces/${workspaceId}/custody`),
  });

  if (!workspaceId) {
    return (
      <EmptyState
        icon={UsersRound}
        title="Create a workspace first"
        description="Assignments are scoped to a workspace. Set one up in Settings first."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  const assignments = custodyQuery.data?.assignments ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Custody"
        description="Who holds what right now. Assign, return and transfer assets from an asset's detail page; history is immutable."
      />

      {custodyQuery.isLoading && (
        <p
          role="status"
          className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground"
        >
          Loading custody…
        </p>
      )}
      {custodyQuery.isError && (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-subtle p-4 text-sm text-danger-subtle-foreground"
        >
          Could not load custody. Try again in a moment.
        </p>
      )}
      {custodyQuery.isSuccess && assignments.length === 0 && (
        <EmptyState
          icon={UsersRound}
          title="Nothing assigned right now"
          description="Assign an asset to a teammate from the asset's detail page — it appears here with a custody record and history entry."
          actionLabel="Go to assets"
          actionHref="/assets"
        />
      )}
      {assignments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active assignments</CardTitle>
            <CardDescription>
              {assignments.length} {assignments.length === 1 ? 'asset' : 'assets'} out with people right now
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {assignments.map((row) => (
                <li key={row.assignmentId} className="flex flex-wrap items-center gap-3 py-3">
                  <Link
                    to={`/assets/${row.assetId}`}
                    className="w-24 shrink-0 font-mono text-xs font-semibold text-accent hover:underline"
                  >
                    {row.assetTag}
                  </Link>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.displayName}</span>
                    {row.notes && (
                      <span className="block truncate text-xs italic text-muted-foreground">{row.notes}</span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{row.memberName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.memberEmail}</span>
                  </span>
                  <Badge variant="outline" className="capitalize">
                    {row.role}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    since {new Date(row.assignedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
