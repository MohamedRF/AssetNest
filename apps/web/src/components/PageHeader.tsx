import type { ReactNode } from 'react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

export interface PageHeaderProps {
  title: string;
  description: string;
  /** Shows a neutral "Demo" badge next to the title. */
  demo?: boolean;
  /** Right-aligned action slot. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, demo = true, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold leading-8 tracking-tight text-foreground">{title}</h1>
          {demo && (
            <Badge variant="neutral" title="No data — the API ships in Phase 1">
              Demo
            </Badge>
          )}
        </div>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
