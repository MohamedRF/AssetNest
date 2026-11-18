import { ClipboardCheck, ScanLine } from 'lucide-react';
import { ApiPendingButton } from '../components/ApiPendingButton';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Audits() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Audits"
        description="Scan or verify that assets are where they should be — then reconcile."
        actions={<ApiPendingButton label="Start an audit" icon={ScanLine} />}
      />
      <EmptyState
        icon={ClipboardCheck}
        title="No audits yet"
        description="Audit sessions per location, browser-based QR scanning, discrepancy resolution and immutable close-out arrive with the API (Phase 1). QR codes never expose private asset details."
      />
    </div>
  );
}
