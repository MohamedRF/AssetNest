import { useAuth, type WorkspaceSummary } from './auth';

/**
 * Shared selection for the current workspace. Selection is UI state;
 * the server always authorizes against membership on every request.
 * Falls back to the first workspace when the stored id is stale.
 */
export function useSelectedWorkspace(): {
  workspace: WorkspaceSummary | undefined;
  workspaces: WorkspaceSummary[];
  selectWorkspace: (id: string) => void;
} {
  const { workspaces, selectedWorkspaceId, selectWorkspace } = useAuth();
  const workspace = workspaces.find((ws) => ws.id === selectedWorkspaceId) ?? workspaces[0];

  return {
    workspace,
    workspaces,
    selectWorkspace: (id: string) => selectWorkspace(id),
  };
}
