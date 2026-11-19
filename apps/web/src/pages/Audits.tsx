import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Loader2, Plus } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog } from '../components/ui/dialog';
import { api, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { useToast } from '../components/ui/toast';

interface AuditRow {
  id: string;
  label: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
}

interface LocationRow {
  id: string;
  name: string;
  path: string;
}

export function Audits() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const canManage =
    workspace?.role === 'owner' ||
    workspace?.role === 'admin' ||
    workspace?.role === 'manager' ||
    workspace?.role === 'auditor';

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const auditsQuery = useQuery({
    queryKey: ['audits', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ audits: AuditRow[] }>(`/workspaces/${workspaceId}/audits`),
  });

  const locationsQuery = useQuery({
    queryKey: ['locations', workspaceId],
    enabled: open && workspaceId !== undefined,
    queryFn: () => api.get<{ locations: LocationRow[] }>(`/workspaces/${workspaceId}/locations`),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(`/workspaces/${workspaceId}/audits`, {
        label: label.trim(),
        scope: locationId ? { locationId } : {},
      }),
    onSuccess: () => {
      toast({ title: 'Audit opened', variant: 'success' });
      setOpen(false);
      setLabel('');
      setLocationId('');
      void queryClient.invalidateQueries({ queryKey: ['audits', workspaceId] });
    },
    onError: (err) => setError(isApiError(err) ? err.detail : 'Could not open the audit.'),
  });

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!label.trim()) return;
    create.mutate();
  };

  if (!workspaceId) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Create a workspace first"
        description="Audits are scoped to a workspace. Set one up in Settings first."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  const audits = auditsQuery.data?.audits ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        demo={false}
        title="Audits"
        description="Physical inventory counts against the registry. Snapshot the scope at open, verify as you walk, close with a permanent record."
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              New audit
            </Button>
          ) : undefined
        }
      />

      {auditsQuery.isLoading && (
        <p
          role="status"
          className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground"
        >
          Loading audits…
        </p>
      )}
      {auditsQuery.isError && (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-subtle p-4 text-sm text-danger-subtle-foreground"
        >
          Could not load audits. Is the API running?
        </p>
      )}
      {!auditsQuery.isLoading && audits.length === 0 && (
        <EmptyState
          icon={ClipboardCheck}
          title="No audits yet"
          description="Open a location- or category-scoped audit — it snapshots every in-scope asset so discrepancies are explicit."
          actionLabel={canManage ? 'Open first audit' : undefined}
          onAction={canManage ? () => setOpen(true) : undefined}
        />
      )}
      {audits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Audit sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {audits.map((audit) => (
                <li key={audit.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Link
                    to={`/audits/${audit.id}`}
                    className="min-w-0 flex-1 text-sm font-medium text-accent hover:underline"
                  >
                    {audit.label}
                  </Link>
                  <Badge variant={audit.status === 'open' ? 'warning' : 'success'} className="uppercase">
                    {audit.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    opened {new Date(audit.openedAt).toLocaleDateString()}
                    {audit.closedAt ? ` · closed ${new Date(audit.closedAt).toLocaleDateString()}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New audit"
        description="Scope is snapshotted at open: every active asset in scope gets an audit row to verify."
      >
        <form onSubmit={onCreate} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-label">Label *</Label>
            <Input
              id="audit-label"
              required
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Q1 floor audit, annual server-room count"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-location">Location scope</Label>
            <Select
              id="audit-location"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">All locations (entire workspace)</option>
              {(locationsQuery.data?.locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.path}
                </option>
              ))}
            </Select>
          </div>
          {error !== null && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !label.trim()}>
              {create.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Open audit
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
