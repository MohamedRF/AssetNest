import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetDetail } from '@assetnest/sdk';
import { Approvals } from '../pages/Approvals';
import type { ApprovalRequest, ApprovalRule } from '../lib/approvals-api';
import { AssetLifecycleActions } from './AssetLifecycleActions';
import { ToastProvider } from './ui/toast';

const assetId = 'f5c4454e-e2a8-4e97-8741-7c08a0c7b570';
const workspaceId = 'ws-1';
const actorId = 'owner-1';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: actorId } }) }));
vi.mock('../lib/use-selected-workspace', () => ({
  useSelectedWorkspace: () => ({ workspace: { id: workspaceId, role: 'owner' } }),
}));

afterEach(() => vi.unstubAllGlobals());

describe('asset lifecycle approvals', () => {
  it('requests, approves and applies a guarded retirement from the browser', async () => {
    const asset: Pick<AssetDetail, 'id' | 'displayName' | 'status' | 'version'> = {
      id: assetId,
      displayName: 'Office laptop',
      status: 'available',
      version: 4,
    };
    const rule: ApprovalRule = {
      action: 'asset.retire',
      requiredApprovals: 1,
      approverRoles: ['owner'],
      selfApproval: true,
    };
    let approval: ApprovalRequest | undefined;
    const timestamp = '2026-11-21T00:00:00Z';
    const fetch = vi.fn((input: string, init: RequestInit) => {
      const url = new URL(input, 'https://assetnest.test');
      const path = url.pathname;
      if (path.endsWith('/approvals/rules')) return Response.json({ rules: [rule] });
      if (path.endsWith('/approvals/requests') && init.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          action: rule.action,
          resourceType: 'asset',
          resourceId: assetId,
        });
        approval = {
          ...rule,
          id: 'request-1',
          resourceType: 'asset',
          resourceId: assetId,
          requestedBy: actorId,
          status: 'pending',
          context: {},
          createdAt: timestamp,
          decidedAt: null,
          executedAt: null,
          decisions: [],
        };
        return Response.json(approval, { status: 201 });
      }
      if (path.endsWith('/approvals/requests')) {
        expect(url.searchParams.get('resourceId') ?? assetId).toBe(assetId);
        return Response.json({ requests: approval ? [approval] : [] });
      }
      if (path.endsWith('/approvals/requests/request-1/decide') && approval) {
        expect(JSON.parse(String(init.body))).toEqual({ decision: 'approved' });
        approval = { ...approval, status: 'approved' };
        return Response.json(approval);
      }
      if (path.endsWith(`/assets/${assetId}/status-transition`) && approval?.status === 'approved') {
        expect(JSON.parse(String(init.body))).toEqual({ to: 'retired', expectedVersion: 4 });
        return Response.json({ ...asset, status: 'retired', version: 5 });
      }
      throw new Error(`Unexpected request ${init.method} ${path}`);
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/assets/${assetId}`]}>
          <ToastProvider>
            <Routes>
              <Route
                path="/assets/:assetId"
                element={<AssetLifecycleActions workspaceId={workspaceId} asset={asset} />}
              />
              <Route path="/approvals" element={<Approvals />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Request retirement approval' }));
    await user.click(await screen.findByRole('link', { name: 'Retirement approval pending' }));
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('approved')).toBeVisible();
    await user.click(screen.getByRole('link', { name: /View asset/ }));
    await user.click(await screen.findByRole('button', { name: 'Retire asset' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retire asset' }));
    expect(await screen.findByText('Asset retired')).toBeVisible();
  });
});
