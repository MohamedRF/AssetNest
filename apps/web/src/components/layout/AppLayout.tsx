import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export const SIDEBAR_COLLAPSED_KEY = 'assetnest-sidebar-collapsed';

function getStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Gates every protected route: splash while probing, redirect to /login when signed out. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Checking your session…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState<boolean>(getStoredCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch (error) {
      console.warn('AssetNest: unable to persist sidebar state', error);
    }
  }, [collapsed]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Escape closes the drawer; body scroll locks while it is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);

  const toggleCollapsed = useCallback(() => setCollapsed((value) => !value), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Skip to main content
        </a>

        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          drawerOpen={drawerOpen}
          onCloseDrawer={closeDrawer}
        />

        <div
          className={cn(
            'flex min-h-screen flex-col transition-[padding] duration-200',
            collapsed ? 'lg:pl-[72px]' : 'lg:pl-[260px]',
          )}
        >
          <Topbar onOpenDrawer={openDrawer} />
          <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">
              <Outlet />
            </div>
          </main>
          <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
            AssetNest — self-hosted asset management. All data stays yours.
          </footer>
        </div>
      </div>
    </RequireAuth>
  );
}
