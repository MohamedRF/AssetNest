import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Sparkles } from 'lucide-react';
import type { AgUiEvent } from '@assetnest/contracts';
import type { OperationResult } from '@assetnest/sdk';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { api, isApiError, streamAiAssetChat } from '../lib/api';

type RoutePreview = OperationResult<'previewAiTaskRoute'>;

interface ChatTurn {
  question: string;
  answer: string | null;
  error: string | null;
}

interface ActiveStep {
  name: string;
  status: 'running' | 'done';
}

interface ActiveTurn {
  question: string;
  steps: ActiveStep[];
  answer: string;
}

/** Human-readable labels for the AG-UI step names the server emits. */
const STEP_LABELS: Record<string, string> = {
  retrieve_asset_context: 'Reading this asset’s record…',
  generate_response: 'Asking the AI provider…',
};

function stepLabel(name: string): string {
  return STEP_LABELS[name] ?? name;
}

function describeRoute(route: RoutePreview): string {
  const legs = [route.primary, route.fallback].filter((leg): leg is NonNullable<typeof leg> => leg !== null);
  if (legs.length === 0) return 'a configured AI provider';
  return legs
    .map((leg, index) => `${index === 0 ? '' : 'fallback '}${leg.connectionName} (${leg.modelLabel})`)
    .join(' or ');
}

/**
 * Read-only AI chat scoped to the supplied asset ids (P5-10, AG-UI pilot).
 * The backend retrieves only the caller's visible records and the model is
 * instructed to treat them as untrusted data; mutations are never offered here.
 *
 * Before anything is sent, the card shows which primary/fallback provider will
 * receive the question and requires an explicit per-route confirmation. The
 * answer arrives as an AG-UI server-sent event stream: progress steps for the
 * real work (retrieving the authorized asset context, generating the response),
 * then the validated answer. The stream is aborted on navigation or workspace
 * change, stale events are ignored, and a failed/disconnected run leaves the
 * card usable. A request is never replayed automatically (that could incur
 * model cost).
 */
export function AiChatCard({ workspaceId, assetIds }: { workspaceId: string; assetIds: string[] }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [active, setActive] = useState<ActiveTurn | null>(null);
  const [consentedRoute, setConsentedRoute] = useState<string | null>(null);
  const activeWorkspace = useRef(workspaceId);
  // Monotonic request sequence + current abort controller: stale-event guard.
  const requestSeq = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  // Mirror of `active` so the async event handler can read the latest value.
  const activeRef = useRef<ActiveTurn | null>(null);
  const scopeKey = assetIds.join(',');

  const updateActive = (next: ActiveTurn | null | ((prev: ActiveTurn | null) => ActiveTurn | null)) => {
    const resolved = typeof next === 'function' ? next(activeRef.current) : next;
    activeRef.current = resolved;
    setActive(resolved);
  };

  const preview = useQuery({
    queryKey: ['ai-route-preview', workspaceId, 'asset_chat'],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<RoutePreview>(`/workspaces/${workspaceId}/ai/tasks/asset_chat/preview`),
  });
  const route = preview.data;
  const available = route?.available === true;
  const routeKey = route?.routeKey ?? '';
  const routeReady = !preview.isFetching && !preview.isRefetchError;
  const consented = routeReady && routeKey !== '' && consentedRoute === routeKey;

  // Discard any in-flight or pending UI state when the workspace or scope
  // changes, and abort any open stream so it cannot touch the new context.
  useEffect(() => {
    activeWorkspace.current = workspaceId;
    requestSeq.current += 1; // invalidate in-flight handlers
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setQuestion('');
    setTurns([]);
    setActive(null);
    activeRef.current = null;
    setConsentedRoute(null);
  }, [workspaceId, scopeKey]);

  // Abort an open stream on unmount (navigation away from the card).
  useEffect(() => {
    return () => {
      requestSeq.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy || assetIds.length === 0 || !available || !consented) return;

    const requestWorkspace = workspaceId;
    const seq = ++requestSeq.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () =>
      !controller.signal.aborted &&
      requestWorkspace === activeWorkspace.current &&
      seq === requestSeq.current;

    setBusy(true);
    setQuestion('');
    updateActive({ question: text, steps: [], answer: '' });

    const finalizeSuccess = (answer: string) => {
      setTurns((current) => [...current, { question: text, answer, error: null }]);
      updateActive(null);
    };
    const finalizeError = (detail: string) => {
      setTurns((current) => [...current, { question: text, answer: null, error: detail }]);
      updateActive(null);
    };
    const refreshRoute = () => {
      setConsentedRoute(null);
      void preview.refetch();
    };

    let terminated = false;

    const applyEvent = (event: AgUiEvent) => {
      if (terminated || !isCurrent()) return;
      switch (event.type) {
        case 'STEP_STARTED':
          updateActive((prev) =>
            prev ? { ...prev, steps: [...prev.steps, { name: event.stepName, status: 'running' }] } : prev,
          );
          break;
        case 'STEP_FINISHED':
          updateActive((prev) =>
            prev
              ? {
                  ...prev,
                  steps: prev.steps.map((step) =>
                    step.name === event.stepName ? { ...step, status: 'done' } : step,
                  ),
                }
              : prev,
          );
          break;
        case 'TEXT_MESSAGE_CONTENT':
          updateActive((prev) => (prev ? { ...prev, answer: prev.answer + event.delta } : prev));
          break;
        case 'RUN_FINISHED':
          terminated = true;
          finalizeSuccess(activeRef.current?.answer ?? '');
          break;
        case 'RUN_ERROR':
          terminated = true;
          if (event.code === 'AI_ROUTE_CHANGED') refreshRoute();
          finalizeError(event.message || 'The AI provider could not complete this request.');
          break;
        default:
          // RUN_STARTED, TEXT_MESSAGE_START, TEXT_MESSAGE_END: no UI change needed.
          break;
      }
    };

    try {
      await streamAiAssetChat(
        requestWorkspace,
        { question: text, assetIds, consent: true, routeKey },
        applyEvent,
        controller.signal,
      );
      // Stream closed without a terminal event (e.g. server/proxy cut the
      // connection). Leave the card usable rather than stuck on a spinner.
      if (!terminated && isCurrent()) {
        finalizeError('The response stream ended before the answer was complete. Please try again.');
      }
    } catch (error) {
      if (terminated || !isCurrent()) return;
      if (isApiError(error) && error.code === 'AI_ROUTE_CHANGED') refreshRoute();
      const detail = isApiError(error) ? error.detail : 'Could not reach the AI provider.';
      finalizeError(detail);
    } finally {
      if (seq === requestSeq.current && requestWorkspace === activeWorkspace.current) setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <Sparkles aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div className="space-y-1">
          <CardTitle>Ask about this asset</CardTitle>
          <CardDescription>
            Answers use only this asset’s record. AI is optional and read-only — it never changes your
            inventory.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!available && (
          <p className="text-sm text-muted-foreground">
            AI is not configured for this workspace yet. An owner or admin can add a provider under Settings →
            AI.
          </p>
        )}
        {turns.length > 0 && (
          <ol className="flex flex-col gap-2">
            {turns.map((turn, index) => (
              <li key={index} className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{turn.question}</p>
                {turn.answer ? (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{turn.answer}</p>
                ) : (
                  <p role="alert" className="mt-1 text-danger">
                    {turn.error}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        {active && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm" aria-live="polite">
            <p className="font-medium">{active.question}</p>
            {active.steps.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                {active.steps.map((step, index) => (
                  <li key={`${step.name}-${index}`} className="flex items-center gap-1.5">
                    {step.status === 'done' ? (
                      <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-accent" />
                    )}
                    <span>{stepLabel(step.name)}</span>
                  </li>
                ))}
              </ul>
            )}
            {active.answer && (
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{active.answer}</p>
            )}
          </div>
        )}
        {available && (
          <>
            <p className="rounded-lg border border-accent/30 bg-accent-subtle/40 p-2.5 text-xs text-muted-foreground">
              Your question and this asset’s record will be sent to{' '}
              <span className="font-medium text-foreground">{describeRoute(route)}</span>. AI is optional.
            </p>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-border"
                checked={consented}
                disabled={!routeReady}
                onChange={(event) => setConsentedRoute(event.target.checked ? routeKey : null)}
              />
              <span>I understand my question will be shared with the provider above.</span>
            </label>
          </>
        )}
        <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. When is the next service due?"
            aria-label="Question about this asset"
            disabled={busy || !available}
            className="h-10"
          />
          <Button type="submit" size="sm" disabled={busy || !available || !consented || !question.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
