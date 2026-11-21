import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from './api';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  mode: 'home' | 'office';
  slug: string;
  role: string;
}

interface AuthResponse {
  user: AuthUser;
  workspaces: WorkspaceSummary[];
  csrfToken: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  workspaces: WorkspaceSummary[];
  /** UI-only selected workspace id (never trusted by the server). */
  selectedWorkspaceId: string | null;
  /** Select (or clear) the active workspace; persists locally. */
  selectWorkspace: (id: string | null) => void;
  /** True until the initial /auth/me probe resolves. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SELECTED_WORKSPACE_KEY = 'assetnest-workspace-id';

function readStoredSelection(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

function persistSelection(id: string | null): void {
  try {
    if (id === null) {
      window.localStorage.removeItem(SELECTED_WORKSPACE_KEY);
    } else {
      window.localStorage.setItem(SELECTED_WORKSPACE_KEY, id);
    }
  } catch {
    // Storage unavailable (private mode) — selection just won't persist.
  }
}

export function getSelectedWorkspaceId(): string | null {
  return readStoredSelection();
}

export function setSelectedWorkspaceId(id: string | null): void {
  persistSelection(id);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(readStoredSelection);
  const [isLoading, setIsLoading] = useState(true);
  // Tracks the signed-in user id so a session swap can drop the previous
  // account's cached (private) query data — asset lists, report metadata, AI
  // drafts — before it can be shown to a different person.
  const activeUserId = useRef<string | null>(null);

  const selectWorkspace = useCallback((id: string | null) => {
    setSelectedWorkspaceId(id);
    persistSelection(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<AuthResponse>('/auth/me');
      setCsrfToken(data.csrfToken);
      if (activeUserId.current !== data.user.id) {
        queryClient.clear();
        activeUserId.current = data.user.id;
      }
      setUser(data.user);
      setWorkspaces(data.workspaces);
    } catch {
      // 401 → not signed in (or session expired). Anything else → also treated as signed out;
      // the login page explains when the API is unreachable.
      setCsrfToken(null);
      queryClient.clear();
      activeUserId.current = null;
      setUser(null);
      setWorkspaces([]);
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<AuthResponse>('/auth/login', { email, password });
      // A new session begins: discard any cached data from a previous account.
      queryClient.clear();
      activeUserId.current = data.user.id;
      setCsrfToken(data.csrfToken);
      setUser(data.user);
      setWorkspaces(data.workspaces);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setCsrfToken(null);
      queryClient.clear();
      activeUserId.current = null;
      setUser(null);
      setWorkspaces([]);
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, workspaces, selectedWorkspaceId, selectWorkspace, isLoading, login, logout, refresh }),
    [user, workspaces, selectedWorkspaceId, selectWorkspace, isLoading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
