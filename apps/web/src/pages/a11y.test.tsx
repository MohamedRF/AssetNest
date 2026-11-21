import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/toast';
import { Login } from './Login';
import { Approvals } from './Approvals';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: null,
    workspaces: [],
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseSelectedWorkspace = vi.fn();
vi.mock('../lib/use-selected-workspace', () => ({
  useSelectedWorkspace: () => mockUseSelectedWorkspace(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('accessibility smoke (axe-core)', () => {
  it('login screen has no detectable WCAG violations', async () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ToastProvider>
            <Login />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  }, 30_000);

  it('approvals page has no detectable WCAG violations', async () => {
    mockUseSelectedWorkspace.mockReturnValue({
      workspace: { id: 'ws-1', name: 'A11y WS', mode: 'office', slug: 'a11y-ws', role: 'owner' },
      workspaces: [{ id: 'ws-1', name: 'A11y WS', mode: 'office', slug: 'a11y-ws', role: 'owner' }],
      selectWorkspace: vi.fn(),
    });
    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/approvals/rules')) return Promise.resolve(jsonResponse({ rules: [] }));
        if (url.endsWith('/approvals/requests')) return Promise.resolve(jsonResponse({ requests: [] }));
        return Promise.resolve(jsonResponse({}));
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/approvals']}>
          <ToastProvider>
            <Approvals />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Requests');
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  }, 30_000);
});
