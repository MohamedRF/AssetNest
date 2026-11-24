import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiChatCard } from './AiChatCard';

const workspaceId = 'ws-1';
const assetId = '11111111-1111-4111-8111-111111111111';

const routePreview = {
  task: 'asset_chat',
  available: true,
  consentRequired: true,
  routeKey: 'model-1|',
  primary: { connectionName: 'Provider', providerKind: 'openai', modelLabel: 'Model' },
  fallback: null,
};

const encoder = new TextEncoder();
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

function closedSseResponse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function controlledSse() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    response: () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push(event: unknown) {
      controller.enqueue(encoder.encode(frame(event)));
    },
    close() {
      controller.close();
    },
  };
}

function wrap(ui: React.ReactElement, client: QueryClient) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function setupFetch(streamHandler: (init: RequestInit) => Response, getRoutePreview = () => routePreview) {
  const captured: { signal?: AbortSignal | null } = {};
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'https://assetnest.test');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && url.pathname.endsWith('/ai/tasks/asset_chat/preview')) {
      return Promise.resolve(Response.json(getRoutePreview()));
    }
    if (method === 'POST' && url.pathname.endsWith('/ai/tasks/chat/stream')) {
      captured.signal = init?.signal ?? null;
      return Promise.resolve(streamHandler(init ?? {}));
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return captured;
}

async function openCard(client: QueryClient, ws = workspaceId) {
  const user = userEvent.setup();
  const view = render(wrap(<AiChatCard workspaceId={ws} assetIds={[assetId]} />, client));
  // Consent checkbox appears only once the route preview reports available.
  const checkbox = await screen.findByRole('checkbox');
  await user.click(checkbox);
  const input = screen.getByRole('textbox', { name: 'Question about this asset' });
  await user.type(input, 'What is the status?');
  return { user, view, input };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AiChatCard AG-UI streaming', () => {
  it('shows progress steps for real work, then the validated answer', async () => {
    const sse = controlledSse();
    setupFetch(() => sse.response());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { user } = await openCard(client);
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    // Step 1 — retrieving authorized asset context is shown as in-progress.
    await act(async () => {
      sse.push({ type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      sse.push({ type: 'STEP_STARTED', stepName: 'retrieve_asset_context' });
    });
    expect(await screen.findByText(/Reading this asset/)).toBeVisible();

    // Complete retrieval, generate, then deliver the answer and finish.
    await act(async () => {
      sse.push({ type: 'STEP_FINISHED', stepName: 'retrieve_asset_context' });
      sse.push({ type: 'STEP_STARTED', stepName: 'generate_response' });
      sse.push({ type: 'STEP_FINISHED', stepName: 'generate_response' });
      sse.push({ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' });
      sse.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'The asset is available.' });
      sse.push({ type: 'TEXT_MESSAGE_END', messageId: 'm' });
      sse.push({ type: 'RUN_FINISHED', threadId: 't', runId: 'r' });
    });

    expect(await screen.findByText('The asset is available.')).toBeVisible();
    // The card is usable again: busy cleared so the question input is re-enabled.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Question about this asset' })).toBeEnabled(),
    );
  });

  it('renders a safe error and stays usable when the provider fails mid-run', async () => {
    setupFetch(() =>
      closedSseResponse(
        [
          frame({ type: 'RUN_STARTED', threadId: 't', runId: 'r' }),
          frame({ type: 'STEP_STARTED', stepName: 'retrieve_asset_context' }),
          frame({ type: 'STEP_FINISHED', stepName: 'retrieve_asset_context' }),
          frame({ type: 'STEP_STARTED', stepName: 'generate_response' }),
          frame({
            type: 'RUN_ERROR',
            message: 'The configured AI provider could not complete this request.',
            code: 'AI_PROVIDER_UNAVAILABLE',
          }),
        ].join(''),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { user, input } = await openCard(client);
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(
      await screen.findByText('The configured AI provider could not complete this request.'),
    ).toBeVisible();
    // A failed run must not wedge the card: the input and Ask button work again.
    await user.type(input, 'Try again');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled();
  });

  it('refreshes the provider and requires consent again when the route changes', async () => {
    const streamHandler = vi.fn(() =>
      closedSseResponse(
        frame({ type: 'RUN_ERROR', message: 'Review the new route.', code: 'AI_ROUTE_CHANGED' }),
      ),
    );
    const getRoutePreview = vi.fn(() => ({
      ...routePreview,
      routeKey: 'model-2|',
      primary: { ...routePreview.primary, connectionName: 'Replacement provider' },
    }));
    getRoutePreview.mockReturnValueOnce(routePreview);
    setupFetch(streamHandler, getRoutePreview);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { user, input } = await openCard(client);
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText(/Replacement provider/)).toBeVisible();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    await user.type(input, 'Try the updated route');
    const askButton = screen.getByRole('button', { name: 'Ask' });
    expect(askButton).toBeDisabled();
    await user.click(checkbox);
    expect(askButton).toBeEnabled();
    expect(streamHandler).toHaveBeenCalledOnce();
  });

  it('shows a recoverable error when the stream closes before a terminal event', async () => {
    setupFetch(() => closedSseResponse(frame({ type: 'RUN_STARTED', runId: 'r', threadId: 't' })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { user, input } = await openCard(client);
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ended before the answer was complete');
    expect(input).toBeEnabled();
  });

  it('aborts and ignores stale events when the workspace changes mid-stream', async () => {
    const sse = controlledSse();
    const captured = setupFetch(() => sse.response());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { user, view } = await openCard(client, 'ws-1');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await act(async () => {
      sse.push({ type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      sse.push({ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' });
      sse.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Partial answer' });
    });
    expect(await screen.findByText('Partial answer')).toBeVisible();

    // Navigate to another workspace's asset: the in-flight stream is aborted.
    view.rerender(wrap(<AiChatCard workspaceId="ws-2" assetIds={[assetId]} />, client));
    expect(captured.signal?.aborted).toBe(true);

    // Late events from the aborted run must be ignored (no stale render).
    await act(async () => {
      sse.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'STALE' });
      sse.push({ type: 'RUN_FINISHED', threadId: 't', runId: 'r' });
      sse.close();
    });

    await waitFor(() => expect(screen.queryByText('STALE')).toBeNull());
    expect(screen.queryByText('Partial answer')).toBeNull();
    // The new workspace card is usable on its own.
    expect(await screen.findByRole('checkbox')).toBeVisible();
  });
});
