import { Badge, type BadgeVariant } from './ui/badge';
import { cn } from '../lib/utils';

/**
 * Asset lifecycle statuses — mirrors ASSET_STATUSES in packages/domain.
 * Kept local so the web app does not depend on workspace package builds.
 */
export const ASSET_STATUSES = [
  'available',
  'assigned',
  'checked_out',
  'in_repair',
  'lost',
  'retired',
  'disposed',
  'archived',
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

const STATUS_PRESENTATION: Record<AssetStatus, { label: string; variant: BadgeVariant }> = {
  available: { label: 'Available', variant: 'success' },
  assigned: { label: 'Assigned', variant: 'accent' },
  checked_out: { label: 'Checked out', variant: 'info' },
  in_repair: { label: 'In repair', variant: 'warning' },
  lost: { label: 'Lost', variant: 'danger' },
  retired: { label: 'Retired', variant: 'neutral' },
  disposed: { label: 'Disposed', variant: 'danger' },
  archived: { label: 'Archived', variant: 'outline' },
};

export function assetStatusLabel(status: AssetStatus): string {
  return STATUS_PRESENTATION[status].label;
}

export interface AssetStatusBadgeProps {
  status: AssetStatus;
  className?: string;
}

export function AssetStatusBadge({ status, className }: AssetStatusBadgeProps) {
  const { label, variant } = STATUS_PRESENTATION[status];
  return (
    <Badge variant={variant} className={cn(className)} data-testid={`asset-status-${status}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}
