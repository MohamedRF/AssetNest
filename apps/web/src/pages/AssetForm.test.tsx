import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

function renderForm(path = '/assets/new') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/assets/new" element={<AssetForm />} />
            <Route path="/assets/:assetId/edit" element={<AssetForm />} />
            <Route path="/assets/:assetId" element={<p>Asset detail</p>} />
          </Routes>
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

  const originalAsset = {
    id: 'asset-1',
    assetTag: 'TAG-0042',
    displayName: 'Label printer',
    serialNumber: '0042-XK-9917',
    amount: '6000.00',
    currency: 'JPY',
    notes: 'Replace the cartridge',
    status: 'assigned',
    condition: 'good',
    version: 7,
  };

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
    await user.selectOptions(screen.getByLabelText(/purchase currency/i), 'MYR');
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
      currency: 'MYR',
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

  it('updates only edited fields, clears optional values, and sends the original version', async () => {
    const fetchMock = vi.mocked(fetch);
    const defaultFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, init) => {
      if (!String(input).endsWith('/assets/asset-1')) return defaultFetch!(input, init);
      return Promise.resolve(mockFetchOnce(200, originalAsset));
    });

    const user = userEvent.setup();
    renderForm('/assets/asset-1/edit');
    expect(await screen.findByLabelText(/display name/i)).toHaveValue('Label printer');
    expect(screen.getByLabelText(/purchase currency/i)).toHaveValue('JPY');
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText(/serial number/i));
    await user.selectOptions(screen.getByLabelText(/purchase currency/i), 'SAR');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Asset updated')).toBeInTheDocument();
    expect(screen.getByText('Asset detail')).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[0])).toBe('/api/v1/workspaces/ws-1/assets/asset-1');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      expectedVersion: 7,
      serialNumber: null,
      currency: 'SAR',
    });
  });

  it('keeps the draft after a stale write and loads untouched fields from the latest version', async () => {
    const fetchMock = vi.mocked(fetch);
    const defaultFetch = fetchMock.getMockImplementation();
    let latestAsset = originalAsset;
    fetchMock.mockImplementation((input, init) => {
      if (!String(input).endsWith('/assets/asset-1')) return defaultFetch!(input, init);
      if (init?.method !== 'PATCH') return Promise.resolve(mockFetchOnce(200, latestAsset));

      const submitted = JSON.parse(String(init.body)) as { expectedVersion: number; notes: string };
      if (submitted.expectedVersion === 7) {
        latestAsset = { ...originalAsset, version: 8, displayName: 'Updated printer' };
        return Promise.resolve(mockFetchOnce(409, { code: 'ASSET_VERSION_CONFLICT' }));
      }

      expect(submitted).toEqual({ expectedVersion: 8, notes: 'New cartridge fitted' });
      return Promise.resolve(mockFetchOnce(200, { ...latestAsset, ...submitted, version: 9 }));
    });

    const user = userEvent.setup();
    renderForm('/assets/asset-1/edit');
    const notes = await screen.findByLabelText('Notes');
    await user.clear(notes);
    await user.type(notes, 'New cartridge fitted');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This asset changed');
    expect(notes).toHaveValue('New cartridge fitted');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Load latest and keep my edits' }));
    expect(await screen.findByText(/latest values loaded/i)).toBeInTheDocument();
    expect(notes).toHaveValue('New cartridge fitted');
    expect(screen.getByLabelText(/display name/i)).toHaveValue('Updated printer');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Asset updated')).toBeInTheDocument();
  });
});
