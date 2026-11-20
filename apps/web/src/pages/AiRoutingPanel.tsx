import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperationOptions, OperationResult } from '@assetnest/sdk';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, isApiError } from '../lib/api';

type Connection = OperationResult<'listAiConnections'>['connections'][number];
type ModelList = OperationResult<'listAiModels'>;
type Model = ModelList['models'][number];
type RouteList = OperationResult<'listAiRoutes'>;
type Route = RouteList['routes'][number];
type Task = Route['task'];

const taskLabels: Record<Task, string> = {
  invoice_extraction: 'Invoice extraction',
  image_tagging: 'Photo suggestions',
  natural_language_search: 'Inventory search',
  maintenance_assistant: 'Maintenance assistant',
  asset_chat: 'Asset questions',
};

function errorMessage(error: unknown): string {
  return isApiError(error) ? error.detail : 'The request failed. Please try again.';
}

function RouteEditor({
  task, route, models, save, remove, busy,
}: {
  task: Task;
  route: Route | undefined;
  models: Model[];
  save: (body: OperationOptions<'upsertAiRoute'>['body']) => Promise<void>;
  remove: () => Promise<void>;
  busy: boolean;
}) {
  const [primary, setPrimary] = useState(route?.modelId ?? '');
  const [fallback, setFallback] = useState(route?.fallbackModelId ?? '');
  const [timeout, setTimeout] = useState(route?.timeoutMs ?? 10_000);
  const [output, setOutput] = useState(route?.maxOutputTokens ?? 512);
  const [budget, setBudget] = useState(route?.dailyTokenBudget ?? 50_000);
  const [allowData, setAllowData] = useState(route?.allowProviderData ?? false);
  const options = models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({
      modelId: primary, fallbackModelId: fallback || null, timeoutMs: timeout,
      maxOutputTokens: output, dailyTokenBudget: budget, allowProviderData: allowData,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="ai-route-primary">Primary model</Label>
          <Select id="ai-route-primary" required value={primary} onChange={(event) => setPrimary(event.target.value)}>
            <option value="">Select model</option>{options}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-route-fallback">Fallback model</Label>
          <Select id="ai-route-fallback" value={fallback} onChange={(event) => setFallback(event.target.value)}>
            <option value="">None</option>{options}
          </Select>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="ai-route-timeout">Timeout (ms)</Label>
          <Input id="ai-route-timeout" type="number" min={1000} max={30000} required value={timeout}
            onChange={(event) => setTimeout(event.target.valueAsNumber || 0)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-route-output">Output tokens</Label>
          <Input id="ai-route-output" type="number" min={16} max={4096} required value={output}
            onChange={(event) => setOutput(event.target.valueAsNumber || 0)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-route-budget">Daily token budget</Label>
          <Input id="ai-route-budget" type="number" min={Math.max(32, output)} max={1000000} required value={budget}
            onChange={(event) => setBudget(event.target.valueAsNumber || 0)} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" type="checkbox" checked={allowData} onChange={(event) => setAllowData(event.target.checked)} />
        Allow workspace data to be sent to the selected providers for {taskLabels[task].toLowerCase()}.
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !primary || primary === fallback}>Save route</Button>
        {route && <Button type="button" variant="outline" disabled={busy} onClick={() => void remove()}>Clear route</Button>}
      </div>
    </form>
  );
}

export function AiRoutingPanel({ workspaceId, connections }: { workspaceId: string; connections: Connection[] }) {
  const base = `/workspaces/${encodeURIComponent(workspaceId)}/ai`;
  const queryClient = useQueryClient();
  const modelsKey = ['ai-models', workspaceId] as const;
  const routesKey = ['ai-routes', workspaceId] as const;
  const modelQuery = useQuery({ queryKey: modelsKey, queryFn: ({ signal }) => api.get<ModelList>(`${base}/models`, signal) });
  const routeQuery = useQuery({ queryKey: routesKey, queryFn: ({ signal }) => api.get<RouteList>(`${base}/routes`, signal) });
  const [connectionId, setConnectionId] = useState('');
  const [modelId, setModelId] = useState('');
  const [label, setLabel] = useState('');
  const [imageProbe, setImageProbe] = useState(false);
  const [task, setTask] = useState<Task>('natural_language_search');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const models = modelQuery.data?.models ?? [];
  const selectedRoute = routeQuery.data?.routes.find((route) => route.task === task);

  async function perform(operation: () => Promise<unknown>, saved: string, key: typeof modelsKey | typeof routesKey) {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await operation();
      await queryClient.invalidateQueries({ queryKey: key });
      setMessage({ text: saved });
    } catch (error) {
      setMessage({ error: true, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function addModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body: OperationOptions<'createAiModel'>['body'] = { connectionId, modelId: modelId.trim(), label: label.trim() };
    void perform(async () => {
      await api.post(`${base}/models`, body);
      setModelId('');
      setLabel('');
    }, 'Model saved', modelsKey);
  }

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Saved models</h3>
        {modelQuery.isError && <p role="alert" className="text-sm text-danger">{errorMessage(modelQuery.error)}</p>}
        <form onSubmit={addModel} className="grid items-end gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ai-model-connection">Connection</Label>
            <Select id="ai-model-connection" required value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              <option value="">Select connection</option>
              {connections.filter((connection) => connection.enabled).map((connection) => (
                <option key={connection.id} value={connection.id}>{connection.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ai-model-id">Provider model ID</Label>
            <Input id="ai-model-id" value={modelId} required maxLength={255} onChange={(event) => setModelId(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ai-model-label">Display name</Label>
            <Input id="ai-model-label" value={label} required maxLength={120} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <Button type="submit" disabled={busy || !modelId.trim() || !label.trim() || !connectionId}>Save model</Button>
        </form>
        {models.length > 0 && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={imageProbe} onChange={(event) => setImageProbe(event.target.checked)} />
              Include a synthetic image when testing
            </label>
            <p className="text-xs text-muted-foreground">Model tests send synthetic inputs and may use your provider quota.</p>
          </>
        )}
        {models.map((model) => (
          <div key={model.id} className="space-y-1 rounded-md border border-border p-2 text-sm">
            <p className="break-all font-medium">{model.label}</p>
            <dl className="grid gap-x-2 text-xs sm:grid-cols-2">
              {Object.entries(model.capabilities.features).map(([feature, state]) => (
                <div key={feature} className="flex justify-between gap-2">
                  <dt>{feature.replaceAll('_', ' ')}</dt><dd>{state}</dd>
                </div>
              ))}
            </dl>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(
              () => api.post(`${base}/models/${encodeURIComponent(model.id)}/test`, { probeImage: imageProbe }),
              'Model checks updated', modelsKey,
            )}>Test model</Button>
          </div>
        ))}
      </div>
      {models.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Task routes</h3>
          {routeQuery.isError && <p role="alert" className="text-sm text-danger">{errorMessage(routeQuery.error)}</p>}
          <Label htmlFor="ai-route-task">Task</Label>
          <Select id="ai-route-task" value={task} onChange={(event) => setTask(event.target.value as Task)}>
            {Object.entries(taskLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
          <RouteEditor key={`${task}:${selectedRoute?.updatedAt ?? ''}`} task={task} route={selectedRoute}
            models={models} busy={busy}
            save={(body) => perform(() => api.put(`${base}/routes/${task}`, body), 'Route saved', routesKey)}
            remove={() => perform(() => api.delete(`${base}/routes/${task}`), 'Route cleared', routesKey)} />
        </div>
      )}
      {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-sm text-danger' : 'text-sm'}>{message.text}</p>}
    </div>
  );
}
