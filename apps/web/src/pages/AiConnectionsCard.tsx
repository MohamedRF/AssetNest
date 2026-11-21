import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import type { OperationOptions, OperationResult } from '@assetnest/sdk';
import { api, isApiError } from '../lib/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AiRoutingPanel } from './AiRoutingPanel';

type ConnectionList = OperationResult<'listAiConnections'>;
type Connection = ConnectionList['connections'][number];
type CreateInput = OperationOptions<'createAiConnection'>['body'];
type UpdateInput = OperationOptions<'updateAiConnection'>['body'];
type ConnectionCheck = OperationResult<'testAiConnection'>;
type ProviderKind = Connection['kind'];

const providerLabels: Record<ProviderKind, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  openai_compatible: 'OpenAI-compatible API',
  ollama: 'Ollama',
};

function isCustom(kind: ProviderKind): kind is 'ollama' | 'openai_compatible' {
  return kind === 'ollama' || kind === 'openai_compatible';
}

function connectionPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/ai/connections`;
}

function displayError(error: unknown, fallback: string): string {
  return isApiError(error) ? error.detail : fallback;
}

function ConnectionEditor({
  workspaceId,
  connection,
  close,
  saved,
}: {
  workspaceId: string;
  connection: Connection | null;
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState(connection?.name ?? '');
  const [kind, setKind] = useState<ProviderKind>(connection?.kind ?? 'openai');
  const [endpoint, setEndpoint] = useState(connection?.endpoint ?? '');
  const [credential, setCredential] = useState('');
  const [forgetKey, setForgetKey] = useState(false);
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    const key = credential.trim();
    setCredential('');
    try {
      const common = { name: name.trim(), enabled };
      const path = connectionPath(workspaceId);
      if (connection) {
        const changes: UpdateInput = {
          ...common,
          ...(isCustom(kind) && { endpoint: endpoint.trim() }),
          ...(key ? { credential: key } : forgetKey ? { credential: null } : {}),
        };
        await api.patch(`${path}/${encodeURIComponent(connection.id)}`, changes);
      } else {
        const values: CreateInput = isCustom(kind)
          ? { ...common, kind, endpoint: endpoint.trim(), ...(key && { credential: key }) }
          : { ...common, kind, credential: key };
        await api.post(path, values);
      }
      saved();
      close();
    } catch (err) {
      setError(displayError(err, 'Could not save the connection.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) close();
      }}
      title={connection ? 'Edit AI connection' : 'Add AI connection'}
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div className="space-y-1">
          <Label htmlFor="ai-connection-name">Name</Label>
          <Input
            id="ai-connection-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-provider-kind">Provider</Label>
          <Select
            id="ai-provider-kind"
            value={kind}
            disabled={connection !== null}
            onChange={(event) => setKind(event.target.value as ProviderKind)}
          >
            {Object.entries(providerLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {isCustom(kind) && (
          <div className="space-y-1">
            <Label htmlFor="ai-provider-endpoint">Base URL</Label>
            <Input
              id="ai-provider-endpoint"
              type="url"
              required
              value={endpoint}
              maxLength={2048}
              placeholder={kind === 'ollama' ? 'http://ollama:11434' : 'https://provider.example/v1'}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="ai-provider-key">{connection?.hasCredential ? 'Replace API key' : 'API key'}</Label>
          <Input
            id="ai-provider-key"
            type="password"
            autoComplete="new-password"
            maxLength={4096}
            disabled={forgetKey}
            required={!isCustom(kind) && !connection?.hasCredential}
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
          />
          {connection?.hasCredential && (
            <p className="text-xs text-muted-foreground">A key is stored. Leave blank to keep it.</p>
          )}
        </div>
        {isCustom(kind) && connection?.hasCredential && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={forgetKey}
              onChange={(event) => {
                setForgetKey(event.target.checked);
                setCredential('');
              }}
            />
            Remove stored API key
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Connection enabled
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            Save connection
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AiConnectionsCard({
  workspaceId,
  canConfigure,
}: {
  workspaceId: string | undefined;
  canConfigure: boolean;
}) {
  const queryClient = useQueryClient();
  const cacheKey = ['ai-connections', workspaceId] as const;
  const [editor, setEditor] = useState<Connection | null | undefined>();
  const [deleting, setDeleting] = useState<Connection>();
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<{
    bad?: boolean;
    message: string;
    models?: ConnectionCheck['models'];
  }>();
  const connections = useQuery({
    queryKey: cacheKey,
    enabled: Boolean(workspaceId && canConfigure),
    retry: false,
    queryFn: ({ signal }) => api.get<ConnectionList>(connectionPath(workspaceId!), signal),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: cacheKey });
  const disabled = isApiError(connections.error) && connections.error.code === 'AI_DISABLED';

  async function test(connection: Connection) {
    if (!workspaceId || busy) return;
    setBusy(connection.id);
    setStatus(undefined);
    try {
      const response = await api.post<ConnectionCheck>(
        `${connectionPath(workspaceId)}/${encodeURIComponent(connection.id)}/test`,
      );
      setStatus({ message: `${connection.name} connected`, models: response.models });
    } catch (error) {
      setStatus({ bad: true, message: displayError(error, 'Could not test the connection.') });
    } finally {
      setBusy(undefined);
    }
  }

  async function remove(connection: Connection) {
    if (!workspaceId || busy) return;
    setBusy(connection.id);
    setStatus(undefined);
    try {
      await api.delete(`${connectionPath(workspaceId)}/${encodeURIComponent(connection.id)}`);
      refresh();
    } catch (error) {
      setStatus({ bad: true, message: displayError(error, 'Could not remove the connection.') });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <Sparkles aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div className="space-y-1">
          <CardTitle>AI connections</CardTitle>
          <CardDescription>
            Connect a provider using API access. Consumer subscriptions may require a separate API key.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!workspaceId && (
          <p className="text-sm text-muted-foreground">Select a workspace to configure providers.</p>
        )}
        {workspaceId && !canConfigure && (
          <p className="text-sm text-muted-foreground">Workspace owners and admins can manage connections.</p>
        )}
        {disabled && <p className="text-sm text-muted-foreground">AI is disabled on this deployment.</p>}
        {connections.isFetching && !connections.data && (
          <p role="status" className="text-sm">
            Loading connections…
          </p>
        )}
        {connections.isError && !disabled && (
          <p role="alert" className="text-sm text-danger">
            {displayError(connections.error, 'Could not load connections.')}
          </p>
        )}
        {connections.data && (
          <>
            {connections.data.connections.length === 0 && (
              <p className="text-sm text-muted-foreground">No connections yet.</p>
            )}
            <ul className="space-y-2">
              {connections.data.connections.map((connection) => (
                <li key={connection.id} className="rounded-md border border-border p-3 space-y-2">
                  <div className="break-words text-sm">
                    <strong>{connection.name}</strong>
                    <p className="text-xs text-muted-foreground">
                      {providerLabels[connection.kind]} · {connection.enabled ? 'Enabled' : 'Disabled'} ·{' '}
                      {connection.hasCredential ? 'API key stored' : 'No API key'}
                    </p>
                    {connection.endpoint && (
                      <p className="break-all text-xs text-muted-foreground">{connection.endpoint}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!connection.enabled || !!busy}
                      onClick={() => void test(connection)}
                    >
                      Test connection
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => setEditor(connection)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => setDeleting(connection)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <Button onClick={() => setEditor(null)}>Add connection</Button>
            {workspaceId && connections.data.connections.length > 0 && (
              <AiRoutingPanel workspaceId={workspaceId} connections={connections.data.connections} />
            )}
          </>
        )}
        {status && (
          <div
            role={status.bad ? 'alert' : 'status'}
            className={status.bad ? 'text-sm text-danger' : 'text-sm'}
          >
            <p>{status.message}</p>
            {status.models?.length === 0 && <p>No models were returned.</p>}
            {status.models && status.models.length > 0 && (
              <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-muted-foreground">
                {status.models.map((model) => (
                  <li key={model.id}>{model.label}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
      {workspaceId && editor !== undefined && (
        <ConnectionEditor
          workspaceId={workspaceId}
          connection={editor}
          close={() => setEditor(undefined)}
          saved={refresh}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          title="Remove AI connection"
          description={`Remove ${deleting.name} and its stored API key?`}
          confirmLabel="Remove connection"
          onClose={() => setDeleting(undefined)}
          onConfirm={() => void remove(deleting)}
        />
      )}
    </Card>
  );
}
