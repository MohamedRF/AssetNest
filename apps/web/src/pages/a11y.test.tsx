import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/toast';
import { Login } from './Login';

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
});
