import type { LucideIcon } from 'lucide-react';
import { Button, type ButtonSize, type ButtonVariant } from './ui/button';

export interface ApiPendingButtonProps {
  label: string;
  icon?: LucideIcon;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * Disabled action with a tooltip explaining that it needs the API (Phase 1).
 * Keeps disabled controls honest instead of letting them look broken.
 */
export function ApiPendingButton({
  label,
  icon: Icon,
  variant = 'outline',
  size = 'md',
}: ApiPendingButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      disabled
      aria-disabled="true"
      title="Requires the API (Phase 1)"
      aria-label={`${label} — requires the API (Phase 1)`}
    >
      {Icon !== undefined && <Icon aria-hidden="true" className="h-4 w-4" />}
      {label}
    </Button>
  );
}
