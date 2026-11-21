import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/toast';
import { Integrations } from './Integrations';

const mockUseSelectedWorkspace = vi.fn();

vi.mock('../lib/use-selected-workspace', () => ({
  useSelectedWorkspace: () => mockUseSelectedWorkspace(),
}));

const OWNER_WS = {
  id: 'ws-1',
  name: 'Test WS',
  mode: 'office' as const,
  slug: 'test-ws',
  role: 'owner' as const,
};
const MEMBER_WS = { ...OWNER_WS, role: 'member' as const };

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/integrations']}>
        <ToastProvider>
          <Integrations />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Integrations', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUseSelectedWorkspace.mockReturnValue({
      workspace: OWNER_WS,
      workspaces: [OWNER_WS],
      selectWorkspace: vi.fn(),
    });
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api-tokens') && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify({ tokens: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.endsWith('/api-tokens') && method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'tok-1',
              name: 'ci',
              tokenPrefix: 'anst_ciprefix',
              token: 'anst_supersecretvalue123',
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url.endsWith('/webhooks') && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify({ webhooks: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ message: 'not found', code: 'NOT_FOUND' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the show-once token after creation', async () => {
    const user = userEvent.setup();
    renderPage();

    // Wait for the tokens query to resolve.
    await screen.findByText(/no active tokens/i);
    await user.click(screen.getByRole('button', { name: /^create token$/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/name/i), 'ci');
    await user.click(within(dialog).getByRole('button', { name: /^create token$/i }));

    expect(await screen.findByDisplayValue('anst_supersecretvalue123')).toBeInTheDocument();
    expect(screen.getByText(/never be shown again/i)).toBeInTheDocument();
  });

  it('blocks non-admin members with a permission explanation', async () => {
    mockUseSelectedWorkspace.mockReturnValue({
      workspace: MEMBER_WS,
      workspaces: [MEMBER_WS],
      selectWorkspace: vi.fn(),
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Integration access required' })).toBeInTheDocument();
  });
});
