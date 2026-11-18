import { ShieldCheck, ShieldPlus } from 'lucide-react';
import { ApiPendingButton } from '../components/ApiPendingButton';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Warranties() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Warranties"
        description="Purchase evidence and warranty windows — never miss an expiry again."
        actions={<ApiPendingButton label="Track a warranty" icon={ShieldPlus} />}
      />
      <EmptyState
        icon={ShieldCheck}
        title="No warranties tracked"
        description="Warranty periods, reminder preferences and invoice evidence attachments arrive with the API (Phase 1). Until then, keep purchase documents in your own records."
      />
    </div>
  );
}
