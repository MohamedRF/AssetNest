import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonVariants } from './ui/button';
import { cn } from '../lib/utils';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional primary call to action. */
  actionLabel?: string;
  /** Internal route for the CTA (renders a link). */
  actionHref?: string;
  /** Click handler for the CTA (renders a button). Ignored when actionHref is set. */
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className,
}: EmptyStateProps) {
  const action =
    actionLabel === undefined ? null : actionHref !== undefined ? (
      <Link to={actionHref} className={cn(buttonVariants({ size: 'md' }))}>
        {actionLabel}
      </Link>
    ) : onAction !== undefined ? (
      <button type="button" className={cn(buttonVariants({ size: 'md' }))} onClick={onAction}>
        {actionLabel}
      </button>
    ) : null;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center',
        className,
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-subtle">
        <Icon aria-hidden="true" className="h-6 w-6 text-accent-subtle-foreground" />
      </span>
      <h3 className="text-base font-semibold leading-6 tracking-tight text-foreground">{title}</h3>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action !== null && <div className="mt-2">{action}</div>}
    </div>
  );
}
