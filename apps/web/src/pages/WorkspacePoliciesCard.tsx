import type { OperationOptions, OperationResult } from '@assetnest/sdk';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ui/toast';
import { api, isApiError } from '../lib/api';

type WorkspacePolicies = OperationResult<'getWorkspacePolicies'>;
type ExportPolicyInput = OperationOptions<'setWorkspaceExportPolicy'>['body'];

const RETENTION_OPTIONS = [
  { label: 'Keep forever', value: 'forever' },
  { label: '1 year (365 days)', value: '365' },
  { label: '2 years (730 days)', value: '730' },
  { label: '5 years (1825 days)', value: '1825' },
] as const;

const EXPORT_MAX_AGE_OPTIONS = [
  { label: 'Never expire', value: 'never' },
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
] as const;

/**
 * Owner/admin control surface for the P6-01 workspace policies. The server is
 * authoritative; this only calls the policy endpoints.
 */
export function WorkspacePoliciesCard({ workspaceId }: { workspaceId: string | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ['workspace-policies', workspaceId];

  const policiesQuery = useQuery({
    queryKey,
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<WorkspacePolicies>(`/workspaces/${workspaceId}/policies`),
  });

  const [retentionDraft, setRetentionDraft] = useState<string>();
  const [exportDraft, setExportDraft] = useState<ExportPolicyInput>();
  const [pruneOpen, setPruneOpen] = useState(false);

  const currentRetention = policiesQuery.data?.auditRetentionDays;
  const retention = retentionDraft ?? (currentRetention == null ? 'forever' : String(currentRetention));
  const currentExport = policiesQuery.data?.exportPolicy;
  const exportEnabled = exportDraft?.enabled ?? currentExport?.enabled ?? true;
  const exportMaxAgeDays = exportDraft ? exportDraft.maxAgeDays : currentExport?.maxAgeDays;
  const exportMaxAge = exportMaxAgeDays == null ? 'never' : String(exportMaxAgeDays);

  const saveRetention = useMutation({
    mutationFn: (body: OperationOptions<'setWorkspaceAuditRetention'>['body']) =>
      api.put<OperationResult<'setWorkspaceAuditRetention'>>(
        `/workspaces/${workspaceId}/policies/audit-retention`,
        body,
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      setRetentionDraft(undefined);
      toast({ title: 'Audit retention updated', variant: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Could not update retention',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  const saveExportPolicy = useMutation({
    mutationFn: (body: ExportPolicyInput) =>
      api.put<OperationResult<'setWorkspaceExportPolicy'>>(
        `/workspaces/${workspaceId}/policies/export-policy`,
        body,
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      setExportDraft(undefined);
      void queryClient.invalidateQueries({ queryKey: ['exports', workspaceId] });
      toast({ title: 'Export policy updated', variant: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Could not update export policy',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  const prune = useMutation({
    mutationFn: () =>
      api.post<OperationResult<'pruneWorkspaceAuditLog'>>(
        `/workspaces/${workspaceId}/policies/audit-retention/prune`,
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard-audit-log', workspaceId] });
      toast({
        title:
          result.cutoff === null
            ? 'Nothing to prune — retention is set to keep forever'
            : `Pruned ${result.deleted} audit record${result.deleted === 1 ? '' : 's'}`,
        variant: 'success',
      });
    },
    onError: (error) =>
      toast({
        title: 'Could not prune audit history',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  if (!workspaceId) return null;

  const saving = saveRetention.isPending || saveExportPolicy.isPending || prune.isPending;

  const onSubmitRetention = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveRetention.mutate({ retentionDays: retention === 'forever' ? null : Number(retention) });
  };
  const onSubmitExport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveExportPolicy.mutate({ enabled: exportEnabled, maxAgeDays: exportMaxAgeDays ?? null });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <CardTitle>Policies</CardTitle>
          <CardDescription>
            Audit retention and export policy for this workspace. Changes apply to everyone and to files
            already generated.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {policiesQuery.isError ? (
          <p role="alert">Could not load workspace policies.</p>
        ) : policiesQuery.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading policies…
          </p>
        ) : (
          <>
            <form onSubmit={onSubmitRetention} className="flex flex-col gap-2">
              <Label htmlFor="audit-retention">Audit history retention</Label>
              <div className="flex flex-wrap items-end gap-2">
                <Select
                  id="audit-retention"
                  value={retention}
                  disabled={saving}
                  onChange={(event) => setRetentionDraft(event.target.value)}
                >
                  {!RETENTION_OPTIONS.some((option) => option.value === retention) && (
                    <option value={retention}>{retention} days</option>
                  )}
                  {RETENTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm" disabled={saving}>
                  <Save aria-hidden="true" className="h-4 w-4" /> Save retention
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving || currentRetention == null}
                  onClick={() => setPruneOpen(true)}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" /> Prune now
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Pruning permanently deletes audit records older than the window for this workspace only.
              </p>
            </form>

            <form onSubmit={onSubmitExport} className="flex flex-col gap-2">
              <Label htmlFor="export-enabled">Allow CSV exports</Label>
              <div className="flex flex-wrap items-end gap-2">
                <Select
                  id="export-enabled"
                  value={exportEnabled ? 'on' : 'off'}
                  disabled={saving}
                  onChange={(event) =>
                    setExportDraft({
                      enabled: event.target.value === 'on',
                      maxAgeDays: exportMaxAgeDays ?? null,
                    })
                  }
                >
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </Select>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="export-max-age">Expire generated files after</Label>
                  <Select
                    id="export-max-age"
                    value={exportMaxAge}
                    disabled={saving}
                    onChange={(event) =>
                      setExportDraft({
                        enabled: exportEnabled,
                        maxAgeDays: event.target.value === 'never' ? null : Number(event.target.value),
                      })
                    }
                  >
                    {!EXPORT_MAX_AGE_OPTIONS.some((option) => option.value === exportMaxAge) && (
                      <option value={exportMaxAge}>{exportMaxAge} days</option>
                    )}
                    {EXPORT_MAX_AGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" size="sm" disabled={saving}>
                  <Save aria-hidden="true" className="h-4 w-4" /> Save export policy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Disabling blocks creation, listing and download. A shorter expiry applies to files that were
                already generated.
              </p>
            </form>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={pruneOpen}
        onClose={() => setPruneOpen(false)}
        onConfirm={() => prune.mutate()}
        title="Prune audit history?"
        description={`This permanently deletes records older than the saved retention period of ${currentRetention} days.`}
        confirmLabel="Prune audit history"
      />
    </Card>
  );
}
