import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/toast';
import { AssetForm } from './AssetForm';

vi.mock('../lib/use-selected-workspace', () => ({
  useSelectedWorkspace: () => ({
    workspace: { id: 'ws-1', name: 'Test WS', mode: 'office', slug: 'test-ws', role: 'owner' },
    workspaces: [{ id: 'ws-1', name: 'Test WS', mode: 'office', slug: 'test-ws', role: 'owner' }],
    selectWorkspace: vi.fn(),
  }),
}));

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/assets/new']}>
        <ToastProvider>
          <AssetForm />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AssetForm', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const mockFetchOnce = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/categories')) {
          return Promise.resolve(mockFetchOnce(200, { categories: [] }));
        }
        if (url.endsWith('/locations')) {
          return Promise.resolve(mockFetchOnce(200, { locations: [] }));
        }
        if (url.endsWith('/assets')) {
          return Promise.resolve(mockFetchOnce(201, { id: 'asset-1' }));
        }
        return Promise.resolve(mockFetchOnce(404, { message: 'not found', code: 'NOT_FOUND' }));
      }),
    );
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('shows an inline error when the asset tag is invalid', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), 'Docking station');
    await user.type(screen.getByLabelText(/asset tag/i), 'bad tag!');
    await user.click(screen.getByRole('button', { name: /create asset/i }));

    expect(screen.getByText(/use uppercase letters/i)).toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('shows an inline error when the display name is too short', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), 'A');
    await user.type(screen.getByLabelText(/asset tag/i), 'TAG-0007');
    await user.click(screen.getByRole('button', { name: /create asset/i }));

    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument();
  });

  it('creates the asset via the API and shows a success toast', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), 'Label printer');
    await user.type(screen.getByLabelText(/asset tag/i), 'tag-0042');
    await user.type(screen.getByLabelText(/serial number/i), '0042-XK-9917');
    await user.click(screen.getByRole('button', { name: /create asset/i }));

    expect(await screen.findByText(/asset created/i)).toBeInTheDocument();
    const fetchMock = vi.mocked(fetch);
    const assetCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/assets'));
    expect(assetCall).toBeDefined();
    const [url, init] = assetCall as [string, RequestInit];
    expect(url).toBe('/api/v1/workspaces/ws-1/assets');
    expect(JSON.parse(String(init.body))).toMatchObject({
      assetTag: 'TAG-0042',
      serialNumber: '0042-XK-9917',
    });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('marks invalid fields with aria-invalid for assistive technology', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: /create asset/i }));

    expect(screen.getByLabelText(/display name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/asset tag/i)).toHaveAttribute('aria-invalid', 'true');
  });
});
