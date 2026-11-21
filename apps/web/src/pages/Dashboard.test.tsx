import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';

const { useSelectedWorkspace } = vi.hoisted(() => ({ useSelectedWorkspace: vi.fn() }));
vi.mock('../lib/use-selected-workspace', () => ({ useSelectedWorkspace }));

function renderDashboard(role: string) {
  useSelectedWorkspace.mockReturnValue({ workspace: { id: 'test-workspace', role } });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockRequests(auditResult: Response) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/audits')) return auditResult;
    if (url.endsWith('/assets?pageSize=1')) return Response.json({ total: 42, items: [] });
    if (url.includes('/warranties?')) return Response.json({ warranties: [] });
    if (url.endsWith('/maintenance/plans')) return Response.json({ plans: [] });
    if (url.includes('/audit-log?')) return Response.json({ entries: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workspace dashboard', () => {
  it('counts only open inventory audits', async () => {
    mockRequests(Response.json({ audits: [{ status: 'open' }, { status: 'closed' }] }));
    renderDashboard('manager');

    const card = screen.getByText('Open audits').parentElement!;
    expect(await within(card).findByText('1')).toBeInTheDocument();
  });

  it('shows an unavailable total after a failed audit request', async () => {
    mockRequests(new Response(null, { status: 503 }));
    renderDashboard('manager');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh');
    expect(within(screen.getByText('Open audits').parentElement!).getByText('—')).toBeInTheDocument();
  });

  it('keeps the audit count out of the member dashboard', async () => {
    const fetch = mockRequests(Response.json({ audits: [] }));
    renderDashboard('member');

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.queryByText('Open audits')).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/audits'))).toBe(false);
  });
});
