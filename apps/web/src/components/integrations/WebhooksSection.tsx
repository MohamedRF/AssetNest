import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, RotateCcw, Send, Trash2, Webhook, ChevronDown, ChevronUp } from 'lucide-react';
import { api, isApiError } from '../../lib/api';
import { useToast } from '../ui/toast';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Dialog } from '../ui/dialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';

export const WEBHOOK_EVENT_KINDS = [
  'asset.created',
  'asset.updated',
  'asset.assigned',
  'asset.returned',
  'asset.transferred',
  'asset.status_changed',
  'asset.archived',
  'audit.opened',
  'audit.closed',
  'maintenance.record_created',
  'warranty.created',
] as const;

export interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  active: boolean;
  createdAt: string;
}

export interface DeliveryRow {
  id: string;
  eventId: string;
  kind: string;
  attempt: number;
  responseCode: number | null;
  status: 'pending' | 'delivered' | 'failed';
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

interface CreatedWebhook {
  id: string;
  url: string;
  secret: string;
}

function statusBadgeVariant(status: DeliveryRow['status']): 'success' | 'danger' | 'outline' {
  if (status === 'delivered') return 'success';
  if (status === 'failed') return 'danger';
  return 'outline';
}

function DeliveriesPanel({ workspaceId, webhookId }: { workspaceId: string; webhookId: string }) {
  const { toast } = useToast();
  const deliveriesQuery = useQuery({
    queryKey: ['webhook-deliveries', workspaceId, webhookId],
    queryFn: () =>
      api.get<{ deliveries: DeliveryRow[] }>(`/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries`),
    refetchInterval: 10_000,
  });

  const retryMutation = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; enqueued: number }>(
        `/workspaces/${workspaceId}/webhooks/${webhookId}/retry-failed`,
      ),
    onSuccess: (data) => {
      toast({
        title:
          data.enqueued === 0
            ? 'Nothing to retry'
            : `Re-enqueued ${data.enqueued} failed event${data.enqueued === 1 ? '' : 's'}`,
        variant: 'success',
      });
    },
    onError: (error) => {
      toast({
        title: 'Retry failed',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const deliveries = deliveriesQuery.data?.deliveries ?? [];
  const failedCount = deliveries.filter((delivery) => delivery.status === 'failed').length;

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {deliveriesQuery.isLoading
            ? 'Loading deliveries…'
            : `${deliveries.length} deliveries · ${failedCount} failed`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => retryMutation.mutate()}
          disabled={retryMutation.isPending || failedCount === 0}
        >
          {retryMutation.isPending ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          Retry failed
        </Button>
      </div>
      {deliveriesQuery.isError && <p className="mt-2 text-xs text-danger">Could not load deliveries.</p>}
      <ul className="mt-2 max-h-56 overflow-y-auto divide-y divide-border">
        {deliveries.map((delivery) => (
          <li key={delivery.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
            <Badge variant={statusBadgeVariant(delivery.status)} className="uppercase text-[10px]">
              {delivery.status}
            </Badge>
            <span className="font-mono">{delivery.kind}</span>
            <span className="text-muted-foreground">attempt {delivery.attempt}</span>
            {delivery.responseCode !== null && (
              <span className="text-muted-foreground">HTTP {delivery.responseCode}</span>
            )}
            <span className="text-muted-foreground">{new Date(delivery.createdAt).toLocaleString()}</span>
            {delivery.error && (
              <span className="w-full truncate text-danger" title={delivery.error}>
                {delivery.error}
              </span>
            )}
          </li>
        ))}
        {deliveries.length === 0 && !deliveriesQuery.isLoading && (
          <li className="py-2 text-xs text-muted-foreground">
            No deliveries yet. Use “Send test” to verify the pipeline.
          </li>
        )}
      </ul>
    </div>
  );
}

export function WebhooksSection({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const webhooksQuery = useQuery({
    queryKey: ['webhooks', workspaceId],
    queryFn: () => api.get<{ webhooks: WebhookRow[] }>(`/workspaces/${workspaceId}/webhooks`),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['webhooks', workspaceId] });

  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [eventTypes, setEventTypes] = useState<string[]>(['asset.created']);
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<CreatedWebhook>(`/workspaces/${workspaceId}/webhooks`, {
        url: url.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        eventTypes,
      }),
    onSuccess: (data) => {
      setCreated(data);
      setCreateOpen(false);
      setUrl('');
      setDescription('');
      setEventTypes(['asset.created']);
      setFormError(null);
      invalidate();
    },
    onError: (error) => {
      setFormError(isApiError(error) ? error.detail : 'Could not create the webhook.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ webhookId, ...body }: { webhookId: string; active?: boolean }) =>
      api.patch(`/workspaces/${workspaceId}/webhooks/${webhookId}`, body),
    onSuccess: invalidate,
    onError: (error) => {
      toast({
        title: 'Could not update webhook',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (webhookId: string) => api.delete(`/workspaces/${workspaceId}/webhooks/${webhookId}`),
    onSuccess: () => {
      toast({ title: 'Webhook deleted', variant: 'success' });
      invalidate();
    },
    onError: (error) => {
      toast({
        title: 'Could not delete webhook',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: (webhookId: string) =>
      api.post<{ ok: boolean; message: string }>(`/workspaces/${workspaceId}/webhooks/${webhookId}/test`),
    onSuccess: (data) => {
      toast({ title: data.message ?? 'Test delivery enqueued', variant: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', workspaceId] });
    },
    onError: (error) => {
      toast({
        title: 'Could not enqueue test delivery',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const toggleEvent = (kind: string) => {
    setEventTypes((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (eventTypes.length === 0) {
      setFormError('Choose at least one event type.');
      return;
    }
    setFormError(null);
    createMutation.mutate();
  };

  const webhooks = webhooksQuery.data?.webhooks ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Webhook className="h-4 w-4" /> Outbound webhooks
            </CardTitle>
            <CardDescription>
              Signed HTTPS callbacks (HMAC-SHA256) for workspace events. Delivered via the worker with
              retries; failures land in the deliveries ledger for one-click replay.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Add webhook
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {webhooksQuery.isLoading && <p className="text-sm text-muted-foreground">Loading webhooks…</p>}
        {webhooksQuery.isError && (
          <p className="text-sm text-danger">
            Could not load webhooks. You need the <code className="font-mono">integrations:manage</code>{' '}
            permission (owner or admin).
          </p>
        )}
        {!webhooksQuery.isLoading && !webhooksQuery.isError && webhooks.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No webhooks yet. Point n8n, Zapier or your own handler at workspace events.
          </p>
        )}
        <ul className="flex flex-col divide-y divide-border">
          {webhooks.map((webhook) => (
            <li key={webhook.id} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <span className="block max-w-full truncate font-mono text-xs" title={webhook.url}>
                    {webhook.url}
                  </span>
                  {webhook.description && (
                    <span className="block text-xs text-muted-foreground">{webhook.description}</span>
                  )}
                  <span className="mt-1 flex flex-wrap gap-1">
                    {webhook.eventTypes.map((kind) => (
                      <Badge key={kind} variant="outline" className="font-mono text-[10px] font-normal">
                        {kind}
                      </Badge>
                    ))}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={webhook.active}
                    aria-label={webhook.active ? 'Disable webhook' : 'Enable webhook'}
                    onClick={() => updateMutation.mutate({ webhookId: webhook.id, active: !webhook.active })}
                    className={`relative h-6 w-11 rounded-full transition-colors ${webhook.active ? 'bg-accent' : 'bg-border'}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${webhook.active ? 'left-5' : 'left-0.5'}`}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label="Send test delivery"
                    title="Send test delivery"
                    onClick={() => testMutation.mutate(webhook.id)}
                    disabled={testMutation.isPending}
                    className="rounded-md p-2 text-muted-foreground hover:bg-accent-subtle hover:text-foreground"
                  >
                    <Send aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => (current === webhook.id ? null : webhook.id))}
                    aria-expanded={expanded === webhook.id}
                    aria-label="Toggle deliveries ledger"
                    title="Deliveries (dead-letter ledger)"
                    className="rounded-md p-2 text-muted-foreground hover:bg-accent-subtle hover:text-foreground"
                  >
                    {expanded === webhook.id ? (
                      <ChevronUp aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <ChevronDown aria-hidden="true" className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete webhook"
                    title="Delete webhook"
                    onClick={() => setDeleteTarget(webhook)}
                    className="rounded-md p-2 text-muted-foreground hover:bg-danger-subtle hover:text-danger"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {expanded === webhook.id && (
                <DeliveriesPanel workspaceId={workspaceId} webhookId={webhook.id} />
              )}
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add outbound webhook"
        description="AssetNest POSTs signed JSON to this URL on the events you pick. The signing secret is shown once."
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="webhook-url">HTTPS endpoint</Label>
            <Input
              id="webhook-url"
              type="url"
              required
              autoComplete="off"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://hooks.example.com/assetnest"
            />
            <p className="text-xs text-muted-foreground">
              Must be publicly reachable. Private and loopback destinations are refused unless the deployment
              opts in explicitly.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="webhook-description">Description (optional)</Label>
            <Input
              id="webhook-description"
              autoComplete="off"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="n8n asset-sync flow"
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Events</legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {WEBHOOK_EVENT_KINDS.map((kind) => (
                <label
                  key={kind}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent-subtle"
                >
                  <input
                    type="checkbox"
                    checked={eventTypes.includes(kind)}
                    onChange={() => toggleEvent(kind)}
                    className="h-3.5 w-3.5 accent-current"
                  />
                  <span className="font-mono">{kind}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          <Button type="submit" disabled={createMutation.isPending} className="self-start">
            {createMutation.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Create webhook
          </Button>
        </form>
      </Dialog>

      {created && (
        <Dialog
          open
          onClose={() => {
            setCreated(null);
            setCopied(false);
          }}
          title="Webhook created"
          description="Copy the signing secret now — it is never shown again. Verify deliveries with the X-Assetnest-Signature header (t=timestamp,v1=HMAC-SHA256(timestamp.body))."
          footer={
            <Button
              onClick={() => {
                setCreated(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          }
        >
          <Label htmlFor="webhook-secret">Signing secret</Label>
          <div className="mt-1.5 flex gap-2">
            <Input id="webhook-secret" readOnly value={created.secret} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              aria-label="Copy secret"
              onClick={() => {
                void navigator.clipboard?.writeText(created.secret);
                setCopied(true);
              }}
            >
              {copied ? (
                <Check aria-hidden="true" className="h-4 w-4 text-success" />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" />
              )}
            </Button>
          </div>
        </Dialog>
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          title="Delete this webhook?"
          description="Deliveries stop immediately. The URL and signing secret are discarded; this cannot be undone."
          confirmLabel="Delete webhook"
          tone="danger"
        />
      )}
    </Card>
  );
}
