import { useState } from 'react';
import {
  Bell,
  Building2,
  HardDrive,
  Blocks,
  ListChecks,
  Moon,
  Monitor,
  Package,
  ShieldCheck,
  Sparkles,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { cn } from '../lib/utils';
import { getTheme, setTheme, type Theme } from '../lib/theme';

interface SettingsSection {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Why or when this section becomes useful. */
  note: string;
}

const STANDARD_SECTIONS: readonly SettingsSection[] = [
  {
    title: 'Workspace',
    description: 'Name, mode (home or office), default currency, time zone and workspace deletion.',
    icon: Building2,
    note: 'Available once the API connects (Phase 1)',
  },
  {
    title: 'Assets & categories',
    description: 'Categories, asset models, custom field templates and asset tag sequences.',
    icon: Package,
    note: 'Available once the API connects (Phase 1)',
  },
  {
    title: 'Notifications',
    description: 'Reminder preferences for warranty and maintenance due dates, and delivery channels.',
    icon: Bell,
    note: 'Available once scheduling ships (Phase 1)',
  },
  {
    title: 'Storage',
    description: 'Attachment storage, size and type limits, retention and download authorization.',
    icon: HardDrive,
    note: 'Available once private files ship (Phase 1)',
  },
  {
    title: 'Integrations',
    description: 'API tokens, signed webhooks and scoped service accounts.',
    icon: Blocks,
    note: 'Available once integrations ship (Phase 1)',
  },
  {
    title: 'Security',
    description: 'Sessions, password policy, two-factor authentication and audit log access.',
    icon: ShieldCheck,
    note: 'Available once identity hardening ships (Phase 1)',
  },
] as const;

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

export function Settings() {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const chooseTheme = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Settings"
        description="Workspace preferences and connected services. Everything here is tenant-scoped — no setting is shared across workspaces."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start gap-3 space-y-0">
            <Sun aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Light, dark or follow your operating system.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Color theme">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  onClick={() => chooseTheme(option.value)}
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors',
                    theme === option.value
                      ? 'border-accent bg-accent-subtle text-accent-subtle-foreground'
                      : 'border-border bg-surface text-foreground hover:bg-muted',
                  )}
                >
                  <option.icon aria-hidden="true" className="h-4 w-4" />
                  {option.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {STANDARD_SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardHeader className="flex-row items-start gap-3 space-y-0">
              <section.icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                <ListChecks aria-hidden="true" className="h-4 w-4 shrink-0" />
                {section.note}
              </p>
            </CardContent>
          </Card>
        ))}

        <Card className="border-accent/40">
          <CardHeader className="flex-row items-start gap-3 space-y-0">
            <Sparkles aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>AI assistant</CardTitle>
                <Badge variant="accent">Phase 5</Badge>
              </div>
              <CardDescription>
                AI is optional — configure providers later (Phase 5). Core works with AI disabled.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">Enable AI assistant</span>
                <span className="text-xs leading-5 text-muted-foreground">
                  Provider connections, per-task routing and consent live here once Phase 5 ships.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked="false"
                aria-label="Enable AI assistant (available in Phase 5)"
                disabled
                title="AI configuration ships in Phase 5"
                className="relative h-6 w-11 shrink-0 cursor-not-allowed rounded-full bg-muted transition-colors disabled:opacity-60"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-1 top-1 h-4 w-4 rounded-full bg-muted-foreground/60"
                />
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              When enabled, AI will propose changes as an editable diff and never saves on its own. API access
              is distinct from consumer subscriptions — provider keys stay server-side.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
