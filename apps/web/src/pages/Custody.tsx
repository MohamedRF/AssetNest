import { UserRoundPlus, UsersRound } from 'lucide-react';
import { ApiPendingButton } from '../components/ApiPendingButton';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Custody() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Custody"
        description="Who has what — assign, return and transfer assets, with full history."
        actions={<ApiPendingButton label="Assign custody" icon={UserRoundPlus} />}
      />
      <EmptyState
        icon={UsersRound}
        title="Nothing assigned yet"
        description="Assignments, check-outs, returns and transfers are tracked per asset with conflict-safe version checks. Custody dialogs and custodian views arrive with the API (Phase 1)."
      />
    </div>
  );
}
