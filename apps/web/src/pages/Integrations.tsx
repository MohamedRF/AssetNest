import { Blocks, Plug } from 'lucide-react';
import { ApiPendingButton } from '../components/ApiPendingButton';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Integrations() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Integrations"
        description="API tokens, signed webhooks and import/export — connect AssetNest to the rest of your stack."
        actions={<ApiPendingButton label="Add integration" icon={Plug} />}
      />
      <EmptyState
        icon={Blocks}
        title="No integrations configured"
        description="Versioned API access, scoped tokens, signed outgoing webhooks with retries and CSV/JSON export arrive with the API (Phase 1). Optional MCP access lands later with explicit per-workspace authorization."
      />
    </div>
  );
}
