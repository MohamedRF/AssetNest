import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Loader2, Undo2, UserPlus } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Select } from './ui/input';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './ui/toast';
import { api, isApiError } from '../lib/api';

interface MemberRow {
  userId: string;
  membershipId: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
}

interface LocationRow {
  id: string;
  name: string;
  path: string;
}

export function CustodyActions({
  workspaceId,
  assetId,
  assetVersion,
  assetStatus,
}: {
  workspaceId: string;
  assetId: string;
  assetVersion: number;
  assetStatus: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [assignOpen, setAssignOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');

  const membersQuery = useQuery({
    queryKey: ['members', workspaceId],
    enabled: assignOpen,
    queryFn: () => api.get<{ members: MemberRow[] }>(`/workspaces/${workspaceId}/members`),
  });
  const locationsQuery = useQuery({
    queryKey: ['locations', workspaceId],
    enabled: transferOpen,
    queryFn: () => api.get<{ locations: LocationRow[] }>(`/workspaces/${workspaceId}/locations`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['asset', workspaceId, assetId] });
    void queryClient.invalidateQueries({ queryKey: ['assets', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['custody', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['asset-history', workspaceId, assetId] });
  };

  const onMutationError = (title: string) => (error: unknown) =>
    toast({
      title,
      description: isApiError(error)
        ? error.code === 'ASSET_VERSION_CONFLICT'
          ? 'The asset changed in another tab. Reload and try again.'
          : error.detail
        : 'Please try again.',
      variant: 'warning',
    });

  const assign = useMutation({
    mutationFn: () =>
      api.post(`/workspaces/${workspaceId}/assets/${assetId}/assign`, {
        memberId,
        expectedVersion: assetVersion,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: () => {
      toast({ title: 'Asset assigned', variant: 'success' });
      setAssignOpen(false);
      setMemberId('');
      setNotes('');
      invalidate();
    },
    onError: onMutationError('Could not assign'),
  });

  const returnAsset = useMutation({
    mutationFn: () =>
      api.post(`/workspaces/${workspaceId}/assets/${assetId}/return`, { expectedVersion: assetVersion }),
    onSuccess: () => {
      toast({ title: 'Asset returned', variant: 'success' });
      setReturnOpen(false);
      invalidate();
    },
    onError: onMutationError('Could not return'),
  });

  const transfer = useMutation({
    mutationFn: () =>
      api.post(`/workspaces/${workspaceId}/assets/${assetId}/transfer`, {
        toLocationId: locationId,
        expectedVersion: assetVersion,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: () => {
      toast({ title: 'Asset transferred', variant: 'success' });
      setTransferOpen(false);
      setLocationId('');
      setNotes('');
      invalidate();
    },
    onError: onMutationError('Could not transfer'),
  });

  const active = assetStatus !== 'archived' && assetStatus !== 'disposed' && assetStatus !== 'retired';
  if (!active) {
    return null;
  }

  const members = (membersQuery.data?.members ?? []).filter((m) => m.status === 'active');
  const locations = locationsQuery.data?.locations ?? [];
  const onAssignSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (memberId) assign.mutate();
  };
  const onTransferSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locationId) transfer.mutate();
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
        <UserPlus aria-hidden="true" className="h-4 w-4" />
        Assign
      </Button>
      {assetStatus === 'assigned' && (
        <Button variant="outline" size="sm" onClick={() => setReturnOpen(true)}>
          <Undo2 aria-hidden="true" className="h-4 w-4" />
          Return
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
        <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
        Transfer
      </Button>

      <Dialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Assign asset"
        description="Pick who holds custody now. The change is written to asset history."
      >
        <form onSubmit={onAssignSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assign-member">Member</Label>
            <Select
              id="assign-member"
              required
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
            >
              <option value="">Select a member…</option>
              {members.map((member) => (
                <option key={member.membershipId} value={member.membershipId}>
                  {member.displayName} ({member.role})
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assign-notes">Notes</Label>
            <Input
              id="assign-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional handover notes"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!memberId || assign.isPending}>
              {assign.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Assign
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        title="Transfer asset"
        description="Move the asset to another location in this workspace. History records the move."
      >
        <form onSubmit={onTransferSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transfer-location">Destination location</Label>
            <Select
              id="transfer-location"
              required
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">Select a location…</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.path}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transfer-notes">Notes</Label>
            <Input
              id="transfer-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional move reason"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!locationId || transfer.isPending}>
              {transfer.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Transfer
            </Button>
          </div>
        </form>
      </Dialog>

      {returnOpen && (
        <ConfirmDialog
          open
          onClose={() => setReturnOpen(false)}
          onConfirm={() => returnAsset.mutate()}
          title="Return asset?"
          description="The asset goes back to Available and the custody record closes. History is preserved."
          confirmLabel="Return asset"
        />
      )}
    </>
  );
}
