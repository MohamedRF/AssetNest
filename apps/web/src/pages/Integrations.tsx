import { Blocks, KeyRound } from 'lucide-react';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ApiTokensSection } from '../components/integrations/ApiTokensSection';
import { WebhooksSection } from '../components/integrations/WebhooksSection';

export function Integrations() {
  const { workspace } = useSelectedWorkspace();

  if (!workspace) {
    return (
      <EmptyState
        icon={Blocks}
        title="Create a workspace to use integrations"
        description="API tokens and webhooks are scoped per workspace. Set one up in Settings first."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  const canManage = workspace.role === 'owner' || workspace.role === 'admin';

  if (!canManage) {
    return (
      <div className="flex flex-col">
        <PageHeader
          title="Integrations"
          demo={false}
          description="API tokens and signed webhooks for connecting AssetNest to the rest of your stack."
        />
        <EmptyState
          icon={KeyRound}
          title="You need the integrations:manage permission"
          description="Only workspace owners and admins can create API tokens or webhook subscriptions. Ask a workspace admin if you believe you need access."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        demo={false}
        description="Scoped API tokens and signed outbound webhooks. Secrets are shown once and stored hashed/encrypted; every action is audit-logged."
      />
      <WebhooksSection workspaceId={workspace.id} />
      <ApiTokensSection workspaceId={workspace.id} />
    </div>
  );
}
