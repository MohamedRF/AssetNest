import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import type { OperationResult } from '@assetnest/sdk';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { api, isApiError } from '../lib/api';

type ChatDraft = OperationResult<'askAiAboutAssets'>;
type RoutePreview = OperationResult<'previewAiTaskRoute'>;

interface ChatTurn {
  question: string;
  answer: string | null;
  error: string | null;
}

function describeRoute(route: RoutePreview): string {
  const legs = [route.primary, route.fallback].filter((leg): leg is NonNullable<typeof leg> => leg !== null);
  if (legs.length === 0) return 'a configured AI provider';
  return legs
    .map((leg, index) => `${index === 0 ? '' : 'fallback '}${leg.connectionName} (${leg.modelLabel})`)
    .join(' or ');
}

/**
 * Read-only AI chat scoped to the supplied asset ids (P5-10).
 * The backend retrieves only the caller's visible records and the model is
 * instructed to treat them as untrusted data; mutations are never offered here.
 *
 * Before anything is sent, the card shows which primary/fallback provider will
 * receive the question and requires an explicit per-route confirmation. Pending
 * results are discarded if the workspace changes mid-flight.
 */
export function AiChatCard({ workspaceId, assetIds }: { workspaceId: string; assetIds: string[] }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [consentedRoute, setConsentedRoute] = useState<string | null>(null);
  const activeWorkspace = useRef(workspaceId);
  const scopeKey = assetIds.join(',');

  const preview = useQuery({
    queryKey: ['ai-route-preview', workspaceId, 'asset_chat'],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<RoutePreview>(`/workspaces/${workspaceId}/ai/tasks/asset_chat/preview`),
  });
  const route = preview.data;
  const available = route?.available === true;
  const routeKey = route?.routeKey ?? '';
  const consented = routeKey !== '' && consentedRoute === routeKey;

  // Discard any in-flight or pending UI state when the workspace or scope changes.
  useEffect(() => {
    activeWorkspace.current = workspaceId;
    setBusy(false);
    setQuestion('');
    setTurns([]);
    setConsentedRoute(null);
  }, [workspaceId, scopeKey]);

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy || assetIds.length === 0 || !available || !consented) return;
    const requestWorkspace = workspaceId;
    setBusy(true);
    setQuestion('');
    try {
      const result = await api.post<ChatDraft>(`/workspaces/${requestWorkspace}/ai/tasks/chat`, {
        question: text,
        assetIds,
        consent: true,
        routeKey,
      });
      if (requestWorkspace !== activeWorkspace.current) return; // workspace changed — discard
      setTurns((current) => [...current, { question: text, answer: result.draft.answer, error: null }]);
    } catch (error) {
      if (requestWorkspace !== activeWorkspace.current) return; // workspace changed — discard
      if (isApiError(error) && error.code === 'AI_ROUTE_CHANGED') {
        setConsentedRoute(null);
      }
      const detail = isApiError(error) ? error.detail : 'Could not reach the AI provider.';
      setTurns((current) => [...current, { question: text, answer: null, error: detail }]);
    } finally {
      if (requestWorkspace === activeWorkspace.current) setBusy(false);
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
