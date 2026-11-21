import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssetDetail } from '@assetnest/sdk';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useToast } from './ui/toast';
import { isApiError } from '../lib/api';
import { approvalRequestsKey, approvalRulesKey, approvalsApi, type ApprovalRule } from '../lib/approvals-api';
import { assetsApi } from '../lib/assets-api';

const LIFECYCLE_ACTIONS = [
  {
    action: 'asset.retire',
    to: 'retired',
    label: 'Retire',
    from: ['available', 'assigned', 'in_repair', 'lost'],
  },
  {
    action: 'asset.dispose',
    to: 'disposed',
    label: 'Dispose of',
    from: ['in_repair', 'lost', 'retired'],
  },
] as const satisfies ReadonlyArray<{
  action: ApprovalRule['action'];
  to: AssetDetail['status'];
  label: string;
  from: readonly AssetDetail['status'][];
}>;

type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export function AssetLifecycleActions({
  workspaceId,
  asset,
}: {
  workspaceId: string;
  asset: Pick<AssetDetail, 'id' | 'displayName' | 'status' | 'version'>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<LifecycleAction | null>(null);
  const actions = LIFECYCLE_ACTIONS.filter(({ from }: LifecycleAction) =>
    (from as readonly AssetDetail['status'][]).includes(asset.status),
  );

  const rulesKey = approvalRulesKey(workspaceId);
  const requestsKey = approvalRequestsKey(workspaceId);
  const rules = useQuery({
    queryKey: rulesKey,
    enabled: actions.length > 0,
    queryFn: () => approvalsApi.rules(workspaceId),
  });
  const hasRule = actions.some(({ action }) => rules.data?.rules.some((rule) => rule.action === action));
  const requests = useQuery({
    queryKey: [...requestsKey, asset.id],
    enabled: hasRule,
    queryFn: () => approvalsApi.requests(workspaceId, { resourceId: asset.id }),
  });

  const createRequest = useMutation({
    mutationFn: (action: LifecycleAction) =>
      approvalsApi.request(workspaceId, {
        action: action.action,
        resourceType: 'asset',
        resourceId: asset.id,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: requestsKey });
      toast({ title: 'Approval requested', variant: 'success' });
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: requestsKey });
      toast({
        title: 'Could not request approval',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const transition = useMutation({
    mutationFn: (action: LifecycleAction) =>
      assetsApi.transition(workspaceId, asset.id, { to: action.to, expectedVersion: asset.version }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['asset', workspaceId, asset.id], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset-history', workspaceId, asset.id] }),
        queryClient.invalidateQueries({ queryKey: ['assets', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: requestsKey }),
      ]);
      toast({ title: `Asset ${updated.status}`, variant: 'success' });
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ['asset', workspaceId, asset.id] });
      void queryClient.invalidateQueries({ queryKey: rulesKey });
      void queryClient.invalidateQueries({ queryKey: requestsKey });
      toast({
        title: 'Could not change the asset status',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  if (actions.length === 0) return null;
  const busy = transition.isPending || createRequest.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lifecycle actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rules.isError || (hasRule && requests.isError) ? (
          <p role="alert">Could not load approval requirements.</p>
        ) : rules.isPending || (hasRule && requests.isPending) ? (
          <p role="status">Loading approval requirements…</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {actions.map((action) => {
              const matching = (requests.data?.requests ?? []).filter(
                (request) =>
                  request.action === action.action &&
                  request.resourceType === 'asset' &&
                  request.resourceId === asset.id,
              );
              const approvalRequired = rules.data?.rules.some((rule) => rule.action === action.action);
              if (!approvalRequired || matching.some((request) => request.status === 'approved')) {
                return (
                  <Button
                    key={action.action}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirm(action)}
                  >
                    {action.label} asset
                  </Button>
                );
              }
              if (matching.some((request) => request.status === 'pending')) {
                return (
                  <Link key={action.action} to="/approvals" className="text-sm underline">
                    {action.to === 'retired' ? 'Retirement' : 'Disposal'} approval pending
                  </Link>
                );
              }
              return (
                <Button
                  key={action.action}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => createRequest.mutate(action)}
                >
                  Request {action.to === 'retired' ? 'retirement' : 'disposal'} approval
                </Button>
              );
            })}
          </div>
        )}
      </CardContent>
      {confirm && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          onConfirm={() => transition.mutate(confirm)}
          title={`${confirm.label} ${asset.displayName}?`}
          description={`This will mark the asset as ${confirm.to} and record the status change in its history.`}
          confirmLabel={`${confirm.label} asset`}
          tone="danger"
        />
      )}
    </Card>
  );
}
