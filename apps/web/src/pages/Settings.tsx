import { useState, type FormEvent } from 'react';
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
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { api, isApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { AiConnectionsCard } from './AiConnectionsCard';

interface SettingsSection {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Why or when this section becomes useful. */
  note: string;
}

/** Working workspace card: lists your workspaces and creates new ones. */
function WorkspaceCard() {
  const { workspaces, refresh } = useAuth();
  const { workspace, selectWorkspace } = useSelectedWorkspace();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'home' | 'office'>('office');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await api.post<{ id: string; name: string }>('/workspaces', {
        name: name.trim(),
        mode,
      });
      await refresh();
      selectWorkspace(created.id);
      toast({ title: `Workspace "${created.name}" created`, variant: 'success' });
      setName('');
    } catch (err) {
      setError(isApiError(err) ? err.detail : 'Could not create the workspace. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <Building2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            Create workspaces and switch context. Each workspace is isolated — members, assets and history
            never mix.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {workspace && (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs font-medium uppercase leading-5 text-muted-foreground">Current workspace</p>
            <p className="text-sm font-semibold text-foreground">{workspace.name}</p>
            <p className="text-xs capitalize text-muted-foreground">
              {workspace.mode} mode · your role: {workspace.role}
            </p>
          </div>
        )}
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="new-workspace-name">New workspace</Label>
            <Input
              id="new-workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Home, Acme Office"
              required
              minLength={1}
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-workspace-mode">Mode</Label>
            <Select
              id="new-workspace-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as 'home' | 'office')}
            >
              <option value="office">Office</option>
              <option value="home">Home</option>
            </Select>
          </div>
          <Button type="submit" disabled={creating || name.trim().length === 0}>
            Create
          </Button>
        </form>
        {error !== null && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {workspaces.length > 1 && (
          <p className="text-xs leading-5 text-muted-foreground">
            You belong to {workspaces.length} workspaces — switch between them from the top bar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const STANDARD_SECTIONS: readonly SettingsSection[] = [
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
  const { workspace } = useSelectedWorkspace();

  const chooseTheme = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Settings"
        demo={false}
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

        <WorkspaceCard />

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

        <AiConnectionsCard
          key={workspace?.id}
          workspaceId={workspace?.id}
          canConfigure={workspace?.role === 'owner' || workspace?.role === 'admin'}
        />
      </div>
    </div>
  );
}
