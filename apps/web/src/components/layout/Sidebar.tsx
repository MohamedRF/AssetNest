import {
  BadgeCheck,
  BarChart3,
  Blocks,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  LayoutDashboard,
  MapPin,
  Package,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/utils';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/assets', label: 'Assets', icon: Package },
  { to: '/locations', label: 'Locations', icon: MapPin },
  { to: '/custody', label: 'Custody', icon: UsersRound },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/warranties', label: 'Warranties', icon: ShieldCheck },
  { to: '/audits', label: 'Audits', icon: ClipboardCheck },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/approvals', label: 'Approvals', icon: BadgeCheck },
  { to: '/team', label: 'Team', icon: Users },
  { to: '/integrations', label: 'Integrations', icon: Blocks },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="AssetNest logo" className={className}>
      <path fill="currentColor" d="M16 1.5 29 9v14L16 30.5 3 23V9Z" opacity="0.95" />
      <path
        fill="var(--surface, #fff)"
        d="M10 19c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2v1.5a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2Z"
        opacity="0.92"
      />
      <path
        fill="var(--surface, #fff)"
        d="M12 15c.5-3.6 2.4-5.4 4-5.4s3.5 1.8 4 5.4a6.4 6.4 0 0 1-4 .9 6.4 6.4 0 0 1-4-.9Z"
        opacity="0.92"
      />
    </svg>
  );
}

interface SidebarContentProps {
  collapsed: boolean;
  onNavigate?: () => void;
}

function SidebarContent({ collapsed, onNavigate }: SidebarContentProps) {
  return (
    <>
      <div
        className={cn(
          'flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4',
          collapsed && 'justify-center px-2',
        )}
      >
        <NavLink
          to="/"
          onClick={onNavigate}
          aria-label="AssetNest — Overview"
          className="flex min-w-0 items-center gap-2.5 rounded-md"
        >
          <LogoMark className="h-7 w-7 shrink-0 text-accent" />
          {!collapsed && (
            <span className="truncate text-lg font-semibold tracking-tight text-foreground">AssetNest</span>
          )}
        </NavLink>
      </div>

      <nav id="sidebar-nav" aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
        {!collapsed && (
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                {...(item.end !== undefined ? { end: item.end } : {})}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-accent-subtle text-accent-subtle-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, drawerOpen, onCloseDrawer }: SidebarProps) {
  return (
    <>
      {/* Desktop / large screens: persistent, collapsible sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[72px]' : 'w-[260px]',
        )}
      >
        <SidebarContent collapsed={collapsed} />
        <div className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="sidebar-nav"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {collapsed ? (
              <ChevronsRight aria-hidden="true" className="h-5 w-5" />
            ) : (
              <>
                <ChevronsLeft aria-hidden="true" className="h-5 w-5" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Below lg: modal overlay drawer with backdrop */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={onCloseDrawer}
            className="absolute inset-0 h-full w-full cursor-default bg-stone-950/55"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r border-border bg-surface shadow-xl"
          >
            <div className="flex h-16 shrink-0 items-center justify-end border-b border-border px-4">
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Close navigation menu"
                autoFocus
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X aria-hidden="true" className="h-6 w-6" />
              </button>
            </div>
            <SidebarContent collapsed={false} onNavigate={onCloseDrawer} />
          </aside>
        </div>
      )}
    </>
  );
}
