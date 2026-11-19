import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronRight, FolderTree, Loader2, MapPin, Plus } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog } from '../components/ui/dialog';
import { api, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';

const LOCATION_TYPES = ['building', 'floor', 'room', 'shelf', 'area', 'other'] as const;
type LocationType = (typeof LOCATION_TYPES)[number];

interface LocationRow {
  id: string;
  name: string;
  type: string;
  path: string;
  parentId: string | null;
}

export function Locations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const canManage =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'manager';

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<LocationType>('room');
  const [parentId, setParentId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const locationsQuery = useQuery({
    queryKey: ['locations', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ locations: LocationRow[] }>(`/workspaces/${workspaceId}/locations`),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(`/workspaces/${workspaceId}/locations`, {
        name: name.trim(),
        type,
        parentId: parentId === '' ? null : parentId,
      }),
    onSuccess: () => {
      toast({ title: 'Location created', variant: 'success' });
      setOpen(false);
      setName('');
      setParentId('');
      setType('room');
      void queryClient.invalidateQueries({ queryKey: ['locations', workspaceId] });
    },
    onError: (err) => {
      setError(isApiError(err) ? err.detail : 'Could not create the location.');
    },
  });

  const locations = locationsQuery.data?.locations ?? [];
  // Render flat list ordered by materialized path — children stay next to their parents.
  const sorted = [...locations].sort((a, b) => a.path.localeCompare(b.path));

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    create.mutate();
  };

  if (!workspaceId) {
    return (
      <EmptyState
        icon={Building2}
        title="Create a workspace first"
        description="Locations are scoped to a workspace. Set one up in Settings first."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        demo={false}
        title="Locations"
        description="Buildings, floors, rooms and shelves — the tree your assets live in. Paths are materialized for fast filtering."
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add location
            </Button>
          ) : undefined
        }
      />

      {locationsQuery.isLoading && (
        <p
          role="status"
          className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground"
        >
          Loading locations…
        </p>
      )}

      {locationsQuery.isError && (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-subtle p-4 text-sm text-danger-subtle-foreground"
        >
          Could not load locations. Is the API running?
        </p>
      )}

      {!locationsQuery.isLoading && sorted.length === 0 && (
        <EmptyState
          icon={FolderTree}
          title="No locations yet"
          description="Add your first building, floor or room — assets can then be filed into it."
          actionLabel={canManage ? 'Add first location' : undefined}
          onAction={canManage ? () => setOpen(true) : undefined}
        />
      )}

      {sorted.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Location tree</CardTitle>
            <CardDescription>Order shown by path; depth reflects nesting.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {sorted.map((location) => {
                const depth = Math.max(0, location.path.split('/').filter(Boolean).length - 1);
                return (
                  <li
                    key={location.id}
                    className="flex items-center gap-2 py-2.5"
                    style={{ paddingLeft: `${depth * 1.5}rem` }}
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={cn('h-4 w-4 shrink-0 text-muted-foreground', depth === 0 && 'opacity-0')}
                    />
                    <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{location.name}</span>
                    <span className="text-xs capitalize text-muted-foreground">{location.type}</span>
                    <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                      {location.path}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add location"
        description="Rooms can nest under floors, floors under buildings — as deep as you need."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-location-form"
              disabled={create.isPending || name.trim().length === 0}
            >
              {create.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </>
        }
      >
        <form id="create-location-form" onSubmit={onCreate} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location-name">Name *</Label>
            <Input
              id="location-name"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. HQ Building, Server Room, Shelf B"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location-type">Type</Label>
            <Select
              id="location-type"
              value={type}
              onChange={(event) => setType(event.target.value as LocationType)}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location-parent">Parent location</Label>
            <Select
              id="location-parent"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">No parent (top level)</option>
              {sorted.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.path}
                </option>
              ))}
            </Select>
          </div>
          {error !== null && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      </Dialog>
    </div>
  );
}
