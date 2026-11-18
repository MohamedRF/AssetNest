import { CalendarClock, Wrench } from 'lucide-react';
import { ApiPendingButton } from '../components/ApiPendingButton';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Maintenance() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Maintenance"
        description="Service schedules and repair history — what is due, overdue, and done."
        actions={<ApiPendingButton label="Schedule service" icon={CalendarClock} />}
      />
      <EmptyState
        icon={Wrench}
        title="No maintenance scheduled"
        description="Maintenance plans by date or interval, service records and overdue alerts arrive with the API (Phase 1). In-repair asset status is already available on the asset form."
      />
    </div>
  );
}
