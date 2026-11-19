import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { api, isApiError } from '../../lib/api';
import { useToast } from '../ui/toast';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Dialog } from '../ui/dialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { Input, Select } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';

const SCOPES = [
  'assets:read',
  'assets:write',
  'assets:assign',
  'documents:read',
  'documents:write',
  'audits:manage',
  'reports:read',
  'integrations:manage',
  'ai:use',
  'ai:configure',
  'workspace:manage',
] as const;

const EXPIRY_OPTIONS = [
  { label: '30 days', value: '30' },
  { label: '90 days (recommended)', value: '90' },
  { label: '1 year', value: '365' },
  { label: 'Never expires', value: 'never' },
] as const;

export interface TokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface CreatedToken {
  token: string;
  name: string;
}

function ScopePicker({ selected, onChange }: { selected: string[]; onChange: (scopes: string[]) => void }) {
  const toggle = (scope: string) => {
    onChange(selected.includes(scope) ? selected.filter((s) => s !== scope) : [...selected, scope]);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Scopes</legend>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {SCOPES.map((scope) => (
          <label
            key={scope}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent-subtle"
          >
            <input
              type="checkbox"
              checked={selected.includes(scope)}
              onChange={() => toggle(scope)}
              className="h-3.5 w-3.5 accent-current"
            />
            <span className="font-mono">{scope}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ApiTokensSection({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<TokenRow | null>(null);
  const [copied, setCopied] = useState(false);

  const tokensQuery = useQuery({
    queryKey: ['api-tokens', workspaceId],
    queryFn: () => api.get<{ tokens: TokenRow[] }>(`/workspaces/${workspaceId}/api-tokens`),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['api-tokens', workspaceId] });

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['assets:read']);
  const [expiry, setExpiry] = useState<string>('90');
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<CreatedToken & { id: string; tokenPrefix: string }>(`/workspaces/${workspaceId}/api-tokens`, {
        name: name.trim(),
        scopes,
        expiresInDays: expiry === 'never' ? null : Number.parseInt(expiry, 10),
      }),
    onSuccess: (data) => {
      setCreated({ token: data.token, name: data.name });
      setCreateOpen(false);
      setName('');
      setScopes(['assets:read']);
      setExpiry('90');
      setFormError(null);
      invalidate();
    },
    onError: (error) => {
      setFormError(isApiError(error) ? error.detail : 'Could not create the token.');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => api.delete(`/workspaces/${workspaceId}/api-tokens/${tokenId}`),
    onSuccess: () => {
      toast({ title: 'Token revoked', variant: 'success' });
      invalidate();
    },
    onError: (error) => {
      toast({
        title: 'Could not revoke token',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (tokenId: string) =>
      api.post<CreatedToken & { id: string }>(`/workspaces/${workspaceId}/api-tokens/${tokenId}/rotate`),
    onSuccess: (data) => {
      setCreated({ token: data.token, name: data.name });
      invalidate();
    },
    onError: (error) => {
      toast({
        title: 'Could not rotate token',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (scopes.length === 0) {
      setFormError('Grant at least one scope.');
      return;
    }
    setFormError(null);
    createMutation.mutate();
  };

  const tokens = tokensQuery.data?.tokens ?? [];
  const activeTokens = tokens.filter((token) => !token.revokedAt);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> API tokens
            </CardTitle>
            <CardDescription>
              Scoped bearer tokens for scripts and integrations. Shown once at creation; only a hash is
              stored.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Create token
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {tokensQuery.isLoading && <p className="text-sm text-muted-foreground">Loading tokens…</p>}
        {tokensQuery.isError && (
          <p className="text-sm text-danger">
            Could not load API tokens. You need the <code className="font-mono">integrations:manage</code>{' '}
            permission (owner or admin).
          </p>
        )}
        {!tokensQuery.isLoading && !tokensQuery.isError && activeTokens.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No active tokens. Create one to let scripts call the API.
          </p>
        )}
        <ul className="flex flex-col divide-y divide-border">
          {tokens.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {token.name}
                  {token.revokedAt && (
                    <Badge variant="outline" className="ml-2 text-[10px] uppercase">
                      revoked
                    </Badge>
                  )}
                </span>
                <span className="block font-mono text-xs text-muted-foreground">{token.tokenPrefix}…</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {token.scopes.map((scope) => (
                    <Badge key={scope} variant="outline" className="font-mono text-[10px] font-normal">
                      {scope}
                    </Badge>
                  ))}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {token.expiresAt
                    ? `expires ${new Date(token.expiresAt).toLocaleDateString()}`
                    : 'never expires'}
                  {token.lastUsedAt ? ` · last used ${new Date(token.lastUsedAt).toLocaleDateString()}` : ''}
                </span>
              </div>
              {!token.revokedAt && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => rotateMutation.mutate(token.id)}
                    disabled={rotateMutation.isPending}
                    aria-label={`Rotate ${token.name}`}
                    title="Rotate: issue a new token, revoke the old one"
                    className="rounded-md p-2 text-muted-foreground hover:bg-accent-subtle hover:text-foreground"
                  >
                    <RotateCcw aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRevokeTarget(token)}
                    aria-label={`Revoke ${token.name}`}
                    title="Revoke this token"
                    className="rounded-md p-2 text-muted-foreground hover:bg-danger-subtle hover:text-danger"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create API token"
        description="The token is shown once, right after creation. Store it in your secrets manager."
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              required
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="CI pipeline, n8n bridge, …"
            />
          </div>
          <ScopePicker selected={scopes} onChange={setScopes} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="token-expiry">Expiry</Label>
            <Select id="token-expiry" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          <Button type="submit" disabled={createMutation.isPending} className="self-start">
            {createMutation.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Create token
          </Button>
        </form>
      </Dialog>

      {created && (
        <Dialog
          open
          onClose={() => {
            setCreated(null);
            setCopied(false);
          }}
          title="Token created"
          description="Copy it now — it will never be shown again. Send it as `Authorization: Bearer <token>`."
          footer={
            <Button
              onClick={() => {
                setCreated(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          }
        >
          <Label htmlFor="new-token">Token for {created.name}</Label>
          <div className="mt-1.5 flex gap-2">
            <Input id="new-token" readOnly value={created.token} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              aria-label="Copy token"
              onClick={() => {
                void navigator.clipboard?.writeText(created.token);
                setCopied(true);
              }}
            >
              {copied ? (
                <Check aria-hidden="true" className="h-4 w-4 text-success" />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" />
              )}
            </Button>
          </div>
        </Dialog>
      )}

      {revokeTarget && (
        <ConfirmDialog
          open
          onClose={() => setRevokeTarget(null)}
          onConfirm={() => revokeMutation.mutate(revokeTarget.id)}
          title={`Revoke "${revokeTarget.name}"?`}
          description="Any integration using this token will immediately receive 401 responses. This cannot be undone — create a new token instead."
          confirmLabel="Revoke token"
          tone="danger"
        />
      )}
    </Card>
  );
}
