import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowLeftRight, Check, ClipboardCheck, ScanSearch, X } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/ui/toast';
import { api, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { canAccessAuditSessions } from '../hooks/useAuditList';

interface AuditItem {
  id: string;
  assetId: string;
  assetTag: string;
  displayName: string;
  observation: 'unobserved' | 'present' | 'missing' | 'moved' | 'extra';
  observedAt: string | null;
  notes: string | null;
}

interface AuditDetail {
  id: string;
  label: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
  items: AuditItem[];
  counts: {
    total: number;
    unobserved: number;
    present: number;
    missing: number;
    moved: number;
    extra: number;
  };
}

const OBSERVATION_BADGE: Record<
  AuditItem['observation'],
  { label: string; variant: 'outline' | 'success' | 'warning' | 'danger' }
> = {
  unobserved: { label: 'Not counted', variant: 'outline' },
  present: { label: 'Present', variant: 'success' },
  missing: { label: 'Missing', variant: 'danger' },
  moved: { label: 'Moved', variant: 'warning' },
  extra: { label: 'Extra', variant: 'warning' },
};

export function AuditDetailPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const canManage = canAccessAuditSessions(workspace?.role);
  const [closeOpen, setCloseOpen] = useState(false);

  const auditQuery = useQuery({
    queryKey: ['audit', workspaceId, auditId],
    enabled: canManage && workspaceId !== undefined && auditId !== undefined,
    queryFn: () => api.get<AuditDetail>(`/workspaces/${workspaceId}/audits/${auditId}`),
  });

  const verify = useMutation({
    mutationFn: ({
      assetId,
      observation,
    }: {
      assetId: string;
      observation: 'present' | 'missing' | 'moved';
    }) => api.post(`/workspaces/${workspaceId}/audits/${auditId}/verify`, { assetId, observation }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audit', workspaceId, auditId] });
      void queryClient.invalidateQueries({ queryKey: ['audits', workspaceId] });
    },
    onError: (error) =>
      toast({
        title: 'Could not record observation',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  const close = useMutation({
    mutationFn: () => api.post(`/workspaces/${workspaceId}/audits/${auditId}/close`, {}),
    onSuccess: () => {
      toast({ title: 'Audit closed', variant: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['audit', workspaceId, auditId] });
      void queryClient.invalidateQueries({ queryKey: ['audits', workspaceId] });
    },
    onError: (error) =>
      toast({
        title: 'Could not close audit',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  if (!workspaceId) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Create a workspace first"
        description="Audits are scoped to a workspace."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Audit access required"
        description="Ask a workspace owner or admin for access to physical inventory audits."
      />
    );
  }

  const audit = auditQuery.data;
  const isOpen = audit?.status === 'open';
  const isMissing = isApiError(auditQuery.error) && auditQuery.error.status === 404;

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/audits"
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to audits
      </Link>

      {auditQuery.isLoading && (
        <p
          role="status"
          className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground"
        >
          Loading audit…
        </p>
      )}
      {auditQuery.isError && (
        <EmptyState
          icon={ClipboardCheck}
          title={isMissing ? 'Audit not found' : 'Could not load audit'}
          description={
            isMissing ? 'Check that the link belongs to your active workspace.' : 'Try again in a moment.'
          }
          actionLabel="Back to audits"
          actionHref="/audits"
        />
      )}

      {audit && (
        <>
          <PageHeader
            title={audit.label}
            description={`Opened ${new Date(audit.openedAt).toLocaleDateString()}${audit.closedAt ? ` · closed ${new Date(audit.closedAt).toLocaleDateString()}` : ''}`}
            actions={
              isOpen ? (
                <Button variant="danger" size="sm" onClick={() => setCloseOpen(true)}>
                  Close audit
                </Button>
              ) : (
                <Badge variant="success" className="uppercase">
                  Closed
                </Badge>
              )
            }
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Progress</CardTitle>
              <CardDescription>
                {audit.counts.present + audit.counts.missing + audit.counts.moved + audit.counts.extra} of{' '}
                {audit.counts.total} assets counted
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                role="progressbar"
                aria-valuenow={
                  audit.counts.present + audit.counts.missing + audit.counts.moved + audit.counts.extra
                }
                aria-valuemax={audit.counts.total}
                aria-valuemin={0}
                className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{
                    width:
                      audit.counts.total === 0
                        ? '0%'
                        : `${((audit.counts.present + audit.counts.missing + audit.counts.moved + audit.counts.extra) / audit.counts.total) * 100}%`,
                  }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge variant="success">{audit.counts.present} present</Badge>
                <Badge variant="danger">{audit.counts.missing} missing</Badge>
                <Badge variant="warning">{audit.counts.moved} moved</Badge>
                <Badge variant="warning">{audit.counts.extra} extra</Badge>
                <Badge variant="outline">{audit.counts.unobserved} not counted</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanSearch aria-hidden="true" className="h-4 w-4" />
                Asset checklist
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {audit.items.map((item) => {
                  const badge = OBSERVATION_BADGE[item.observation];
                  const pending = verify.isPending;
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <Link
                        to={`/assets/${item.assetId}`}
                        className="w-24 shrink-0 font-mono text-xs font-semibold text-accent hover:underline"
                      >
                        {item.assetTag}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-sm">{item.displayName}</span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {isOpen && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Mark ${item.assetTag} present`}
                            title="Present"
                            disabled={pending}
                            onClick={() => verify.mutate({ assetId: item.assetId, observation: 'present' })}
                            className="text-success"
                          >
                            <Check aria-hidden="true" className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Mark ${item.assetTag} moved`}
                            title="Moved"
                            disabled={pending}
                            onClick={() => verify.mutate({ assetId: item.assetId, observation: 'moved' })}
                            className="text-warning"
                          >
                            <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Mark ${item.assetTag} missing`}
                            title="Missing"
                            disabled={pending}
                            onClick={() => verify.mutate({ assetId: item.assetId, observation: 'missing' })}
                            className="text-danger"
                          >
                            <X aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {closeOpen && (
            <ConfirmDialog
              open
              onClose={() => setCloseOpen(false)}
              onConfirm={() => close.mutate()}
              title="Close this audit?"
              description="Closing finalizes the count and saves the results to audit history."
              confirmLabel="Close audit"
              tone="danger"
            />
          )}
        </>
      )}
    </div>
  );
}
