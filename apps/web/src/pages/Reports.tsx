import { BarChart3, FilePlus2 } from 'lucide-react';
import { ApiPendingButton } from '../components/ApiPendingButton';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Reports() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reports"
        description="Asset register, by location, status or custodian; purchase, warranty and maintenance summaries."
        actions={<ApiPendingButton label="Generate report" icon={FilePlus2} />}
      />
      <EmptyState
        icon={BarChart3}
        title="No reports generated"
        description="Common templates with date filters and CSV export arrive with the API (Phase 1). Reports are always workspace-scoped and never aggregate across tenants."
      />
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Planned templates: asset register · by location · by status · by custodian · warranty due ·
        maintenance overdue · audit discrepancies.
      </p>
    </div>
  );
}
