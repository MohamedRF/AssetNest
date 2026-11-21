import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Loader2, Plus, Wrench } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input, Select, Textarea } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog } from '../components/ui/dialog';
import { api, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { assetsApi } from '../lib/assets-api';
import { useToast } from '../components/ui/toast';

const CADENCES = ['monthly', 'quarterly', 'semiannual', 'yearly', 'once'] as const;
type Cadence = (typeof CADENCES)[number];

type DueState = 'disabled' | 'overdue' | 'due_7' | 'due_30' | 'scheduled';

interface PlanRow {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  title: string;
  cadence: Cadence;
  nextDueAt: string;
  enabled: boolean;
  dueState: DueState;
}

interface RecordRow {
  id: string;
  assetId: string;
  assetTag: string;
  performedAt: string;
  vendorName: string | null;
  cost: string | null;
  currency: string | null;
  notes: string | null;
}

const DUE_STYLE: Record<
  DueState,
  { label: string; variant: 'danger' | 'warning' | 'neutral' | 'success' | 'outline' }
> = {
  overdue: { label: 'Overdue', variant: 'danger' },
  due_7: { label: 'Due ≤ 7 days', variant: 'warning' },
  due_30: { label: 'Due ≤ 30 days', variant: 'neutral' },
  scheduled: { label: 'Scheduled', variant: 'success' },
  disabled: { label: 'Disabled', variant: 'outline' },
};

export function Maintenance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const canManage =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'manager';

  const [planOpen, setPlanOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState<Cadence>('quarterly');
  const [nextDueAt, setNextDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [recordPlan, setRecordPlan] = useState<PlanRow | null>(null);
  const [performedAt, setPerformedAt] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');

  const plansQuery = useQuery({
    queryKey: ['maintenance-plans', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ plans: PlanRow[] }>(`/workspaces/${workspaceId}/maintenance/plans`),
  });
  const recordsQuery = useQuery({
    queryKey: ['maintenance-records', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ records: RecordRow[] }>(`/workspaces/${workspaceId}/maintenance/records`),
  });
  const assetsQuery = useQuery({
    queryKey: ['assets-options', workspaceId],
    enabled: planOpen && workspaceId !== undefined,
    queryFn: () => assetsApi.list(workspaceId, { pageSize: 100 }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['maintenance-plans', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['maintenance-records', workspaceId] });
  };

  const createPlan = useMutation({
    mutationFn: () =>
      api.post(`/workspaces/${workspaceId}/maintenance/plans`, {
        assetId,
        title: title.trim(),
        cadence,
        nextDueAt,
      }),
    onSuccess: () => {
      toast({ title: 'Plan created', variant: 'success' });
      setPlanOpen(false);
      setTitle('');
      setCadence('quarterly');
      setNextDueAt('');
      setAssetId('');
      invalidate();
    },
    onError: (err) => setError(isApiError(err) ? err.detail : 'Could not create the plan.'),
  });

  const logService = useMutation({
    mutationFn: () =>
      api.post(`/workspaces/${workspaceId}/maintenance/records`, {
        assetId: recordPlan!.assetId,
        planId: recordPlan!.id,
        performedAt,
        ...(cost ? { cost, currency: 'INR' } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: () => {
      toast({ title: 'Service logged', variant: 'success' });
      setRecordPlan(null);
      setPerformedAt('');
      setCost('');
      setNotes('');
      invalidate();
    },
    onError: (err) =>
      toast({
        title: 'Could not log service',
        description: isApiError(err) ? err.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  const onCreatePlan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!assetId || !title.trim() || !nextDueAt) return;
    createPlan.mutate();
  };

  const onLogService = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!performedAt) return;
    logService.mutate();
  };

  if (!workspaceId) {
    return (
      <EmptyState
        icon={Wrench}
        title="Create a workspace first"
        description="Maintenance plans are scoped to a workspace. Set one up in Settings first."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  const plans = plansQuery.data?.plans ?? [];
  const records = recordsQuery.data?.records ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Maintenance"
        description="View scheduled maintenance and record completed service."
        actions={
          canManage ? (
            <Button onClick={() => setPlanOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add plan
            </Button>
          ) : undefined
        }
      />

      {(plansQuery.isError || recordsQuery.isError) && (
        <p role="alert" className="text-sm text-danger">
          Could not load all maintenance details.
        </p>
      )}
      {plansQuery.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading maintenance plans…
        </p>
      )}
      {plansQuery.isSuccess && plans.length === 0 && (
        <EmptyState
          icon={Wrench}
          title="No maintenance plans"
          description="Add a cadence for recurring work — AssetNest derives due dates and records completions against them."
          actionLabel={canManage ? 'Add first plan' : undefined}
          onAction={canManage ? () => setPlanOpen(true) : undefined}
        />
      )}
      {plans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plans</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {plans.map((plan) => {
                const style = DUE_STYLE[plan.dueState];
                return (
                  <li key={plan.id} className="flex flex-wrap items-center gap-3 py-3">
                    <Link
                      to={`/assets/${plan.assetId}`}
                      className="w-24 shrink-0 font-mono text-xs font-semibold text-accent hover:underline"
                    >
                      {plan.assetTag}
                    </Link>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{plan.title}</span>
                      <span className="block text-xs capitalize text-muted-foreground">
                        {plan.cadence} · next {new Date(plan.nextDueAt).toLocaleDateString()}
                      </span>
                    </span>
                    <Badge variant={style.variant}>{style.label}</Badge>
                    {canManage && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRecordPlan(plan);
                          setPerformedAt(today);
                        }}
                      >
                        Log service
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {records.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent service</CardTitle>
            <CardDescription>Up to 10 recent service records across all assets</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {records.slice(0, 10).map((record) => (
                <li key={record.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Link
                    to={`/assets/${record.assetId}`}
                    className="w-24 shrink-0 font-mono text-xs font-semibold text-accent hover:underline"
                  >
                    {record.assetTag}
                  </Link>
                  <span className="min-w-0 flex-1 text-sm">
                    {record.notes ?? 'Service recorded'}
                    {record.vendorName && (
                      <span className="block text-xs text-muted-foreground">by {record.vendorName}</span>
                    )}
                  </span>
                  {record.cost && (
                    <span className="text-xs text-muted-foreground">
                      {record.currency ?? ''} {record.cost}
                    </span>
                  )}
                  <time className="text-xs text-muted-foreground" dateTime={record.performedAt}>
                    {new Date(record.performedAt).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="Add maintenance plan"
        description="Cadence advances automatically each time you log service against the plan."
      >
        <form onSubmit={onCreatePlan} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-asset">Asset *</Label>
            <Select
              id="plan-asset"
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
            <Label htmlFor="plan-title">Title *</Label>
            <Input
              id="plan-title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Filter and belt inspection"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-cadence">Cadence *</Label>
              <Select
                id="plan-cadence"
                value={cadence}
                onChange={(event) => setCadence(event.target.value as Cadence)}
              >
                {CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-due">First due *</Label>
              <Input
                id="plan-due"
                type="date"
                required
                value={nextDueAt}
                onChange={(event) => setNextDueAt(event.target.value)}
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
            <Button variant="outline" onClick={() => setPlanOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createPlan.isPending || !assetId || !title.trim() || !nextDueAt}>
              {createPlan.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Create plan
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={recordPlan !== null}
        onClose={() => setRecordPlan(null)}
        title="Log service"
        description={
          recordPlan ? `${recordPlan.title} — the plan's next due date advances from the performed date.` : ''
        }
      >
        <form onSubmit={onLogService} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="record-performed">Performed on *</Label>
            <Input
              id="record-performed"
              type="date"
              required
              value={performedAt}
              onChange={(event) => setPerformedAt(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="record-cost">Cost (INR)</Label>
            <Input
              id="record-cost"
              inputMode="decimal"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              placeholder="1500.00"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="record-notes">Notes</Label>
            <Textarea
              id="record-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What was serviced, parts replaced…"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRecordPlan(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={logService.isPending || !performedAt}>
              {logService.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Log service
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
