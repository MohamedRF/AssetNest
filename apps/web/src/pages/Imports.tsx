import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/input';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { api, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { useToast } from '../components/ui/toast';

const FIELDS = [
  'assetTag',
  'displayName',
  'serialNumber',
  'status',
  'condition',
  'purchaseDate',
  'amount',
  'currency',
  'notes',
  'tags',
  'categoryId',
  'locationId',
] as const;
type Field = (typeof FIELDS)[number];

interface PreviewResponse {
  headers: string[];
  sample: string[][];
  totalRows: number;
  suggestedMapping: Record<string, Field | ''>;
}

interface RunResult {
  total: number;
  imported: number;
  skippedDuplicate: number;
  failed: number;
  errors: Array<{ row: number; field?: string; message: string }>;
  importId?: string;
}

export function Imports() {
  const { toast } = useToast();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const canManage =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'manager';

  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, Field | ''>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const previewMutation = useMutation({
    mutationFn: (csv: string) =>
      api.post<PreviewResponse>(`/workspaces/${workspaceId}/imports/preview`, { csvText: csv }),
    onSuccess: (data) => {
      setPreview(data);
      setMapping(data.suggestedMapping);
      setResult(null);
    },
    onError: (error) => {
      toast({
        title: 'Could not preview the CSV',
        description: isApiError(error) ? error.detail : 'Please check the file and try again.',
        variant: 'warning',
      });
    },
  });

  const dryRunMutation = useMutation({
    mutationFn: (csv: string) =>
      api.post<RunResult>(`/workspaces/${workspaceId}/imports`, {
        csvText: csv,
        mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== '')) as Record<
          string,
          Field
        >,
        onDuplicate: 'skip',
        dryRun: true,
      }),
    onSuccess: (data) => {
      setResult(data);
      toast({
        title: 'Validation complete',
        description: `${data.errors.length} rows need attention`,
        variant: data.errors.length ? 'warning' : 'success',
      });
    },
    onError: (error) => {
      toast({
        title: 'Validation failed',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: (csv: string) =>
      api.post<RunResult>(`/workspaces/${workspaceId}/imports`, {
        csvText: csv,
        mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== '')) as Record<
          string,
          Field
        >,
        onDuplicate: 'skip',
        dryRun: false,
      }),
    onSuccess: (data) => {
      setResult(data);
      toast({
        title: 'Import finished',
        description: `${data.imported} imported, ${data.skippedDuplicate} duplicates skipped`,
        variant: 'success',
      });
    },
    onError: (error) => {
      toast({
        title: 'Import failed',
        description: isApiError(error) ? error.detail : 'Please try again.',
        variant: 'warning',
      });
    },
  });

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    void file.text().then((text) => {
      setCsvText(text);
      previewMutation.mutate(text);
    });
  };

  const activeMapping = useMemo(() => Object.entries(mapping).filter(([, value]) => value !== ''), [mapping]);

  if (!canManage) {
    return (
      <p className="rounded-xl border border-warning/40 bg-warning-subtle p-4 text-sm text-warning-subtle-foreground">
        Your role can view assets but not import them. Ask a manager, admin or owner.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Import assets"
        description="Upload a CSV, map its columns onto AssetNest fields, validate — nothing is written until you press Import. Every row gets a verdict; nothing fails silently."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet aria-hidden="true" className="h-4 w-4" />1 · Choose your CSV
          </CardTitle>
          <CardDescription>First row must be headers. Up to ~5,000 rows.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Upload aria-hidden="true" className="h-4 w-4" />
            {fileName ? `Loaded: ${fileName}` : 'Choose CSV file…'}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
          </label>
          {previewMutation.isPending && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> Parsing…
            </p>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · Map columns ({preview.totalRows} data rows)</CardTitle>
            <CardDescription>
              Suggested mappings are pre-filled — adjust anything that looks wrong.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {preview.headers.map((header) => (
              <div key={header} className="flex items-center gap-2">
                <span className="w-36 truncate font-mono text-xs text-muted-foreground" title={header}>
                  {header}
                </span>
                <Select
                  aria-label={`Map column ${header}`}
                  className="h-8 text-xs"
                  value={mapping[header] ?? ''}
                  onChange={(event) =>
                    setMapping((m) => ({ ...m, [header]: event.target.value as Field | '' }))
                  }
                >
                  <option value="">— ignore —</option>
                  {FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {preview && csvText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3 · Validate</CardTitle>
            <CardDescription>Dry-run reports a verdict per row without writing anything.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => dryRunMutation.mutate(csvText)}
              disabled={dryRunMutation.isPending || activeMapping.length === 0}
            >
              {dryRunMutation.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Validate only
            </Button>
            <Button
              variant="primary"
              onClick={() => setConfirmOpen(true)}
              disabled={importMutation.isPending || activeMapping.length === 0}
            >
              {importMutation.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Import {preview.totalRows} rows
            </Button>
            {activeMapping.length === 0 && (
              <span className="text-xs text-muted-foreground">Map at least one column first.</span>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className={result.errors.length === 0 ? 'border-success/40' : 'border-warning/40'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {result.errors.length === 0 ? (
                <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-success" />
              ) : (
                <XCircle aria-hidden="true" className="h-4 w-4 text-warning" />
              )}
              Import report: {result.total} rows
            </CardTitle>
            <CardDescription>
              {result.imported} imported · {result.skippedDuplicate} duplicates skipped · {result.failed}{' '}
              failed{result.importId ? ` · import ${result.importId.slice(0, 8)}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.errors.length === 0 ? (
              <p className="text-sm">
                Clean run —{' '}
                <Link className="text-accent hover:underline" to="/assets">
                  see your assets
                </Link>
                .
              </p>
            ) : (
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-3">Row</th>
                      <th className="py-1 pr-3">Field</th>
                      <th className="py-1">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((error, index) => (
                      <tr key={`${error.row}-${index}`} className="border-t border-border">
                        <td className="py-1.5 pr-3 font-mono">{error.row}</td>
                        <td className="py-1.5 pr-3">{error.field ?? '—'}</td>
                        <td className="py-1.5">{error.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {confirmOpen && csvText && (
        <ConfirmDialog
          open
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => importMutation.mutate(csvText)}
          title={`Import ${preview?.totalRows ?? ''} rows?`}
          description="Rows that validate cleanly are created; failing rows are reported, never silently skipped. Existing asset tags are skipped as duplicates."
          confirmLabel="Import now"
        />
      )}
    </div>
  );
}
