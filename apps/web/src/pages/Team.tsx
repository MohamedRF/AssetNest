import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Copy, Home, Loader2, MailPlus, Trash2, TriangleAlert, Users } from 'lucide-react';
import { api, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { useToast } from '../components/ui/toast';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/ui/dialog';

interface MemberRow {
  userId: string;
  membershipId: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string;
}

interface InviteRow {
  id: string;
  email: string;
  roleKey: string;
  status: string;
  expiresAt: string;
}

interface CreatedInvite {
  inviteId: string;
  acceptUrl: string;
  email: string;
  roleKey: string;
}

const ASSIGNABLE_ROLES = ['admin', 'manager', 'member', 'auditor'] as const;

function InviteDialog({
  open,
  onClose,
  workspaceId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onCreated: (invite: CreatedInvite) => void;
}) {
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState<string>('member');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const invite = await api.post<CreatedInvite>(`/workspaces/${workspaceId}/invites`, {
        email: email.trim().toLowerCase(),
        roleKey,
      });
      onCreated(invite);
      setEmail('');
      setRoleKey('member');
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.detail : 'Could not create the invite. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite a teammate"
      description="They get a single-use link that expires in 7 days. Share it over a channel you trust."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@example.com"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Select id="invite-role" value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        {error !== null && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="self-start">
          {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          Create invite link
        </Button>
      </form>
    </Dialog>
  );
}

export function Team() {
  const { workspace } = useSelectedWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);

  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';
  const workspaceId = workspace?.id;

  const membersQuery = useQuery({
    queryKey: ['members', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ members: MemberRow[] }>(`/workspaces/${workspaceId}/members`),
  });

  const invitesQuery = useQuery({
    queryKey: ['invites', workspaceId],
    enabled: workspaceId !== undefined && canManage,
    queryFn: () => api.get<{ invites: InviteRow[] }>(`/workspaces/${workspaceId}/invites`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['members', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['invites', workspaceId] });
  };

  const changeRole = useMutation({
    mutationFn: ({ userId, roleKey }: { userId: string; roleKey: string }) =>
      api.post(`/workspaces/${workspaceId}/members/${userId}/role`, { roleKey }),
    onSuccess: () => {
      toast({ title: 'Role updated', variant: 'success' });
      invalidate();
    },
    onError: (error) => {
      toast({
        title: 'Could not change role',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/workspaces/${workspaceId}/members/${userId}`),
    onSuccess: () => {
      toast({
        title: 'Member removed',
        description: 'Their workspace access was suspended.',
        variant: 'success',
      });
      invalidate();
    },
    onError: (error) => {
      toast({
        title: 'Could not remove member',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => api.delete(`/workspaces/${workspaceId}/invites/${inviteId}`),
    onSuccess: invalidate,
  });

  if (!workspace) {
    return (
      <EmptyState
        icon={Users}
        title="Create a workspace to build your team"
        description="Workspaces hold your assets, members and history. Set one up in Settings, then invite teammates from here."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  const members = membersQuery.data?.members ?? [];
  const pendingInvites = (invitesQuery.data?.invites ?? []).filter((invite) => invite.status === 'pending');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description={`Members of ${workspace.name}. Roles control what everyone can do — the server enforces them on every request.`}
        actions={
          canManage ? (
            <Button onClick={() => setInviteOpen(true)}>
              <MailPlus aria-hidden="true" className="h-4 w-4" />
              Invite teammate
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {workspace.mode === 'home' ? <Home className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
            Members
          </CardTitle>
          <CardDescription>
            {membersQuery.data
              ? `${members.length} ${members.length === 1 ? 'member' : 'members'}`
              : 'People in this workspace'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading && <p className="text-sm text-muted-foreground">Loading members…</p>}
          {membersQuery.isError && (
            <p className="text-sm text-danger">Could not load members. Try again in a moment.</p>
          )}
          <ul className="flex flex-col divide-y divide-border">
            {members.map((member) => (
              <li key={member.membershipId} className="flex flex-wrap items-center gap-3 py-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-subtle text-xs font-bold text-accent-subtle-foreground"
                >
                  {member.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{member.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                </span>
                {member.status !== 'active' && (
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {member.status}
                  </Badge>
                )}
                {canManage ? (
                  <Select
                    aria-label={`Role for ${member.displayName}`}
                    className="h-8 w-28 text-xs"
                    value={member.role}
                    onChange={(event) =>
                      changeRole.mutate({ userId: member.userId, roleKey: event.target.value })
                    }
                  >
                    {(workspace.role === 'owner'
                      ? ['owner', ...ASSIGNABLE_ROLES]
                      : ['manager', 'member', 'auditor']
                    ).map((role) => (
                      <option
                        key={role}
                        value={role}
                        disabled={role === 'owner' && member.role !== 'owner' && workspace.role !== 'owner'}
                      >
                        {role}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge variant="outline" className="capitalize">
                    {member.role}
                  </Badge>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setRemoveTarget(member)}
                    aria-label={`Remove ${member.displayName}`}
                    className="rounded-md p-2 text-muted-foreground hover:bg-danger-subtle hover:text-danger"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="h-4 w-4 text-warning" />
              Pending invites
            </CardTitle>
            <CardDescription>
              Invite links not yet accepted. Revoking one disables it immediately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invitesQuery.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading invites…
              </p>
            ) : invitesQuery.isError ? (
              <p role="alert" className="text-sm text-danger">
                Could not load pending invites.
              </p>
            ) : pendingInvites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending invites.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {pendingInvites.map((invite) => (
                  <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{invite.email}</span>
                      <span className="block text-xs text-muted-foreground">
                        role: {invite.roleKey} · expires {new Date(invite.expiresAt).toLocaleDateString()}
                      </span>
                    </span>
                    <Button variant="outline" size="sm" onClick={() => revokeInvite.mutate(invite.id)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        workspaceId={workspaceId!}
        onCreated={(invite) => {
          setCreatedInvite(invite);
          invalidate();
        }}
      />

      {createdInvite && (
        <Dialog
          open
          onClose={() => setCreatedInvite(null)}
          title="Invite link ready"
          description="This link is shown once. Copy it now and share it over a channel you trust."
          footer={<Button onClick={() => setCreatedInvite(null)}>Done</Button>}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="accept-url">Accept URL for {createdInvite.email}</Label>
            <div className="flex gap-2">
              <Input id="accept-url" readOnly value={createdInvite.acceptUrl} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                aria-label="Copy invite link"
                onClick={() => {
                  void navigator.clipboard?.writeText(createdInvite.acceptUrl);
                  toast({ title: 'Copied to clipboard', variant: 'success' });
                }}
              >
                <Copy aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Anyone with this link can join as {createdInvite.roleKey}. It expires in 7 days and is
              single-use.
            </p>
          </div>
        </Dialog>
      )}

      {removeTarget && (
        <ConfirmDialog
          open
          onClose={() => setRemoveTarget(null)}
          onConfirm={() => removeMember.mutate(removeTarget.userId)}
          title={`Remove ${removeTarget.displayName}?`}
          description="They will immediately lose access to this workspace. Their custody history is preserved. You can invite them again later."
          confirmLabel="Remove member"
          tone="danger"
        />
      )}
    </div>
  );
}
