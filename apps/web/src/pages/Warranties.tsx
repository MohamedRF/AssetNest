import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Loader2, Plus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog } from '../components/ui/dialog';
import { api, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { assetsApi } from '../lib/assets-api';
import { useToast } from '../components/ui/toast';

type DerivedStatus = 'expired' | 'expiring_30' | 'expiring_90' | 'active';

interface WarrantyRow {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  provider: string;
  startsOn: string;
  expiresOn: string;
  details: string | null;
  derivedStatus: DerivedStatus;
}

const EXPIRY_STYLE: Record<
  DerivedStatus,
  { label: string; variant: 'success' | 'warning' | 'neutral' | 'danger' }
> = {
  active: { label: 'Active', variant: 'success' },
  expiring_90: { label: 'Expires < 90d', variant: 'neutral' },
  expiring_30: { label: 'Expires < 30d', variant: 'warning' },
  expired: { label: 'Expired', variant: 'danger' },
};

export function Warranties() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const canManage =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'manager';

  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [provider, setProvider] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [error, setError] = useState<string | null>(null);

  const warrantiesQuery = useQuery({
    queryKey: ['warranties', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ warranties: WarrantyRow[] }>(`/workspaces/${workspaceId}/warranties`),
  });

  const assetsQuery = useQuery({
    queryKey: ['assets-options', workspaceId],
    enabled: open && workspaceId !== undefined,
    queryFn: () => assetsApi.list(workspaceId, { pageSize: 100 }),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(`/workspaces/${workspaceId}/warranties`, {
        assetId,
        provider: provider.trim(),
        startsOn,
        expiresOn,
      }),
    onSuccess: () => {
      toast({ title: 'Warranty added', variant: 'success' });
      setOpen(false);
      setProvider('');
      setStartsOn('');
      setExpiresOn('');
      setAssetId('');
      void queryClient.invalidateQueries({ queryKey: ['warranties', workspaceId] });
    },
    onError: (err) => {
      setError(isApiError(err) ? err.detail : 'Could not add the warranty.');
    },
  });

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!assetId || !provider.trim() || !startsOn || !expiresOn) return;
    if (expiresOn < startsOn) {
      setError('Expiry date must be on or after the start date.');
      return;
    }
    create.mutate();
  };

  if (!workspaceId) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Create a workspace first"
        description="Warranties are scoped to a workspace. Set one up in Settings first."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  const warranties = warrantiesQuery.data?.warranties ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        demo={false}
        title="Warranties"
        description="Warranty coverage by asset — never let a claim lapse because nobody remembered the date."
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add warranty
            </Button>
          ) : undefined
        }
      />

      {warrantiesQuery.isLoading && (
        <p
          role="status"
          className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground"
        >
          Loading warranties…
        </p>
      )}
      {warrantiesQuery.isError && (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-subtle p-4 text-sm text-danger-subtle-foreground"
        >
          Could not load warranties. Is the API running?
        </p>
      )}
      {!warrantiesQuery.isLoading && warranties.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="No warranties recorded"
          description="Add the vendor, start and expiry date for an asset — AssetNest derives the expiry state for you."
          actionLabel={canManage ? 'Add first warranty' : undefined}
          onAction={canManage ? () => setOpen(true) : undefined}
        />
      )}
      {warranties.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coverage overview</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {warranties.map((warranty) => {
                const style = EXPIRY_STYLE[warranty.derivedStatus];
                return (
                  <li key={warranty.id} className="flex flex-wrap items-center gap-3 py-3">
                    <Link
                      to={`/assets/${warranty.assetId}`}
                      className="w-24 shrink-0 font-mono text-xs font-semibold text-accent hover:underline"
                    >
                      {warranty.assetTag}
                    </Link>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{warranty.provider}</span>
                      <span className="block text-xs text-muted-foreground">
                        {new Date(warranty.startsOn).toLocaleDateString()} →{' '}
                        {new Date(warranty.expiresOn).toLocaleDateString()}
                      </span>
                    </span>
                    <Badge variant={style.variant}>{style.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add warranty"
        description="Link coverage to an asset. Expiry state is derived automatically."
      >
        <form onSubmit={onCreate} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="warranty-asset">Asset *</Label>
            <Select
              id="warranty-asset"
              required
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
            >
              <option value="">Select asset…</option>
              {(assetsQuery.data?.items ?? []).map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.assetTag} — {asset.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="warranty-provider">Provider *</Label>
            <Input
              id="warranty-provider"
              required
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="e.g. Dell ProSupport"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="warranty-starts">Starts *</Label>
              <Input
                id="warranty-starts"
                type="date"
                required
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="warranty-expires">Expires *</Label>
              <Input
                id="warranty-expires"
                type="date"
                required
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
              />
            </div>
          </div>
          {error !== null && (
            <p role="alert" className="flex items-start gap-2 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || !assetId || !provider.trim() || !startsOn || !expiresOn}
            >
              {create.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Add warranty
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
