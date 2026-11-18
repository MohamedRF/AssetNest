import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Home,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../ui/badge';

const WORKSPACE_MODE_KEY = 'assetnest-workspace-mode';

type WorkspaceMode = 'office' | 'home';

function getStoredMode(): WorkspaceMode {
  try {
    return window.localStorage.getItem(WORKSPACE_MODE_KEY) === 'home' ? 'home' : 'office';
  } catch {
    return 'office';
  }
}

interface WorkspaceOption {
  mode: WorkspaceMode;
  name: string;
  preset: string;
  description: string;
}

const WORKSPACE_OPTIONS: readonly WorkspaceOption[] = [
  {
    mode: 'office',
    name: 'Demo Office',
    preset: 'Office',
    description: 'Assets, audits, custody and integrations',
  },
  {
    mode: 'home',
    name: 'Demo Home',
    preset: 'Home',
    description: 'Rooms, appliances and recurring service',
  },
] as const;

/** Demo workspace switcher — presets are a preview until the API ships (Phase 1). */
function WorkspaceSwitcher() {
  const [mode, setMode] = useState<WorkspaceMode>(getStoredMode);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = WORKSPACE_OPTIONS.find((option) => option.mode === mode) ?? WORKSPACE_OPTIONS[0]!;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = (next: WorkspaceMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(WORKSPACE_MODE_KEY, next);
    } catch (error) {
      console.warn('AssetNest: unable to persist workspace mode preview', error);
    }
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Workspace: ${active.name} (${active.preset} mode). Switch workspace.`}
        className="flex h-10 items-center gap-2 rounded-md px-2 text-sm font-medium text-foreground hover:bg-muted"
      >
        <Building2 aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="max-w-[10rem] truncate">{active.name}</span>
          <span className="text-[11px] font-normal text-muted-foreground">{active.preset} mode · Demo</span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="hidden h-4 w-4 text-muted-foreground sm:block" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Choose workspace preview"
          className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-2 shadow-lg"
        >
          {WORKSPACE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={option.mode === mode}
              onClick={() => select(option.mode)}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted"
            >
              {option.mode === 'home' ? (
                <Home aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              ) : (
                <Building2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{option.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {option.preset}
                  </Badge>
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
              </span>
              {option.mode === mode && (
                <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-accent" />
              )}
            </button>
          ))}
          <p className="border-t border-border px-3 pb-1.5 pt-2 text-[11px] leading-4 text-muted-foreground">
            Workspace switching and presets are a preview. Real workspaces arrive with the API (Phase 1).
          </p>
        </div>
      )}
    </div>
  );
}

/** Global search. '/' focuses the field unless typing in an editable element. */
function GlobalSearch() {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed.length > 0 ? `/assets?q=${encodeURIComponent(trimmed)}` : '/assets');
  };

  return (
    <form role="search" onSubmit={submit} className="relative min-w-0 flex-1 sm:max-w-md">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search assets…"
        aria-label="Search assets"
        className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-10 text-sm text-foreground shadow-sm placeholder:text-muted-foreground"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded border border-border bg-muted text-[11px] font-semibold text-muted-foreground sm:flex"
      >
        /
      </kbd>
    </form>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Reminders bell with an empty badge. Real alerts arrive with Phase 1. */
function RemindersBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Reminders — 0 due"
        className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Bell aria-hidden="true" className="h-5 w-5" />
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-accent-foreground"
        >
          0
        </span>
      </button>
      {open && (
        <div
          role="status"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-surface p-4 shadow-lg"
        >
          <p className="text-sm font-semibold text-foreground">You are all caught up</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Reminders for maintenance and warranty due dates appear here once scheduling ships (Phase 1).
          </p>
        </div>
      )}
    </div>
  );
}

/** User menu. Demo account — real sessions arrive with the API (Phase 1). */
function UserMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu — Demo User"
        className="flex h-10 items-center gap-2 rounded-md px-1.5 hover:bg-muted"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-subtle text-xs font-bold text-accent-subtle-foreground"
        >
          DU
        </span>
        <span className="hidden text-sm font-medium text-foreground md:block">Demo User</span>
        <ChevronDown aria-hidden="true" className="hidden h-4 w-4 text-muted-foreground md:block" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="text-sm font-semibold text-foreground">Demo User</p>
            <p className="text-xs leading-5 text-muted-foreground">demo@example.com · Demo account</p>
          </div>
          <div className="my-1 border-t border-border" />
          <Link
            role="menuitem"
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            <Settings aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            Settings
          </Link>
          <Link
            role="menuitem"
            to="/login"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            <LogOut aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            Sign out
          </Link>
        </div>
      )}
    </div>
  );
}

export interface TopbarProps {
  onOpenDrawer: () => void;
}

export function Topbar({ onOpenDrawer }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-sm sm:gap-3 sm:px-4">
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open navigation menu"
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu aria-hidden="true" className="h-6 w-6" />
      </button>

      <WorkspaceSwitcher />
      <GlobalSearch />

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <Link
          to="/assets/new"
          aria-label="Quick add — new asset"
          title="New asset"
          className="flex h-10 items-center gap-1.5 rounded-md bg-accent px-2.5 text-sm font-medium text-accent-foreground shadow-sm hover:bg-accent-hover sm:px-3.5"
        >
          <Plus aria-hidden="true" className="h-5 w-5" />
          <span className="hidden sm:inline">New asset</span>
        </Link>
        <RemindersBell />
        <UserMenu />
      </div>
    </header>
  );
}
