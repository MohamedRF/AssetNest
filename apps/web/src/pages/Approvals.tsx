import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { OperationOptions } from '@assetnest/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useToast } from '../components/ui/toast';
import { isApiError } from '../lib/api';
import { useAuth, type WorkspaceSummary } from '../lib/auth';
import {
  approvalsApi,
  approvalRequestsKey,
  approvalRulesKey,
  type ApprovalRequest,
  type ApprovalRule,
} from '../lib/approvals-api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';

const ACTIONS = [
  { value: 'asset.dispose', label: 'Dispose an asset' },
  { value: 'asset.retire', label: 'Retire an asset' },
] as const;

const APPROVER_ROLES = ['owner', 'admin', 'manager'] as const;

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  executed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

function RuleEditor({ rules, workspaceId }: { rules: ApprovalRule[]; workspaceId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ApprovalRule['action']>(ACTIONS[0].value);
  const [required, setRequired] = useState('1');
  const [roles, setRoles] = useState<ApprovalRule['approverRoles']>(['admin']);
  const [selfApproval, setSelfApproval] = useState(false);

  const save = useMutation({
    mutationFn: (next: ApprovalRule[]) => approvalsApi.setRules(workspaceId, { rules: next }),
    onSuccess: (result) => {
      queryClient.setQueryData(approvalRulesKey(workspaceId), result);
      toast({ title: 'Approval workflow saved', variant: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Could not save the workflow',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  const upsert = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rule: ApprovalRule = {
      action,
      requiredApprovals: Number(required),
      approverRoles: roles,
      selfApproval,
    };
    const next = [...rules.filter((existing) => existing.action !== rule.action), rule];
    save.mutate(next);
  };

  const toggleRole = (role: ApprovalRule['approverRoles'][number]) => {
    setRoles((current) =>
      current.includes(role) ? current.filter((value) => value !== role) : [...current, role],
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Approval rules</CardTitle>
        <CardDescription>
          Guard sensitive actions behind one or more approvals. A rule applies to every matching request in
          this workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rules.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {rules.map((rule) => (
              <li key={rule.action} className="flex flex-wrap items-center gap-2 py-2.5">
                <BadgeCheck aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {ACTIONS.find((entry) => entry.value === rule.action)?.label ?? rule.action}
                </span>
                <span className="text-xs text-muted-foreground">
                  {rule.requiredApprovals} approval{rule.requiredApprovals === 1 ? '' : 's'} ·{' '}
                  {rule.approverRoles.join(', ')}
                  {rule.selfApproval ? ' · self-approval allowed' : ''}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove rule for ${rule.action}`}
                  disabled={save.isPending}
                  onClick={() => save.mutate(rules.filter((existing) => existing.action !== rule.action))}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={upsert}
          className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="approval-action">Action</Label>
              <Select
                id="approval-action"
                value={action}
                onChange={(event) => {
                  const selection = ACTIONS.find((item) => item.value === event.target.value);
                  if (selection) setAction(selection.value);
                }}
              >
                {ACTIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="approval-count">Approvals required</Label>
              <Input
                id="approval-count"
                type="number"
                min={1}
                max={10}
                required
                value={required}
                onChange={(event) => setRequired(event.target.value)}
              />
            </div>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Eligible approvers</legend>
            <div className="flex flex-wrap gap-3">
              {APPROVER_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={() => toggleRole(role)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span className="capitalize">{role}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selfApproval}
              onChange={(event) => setSelfApproval(event.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Allow requesters to approve their own requests
          </label>
          <div>
            <Button type="submit" size="sm" disabled={save.isPending || roles.length === 0}>
              {save.isPending ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Plus aria-hidden="true" className="h-4 w-4" />
              )}
              Add or update rule
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RequestsCard({
  requests,
  workspaceId,
  role,
  actorId,
}: {
  requests: ApprovalRequest[];
  workspaceId: string;
  role: WorkspaceSummary['role'];
  actorId: string | undefined;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const decide = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: OperationOptions<'decideApprovalRequest'>['body']['decision'];
    }) => approvalsApi.decide(workspaceId, id, { decision }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: approvalRequestsKey(workspaceId) });
      toast({ title: 'Decision recorded', variant: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Could not record the decision',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => approvalsApi.cancel(workspaceId, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: approvalRequestsKey(workspaceId) });
      toast({ title: 'Request cancelled', variant: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Could not cancel the request',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Requests</CardTitle>
        <CardDescription>Pending and decided approval requests for this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approval requests yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {requests.map((request) => {
              const isRequester = actorId !== undefined && request.requestedBy === actorId;
              const canDecide =
                (role === 'owner' || role === 'admin' || role === 'manager') &&
                request.approverRoles.includes(role) &&
                (request.selfApproval || !isRequester) &&
                !request.decisions.some((decision) => decision.actorId === actorId);
              const canCancel = isRequester || role === 'owner' || role === 'admin';
              return (
                <li key={request.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {ACTIONS.find((entry) => entry.value === request.action)?.label ?? request.action}
                    </span>
                    <Badge variant={STATUS_VARIANT[request.status] ?? 'neutral'}>{request.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {request.resourceType === 'asset' && request.resourceId ? (
                        <Link to={`/assets/${encodeURIComponent(request.resourceId)}`} className="underline">
                          View asset {request.resourceId.slice(0, 8)}
                        </Link>
                      ) : (
                        request.resourceType
                      )}
                      {' · '}
                      {new Date(request.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {request.decisions.length}/{request.requiredApprovals} recorded · approvers:{' '}
                    {request.approverRoles.join(', ')}
                    {request.selfApproval ? ' · self-approval allowed' : ''}
                  </p>
                  {request.status === 'pending' && (
                    <div className="flex flex-wrap gap-2">
                      {canDecide && (
                        <>
                          <Button
                            size="sm"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: request.id, decision: 'approved' })}
                          >
                            <Check aria-hidden="true" className="h-4 w-4" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: request.id, decision: 'rejected' })}
                          >
                            <X aria-hidden="true" className="h-4 w-4" /> Reject
                          </Button>
                        </>
                      )}
                      {canCancel && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(request.id)}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function Approvals() {
  const { user } = useAuth();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const role = workspace?.role;
  const canRead = role === 'owner' || role === 'admin' || role === 'manager' || role === 'auditor';
  const canManage = role === 'owner' || role === 'admin';

  const rulesQuery = useQuery({
    queryKey: approvalRulesKey(workspaceId),
    enabled: canRead,
    queryFn: () => approvalsApi.rules(workspaceId),
  });

  const requestsQuery = useQuery({
    queryKey: approvalRequestsKey(workspaceId),
    enabled: canRead,
    queryFn: () => approvalsApi.requests(workspaceId),
  });

  const rules = rulesQuery.data?.rules ?? [];

  if (!workspaceId || !role) {
    return (
      <EmptyState
        icon={BadgeCheck}
        title="Create a workspace first"
        description="Approval workflows are configured per workspace."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        demo={false}
        title="Approvals"
        description="Route sensitive actions through configurable approval rules. Owners and admins define rules; eligible approvers decide."
      />
      {!canRead ? (
        <p>Your workspace role does not have access to approvals.</p>
      ) : rulesQuery.isError ? (
        <p role="alert">Could not load approval rules.</p>
      ) : rulesQuery.isPending ? (
        <p role="status">Loading approval rules�</p>
      ) : canManage ? (
        <RuleEditor key={workspaceId} rules={rules} workspaceId={workspaceId} />
      ) : (
        rules.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Approval rules</CardTitle>
              <CardDescription>Only owners and admins can change these rules.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {rules.map((rule) => (
                  <li key={rule.action} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                    <span className="font-medium">
                      {ACTIONS.find((entry) => entry.value === rule.action)?.label ?? rule.action}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {rule.requiredApprovals} approval{rule.requiredApprovals === 1 ? '' : 's'} ·{' '}
                      {rule.approverRoles.join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )
      )}
      {canRead &&
        (requestsQuery.isError ? (
          <p role="alert">Could not load approval requests.</p>
        ) : requestsQuery.isPending ? (
          <p role="status">Loading approval requests�</p>
        ) : (
          <RequestsCard
            key={workspaceId}
            requests={requestsQuery.data.requests}
            workspaceId={workspaceId}
            role={role}
            actorId={user?.id}
          />
        ))}
    </div>
  );
}
