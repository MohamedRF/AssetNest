import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'border-transparent bg-muted text-muted-foreground',
  accent: 'border-transparent bg-accent-subtle text-accent-subtle-foreground',
  success: 'border-transparent bg-success-subtle text-success-subtle-foreground',
  warning: 'border-transparent bg-warning-subtle text-warning-subtle-foreground',
  danger: 'border-transparent bg-danger-subtle text-danger-subtle-foreground',
  info: 'border-transparent bg-info-subtle text-info-subtle-foreground',
  outline: 'border-border bg-transparent text-foreground',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'neutral', className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
});
