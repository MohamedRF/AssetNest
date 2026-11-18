import { MapPin, Plus, TreePine } from 'lucide-react';
import { ApiPendingButton } from '../components/ApiPendingButton';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Locations() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Locations"
        description="Model where assets live — buildings, floors, rooms and shelf spots, as a nested tree."
        actions={<ApiPendingButton label="Add location" icon={Plus} />}
      />
      <EmptyState
        icon={TreePine}
        title="No locations yet"
        description="Locations let you find things fast and audit by place. Nested trees (building → floor → room → shelf) and assets-per-location views arrive with the API (Phase 1)."
      />
      <p className="mt-4 flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
        <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
        Location moves will be captured in the append-only asset history once the registry is live.
      </p>
    </div>
  );
}
