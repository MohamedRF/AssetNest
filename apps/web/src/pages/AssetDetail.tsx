import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Archive, CalendarDays, CircleDollarSign, Hash, QrCode, Tag, Wrench } from 'lucide-react';
import type { AssetHistory } from '@assetnest/sdk';
import { AssetStatusBadge } from '../components/AssetStatusBadge';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { DocumentsCard } from '../components/DocumentsCard';
import { CustodyActions } from '../components/CustodyActions';
import { AiChatCard } from '../components/AiChatCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/ui/toast';
import { getApiBaseUrl, isApiError } from '../lib/api';
import { assetsApi } from '../lib/assets-api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';

type HistoryEvent = AssetHistory['events'][number];

export function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const [archiveOpen, setArchiveOpen] = useState(false);

  const canManage =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'manager';
  const canUseAi =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'manager';

  const assetQuery = useQuery({
    queryKey: ['asset', workspaceId, assetId],
    enabled: workspaceId !== undefined && assetId !== undefined,
    queryFn: () => assetsApi.get(workspaceId, assetId),
  });

  const historyQuery = useQuery({
    queryKey: ['asset-history', workspaceId, assetId],
    enabled: workspaceId !== undefined && assetId !== undefined,
    queryFn: () => assetsApi.history(workspaceId, assetId),
  });

  const archive = useMutation({
    mutationFn: () => assetsApi.archive(workspaceId, assetId),
    onSuccess: () => {
      toast({ title: 'Asset archived', variant: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['asset', workspaceId, assetId] });
      void queryClient.invalidateQueries({ queryKey: ['assets', workspaceId] });
    },
    onError: (error) =>
      toast({
        title: 'Could not archive',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  if (!assetId) {
    return (
      <EmptyState
        icon={QrCode}
        title="Missing asset"
        description="No asset id in the URL."
        actionLabel="Back to assets"
        actionHref="/assets"
      />
    );
  }

  const asset = assetQuery.data;
  const qrUrl = asset ? `${getApiBaseUrl()}/workspaces/${workspaceId}/assets/${asset.id}/qr` : undefined;

  const label = (event: HistoryEvent): string => {
    switch (event.action) {
      case 'asset.created':
        return 'Asset created';
      case 'asset.updated':
        return 'Details updated';
      case 'asset.status_changed':
        return 'Status changed';
      case 'asset.archived':
        return 'Asset archived';
      default:
        return event.action;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/assets"
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to assets
      </Link>

      {assetQuery.isLoading && (
        <p
          role="status"
          className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground"
        >
          Loading asset…
        </p>
      )}

      {assetQuery.isError && (
        <EmptyState
          icon={QrCode}
          title="Asset not found"
          description="It may have been removed, or the link points at a different workspace."
          actionLabel="Back to assets"
          actionHref="/assets"
        />
      )}

      {asset && (
        <>
          <PageHeader
            demo={false}
            title={asset.displayName}
            description={asset.assetTag}
            actions={
              canManage && asset.status !== 'archived' ? (
                <div className="flex flex-wrap items-center gap-2">
                  {workspaceId && (
                    <CustodyActions
                      workspaceId={workspaceId}
                      assetId={asset.id}
                      assetVersion={asset.version}
                      assetStatus={asset.status}
                    />
                  )}
                  <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
                    <Archive aria-hidden="true" className="h-4 w-4" />
                    Archive
                  </Button>
                </div>
              ) : undefined
            }
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-base">
                  <AssetStatusBadge status={asset.status} />
                  <span className="capitalize text-muted-foreground">{asset.condition} condition</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-2">
                    <Hash aria-hidden="true" className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <dt className="text-xs font-medium uppercase text-muted-foreground">Serial number</dt>
                      <dd className="mt-0.5 font-mono text-sm">{asset.serialNumber ?? '—'}</dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Wrench aria-hidden="true" className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <dt className="text-xs font-medium uppercase text-muted-foreground">
                        Lifecycle version
                      </dt>
                      <dd className="mt-0.5 text-sm">v{asset.version}</dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <dt className="text-xs font-medium uppercase text-muted-foreground">Purchased</dt>
                      <dd className="mt-0.5 text-sm">
                        {asset.purchasedAt ? new Date(asset.purchasedAt).toLocaleDateString() : '—'}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CircleDollarSign aria-hidden="true" className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <dt className="text-xs font-medium uppercase text-muted-foreground">Purchase price</dt>
                      <dd className="mt-0.5 text-sm">
                        {asset.amount ? `${asset.currency ?? ''} ${asset.amount}` : '—'}
                      </dd>
                    </div>
                  </div>
                </dl>

                {asset.notes && (
                  <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm leading-6">
                    {asset.notes}
                  </div>
                )}

                {asset.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <Tag aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                    {asset.tags.map((tag) => (
                      <Badge key={tag} variant="neutral">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <p className="mt-6 text-xs text-muted-foreground">
                  Created {new Date(asset.createdAt).toLocaleDateString()} · last updated{' '}
                  {new Date(asset.updatedAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <QrCode aria-hidden="true" className="h-4 w-4" />
                  Asset QR
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                {qrUrl && (
                  <img
                    src={qrUrl}
                    alt={`QR code for asset ${asset.assetTag}`}
                    width={160}
                    height={160}
                    className="rounded-lg border border-border bg-white p-2"
                  />
                )}
                <p className="text-center text-xs leading-5 text-muted-foreground">
                  Scan with the AssetNest app or paste <span className="font-mono">{asset.id}</span> into the
                  asset finder. The code never contains serials or personal data.
                </p>
              </CardContent>
            </Card>
          </div>

          {workspaceId && (
            <DocumentsCard workspaceId={workspaceId} assetId={asset.id} canManage={canManage} />
          )}

          {workspaceId && canUseAi && <AiChatCard workspaceId={workspaceId} assetIds={[asset.id]} />}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">History</CardTitle>
            </CardHeader>
            <CardContent>
              {historyQuery.isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
              {historyQuery.data && historyQuery.data.events.length === 0 && (
                <p className="text-sm text-muted-foreground">No events recorded yet.</p>
              )}
              <ol className="flex flex-col divide-y divide-border">
                {(historyQuery.data?.events ?? []).map((event) => (
                  <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div>
                      <p className="text-sm font-medium">{label(event)}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        correlation: {event.correlationId}
                      </p>
                    </div>
                    <time className="text-xs text-muted-foreground" dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <ConfirmDialog
            open={archiveOpen}
            onClose={() => setArchiveOpen(false)}
            onConfirm={() => archive.mutate()}
            title={`Archive ${asset.displayName}?`}
            description="Archived assets leave normal search but keep their history and documents. You can restore by transitioning status later if needed."
            confirmLabel="Archive asset"
            tone="danger"
          />
        </>
      )}
    </div>
  );
}
