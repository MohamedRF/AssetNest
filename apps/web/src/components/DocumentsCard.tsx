import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Select } from './ui/input';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './ui/toast';
import { api, getCsrfToken, isApiError } from '../lib/api';

interface DocumentRow {
  id: string;
  kind: string;
  originalName: string;
  mime: string;
  size: number;
  createdAt: string;
}

const EXTENSION_BY_KIND_HINT = 'PDF, PNG, JPEG, WebP or plain text — verified by content, max 10 MB';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Private attachments for one asset. Downloads always go through authorization; links expire with the session. */
export function DocumentsCard({
  workspaceId,
  assetId,
  canManage,
}: {
  workspaceId: string;
  assetId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('invoice');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentRow | null>(null);

  const documentsQuery = useQuery({
    queryKey: ['documents', workspaceId, assetId],
    queryFn: () =>
      api.get<{ documents: DocumentRow[] }>(`/workspaces/${workspaceId}/assets/${assetId}/documents`),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['documents', workspaceId, assetId] });

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('kind', kind);
      formData.append('file', file);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers['x-csrf-token'] = csrf;
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/assets/${assetId}/documents`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: formData,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(body?.detail ?? `Upload failed (${response.status})`);
      }
      toast({ title: 'Document uploaded', variant: 'success' });
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const remove = useMutation({
    mutationFn: (documentId: string) => api.delete(`/workspaces/${workspaceId}/documents/${documentId}`),
    onSuccess: () => {
      toast({ title: 'Document removed', variant: 'success' });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: 'Could not remove document',
        description: isApiError(err) ? err.detail : 'Please try again.',
        variant: 'warning',
      }),
  });

  const documents = documentsQuery.data?.documents ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Documents
          {canManage && (
            <div className="flex items-center gap-2">
              <Select
                aria-label="Document kind"
                className="h-8 w-32 text-xs"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="invoice">Invoice</option>
                <option value="warranty">Warranty</option>
                <option value="manual">Manual</option>
                <option value="service_evidence">Service</option>
                <option value="photo">Photo</option>
                <option value="other">Other</option>
              </Select>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,application/pdf,image/png,image/jpeg,image/webp,text/plain"
                className="sr-only"
                aria-label="Choose a file to upload"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload aria-hidden="true" className="h-4 w-4" />
                )}
                Upload
              </Button>
            </div>
          )}
        </CardTitle>
        <CardDescription>{EXTENSION_BY_KIND_HINT}</CardDescription>
      </CardHeader>
      <CardContent>
        {error !== null && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2 text-sm text-danger-subtle-foreground"
          >
            {error}
          </p>
        )}
        {documentsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading documents…</p>}
        {!documentsQuery.isLoading && documents.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No documents yet. Invoices and warranty evidence keep purchase records audit-ready.
          </p>
        )}
        <ul className="flex flex-col divide-y divide-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 py-2.5">
              <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <a
                className="min-w-0 flex-1 truncate text-sm font-medium text-accent hover:underline"
                href={`/api/v1/workspaces/${workspaceId}/documents/${doc.id}/download`}
                download={doc.originalName}
              >
                {doc.originalName}
              </a>
              <span className="text-xs capitalize text-muted-foreground">{doc.kind.replace('_', ' ')}</span>
              <span className="text-xs text-muted-foreground">{formatSize(doc.size)}</span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setDeleteTarget(doc)}
                  aria-label={`Remove ${doc.originalName}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-subtle hover:text-danger"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>

      {deleteTarget && (
        <ConfirmDialog
          open
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            remove.mutate(deleteTarget.id);
            setDeleteTarget(null);
          }}
          title={`Remove ${deleteTarget.originalName}?`}
          description="The document is hidden from the asset. An administrator can restore it during the retention window."
          confirmLabel="Remove document"
          tone="danger"
        />
      )}
    </Card>
  );
}
