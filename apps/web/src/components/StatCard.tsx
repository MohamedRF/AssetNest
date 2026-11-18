import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { cn } from '../lib/utils';

export interface StatCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  /** Accent tone for the icon chip. */
  tone?: 'accent' | 'warning' | 'danger' | 'info';
}

const toneClasses: Record<NonNullable<StatCardProps['tone']>, string> = {
  accent: 'bg-accent-subtle text-accent-subtle-foreground',
  warning: 'bg-warning-subtle text-warning-subtle-foreground',
  danger: 'bg-danger-subtle text-danger-subtle-foreground',
  info: 'bg-info-subtle text-info-subtle-foreground',
};

export function StatCard({ label, value, hint, icon: Icon, tone = 'accent' }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span
          aria-hidden="true"
          className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', toneClasses[tone])}
        >
          <Icon className="h-6 w-6" />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-sm leading-5 text-muted-foreground">{label}</p>
          <p className="text-2xl leading-8 font-semibold tracking-tight tabular-nums">{value}</p>
          {hint !== undefined && <p className="text-xs leading-4 text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
