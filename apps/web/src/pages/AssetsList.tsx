import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, PackagePlus, QrCode, Search, Sparkles, Upload } from 'lucide-react';
import type { AssetListQuery, AssetPage, OperationResult } from '@assetnest/sdk';
import { ASSET_STATUSES, AssetStatusBadge } from '../components/AssetStatusBadge';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Button, buttonVariants } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/input';
import { api, isApiError } from '../lib/api';
import { assetsApi } from '../lib/assets-api';
import { cn } from '../lib/utils';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';

type AssetRow = AssetPage['items'][number];
type FilterDraft = OperationResult<'draftAiInventoryQuery'>['draft'];
type FilterDraftResponse = OperationResult<'draftAiInventoryQuery'>;
type RoutePreview = OperationResult<'previewAiTaskRoute'>;

const PAGE_SIZE = 20;

/** Apply an AI-proposed filter AST to the URL-driven list state. */
function filtersToParams(filters: FilterDraft['filters']): URLSearchParams {
  const next = new URLSearchParams();
  for (const filter of filters) {
    if (filter.field === 'status') next.set('status', filter.value);
    else if (filter.field === 'condition') next.set('condition', filter.value);
    else if (filter.field === 'search') next.set('q', filter.value);
  }
  next.set('page', '1');
  return next;
}

function describeFilters(filters: FilterDraft['filters']): string {
  if (filters.length === 0) return 'No filters';
  return filters
    .map((filter) =>
      filter.field === 'search'
        ? `name contains "${filter.value}"`
        : filter.field === 'status'
          ? `status is ${filter.value}`
          : `condition is ${filter.value}`,
    )
    .join(' · ');
}

export function AssetsList() {
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [condition, setCondition] = useState(searchParams.get('condition') ?? '');
  const [lookup, setLookup] = useState('');
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiConsentRoute, setAiConsentRoute] = useState<string | null>(null);
  const activeWorkspace = useRef(workspaceId);
  const page = Number.parseInt(searchParams.get('page') ?? '1', 10) || 1;

  const canUseAi =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'manager';
  const canManageAssets = ['owner', 'admin', 'manager'].includes(workspace?.role ?? '');
  const hasFilters = Boolean(q || status || condition);

  const preview = useQuery({
    queryKey: ['ai-route-preview', workspaceId, 'natural_language_search'],
    enabled: canUseAi && workspaceId !== undefined,
    queryFn: () =>
      api.get<RoutePreview>(`/workspaces/${workspaceId}/ai/tasks/natural_language_search/preview`),
  });
  const aiAvailable = preview.data?.available === true;
  const aiRouteKey = preview.data?.routeKey ?? '';
  const aiConsented = aiRouteKey !== '' && aiConsentRoute === aiRouteKey;

  const query = useQuery({
    queryKey: ['assets', workspaceId, q, status, condition, page],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      assetsApi.list(workspaceId, {
        page,
        pageSize: PAGE_SIZE,
        q: q || undefined,
        status: (status || undefined) as AssetListQuery['status'],
        condition: (condition || undefined) as AssetListQuery['condition'],
      }),
  });

  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams();
    if (q.trim()) next.set('q', q.trim());
    if (status) next.set('status', status);
    if (condition) next.set('condition', condition);
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

  const askAi = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspaceId || aiBusy || !aiQuestion.trim() || !aiAvailable || !aiConsented) return;
    const requestWorkspace = workspaceId;
    setAiBusy(true);
    setAiError(null);
    setAiNote(null);
    try {
      const result = await api.post<FilterDraftResponse>(`/workspaces/${requestWorkspace}/ai/tasks/query`, {
        question: aiQuestion.trim(),
        consent: true,
        routeKey: aiRouteKey,
      });
      if (requestWorkspace !== activeWorkspace.current) return; // workspace changed — discard
      setSearchParams(filtersToParams(result.draft.filters), { replace: true });
      setAiNote(`Applied: ${describeFilters(result.draft.filters)}`);
      setAiQuestion('');
    } catch (error) {
      if (requestWorkspace !== activeWorkspace.current) return; // workspace changed — discard
      if (isApiError(error) && error.code === 'AI_ROUTE_CHANGED') {
        setAiConsentRoute(null);
      }
      setAiError(isApiError(error) ? error.detail : 'Could not build filters from that request.');
    } finally {
      if (requestWorkspace === activeWorkspace.current) setAiBusy(false);
    }
  };

  // Discard any pending AI state when the workspace changes.
  useEffect(() => {
    activeWorkspace.current = workspaceId;
    setAiBusy(false);
    setAiQuestion('');
    setAiError(null);
    setAiNote(null);
    setAiConsentRoute(null);
  }, [workspaceId]);

  const submitLookup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = lookup.trim();
    // Accept a full assetnest:// URI, a bare UUID, or an asset tag handled by search.
    const uriMatch = raw.match(/^assetnest:\/\/asset\/([0-9a-f-]{36})$/i);
    const uuidMatch = raw.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const target = uriMatch?.[1] ?? uuidMatch?.[0];
    if (target) {
      navigate(`/assets/${target}`);
      return;
    }
    setQ(raw);
    const next = new URLSearchParams();
    if (raw) next.set('q', raw);
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    setSearchParams(next);
  };

  const columns: ReadonlyArray<DataTableColumn<AssetRow>> = [
    {
      key: 'assetTag',
      header: 'Tag',
      render: (row) => (
        <Link
          to={`/assets/${row.id}`}
          className="font-mono text-xs font-semibold text-accent hover:underline"
        >
          {row.assetTag}
        </Link>
      ),
    },
    { key: 'displayName', header: 'Name', className: 'max-w-[16rem] truncate' },
    {
      key: 'serialNumber',
      header: 'Serial',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.serialNumber ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <AssetStatusBadge status={row.status} />,
    },
    { key: 'condition', header: 'Condition', className: 'capitalize' },
    {
      key: 'createdAt',
      header: 'Added',
      render: (row) => (
        <span className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</span>
      ),
    },
  ];

  useEffect(() => {
    setQ(searchParams.get('q') ?? '');
    setStatus(searchParams.get('status') ?? '');
    setCondition(searchParams.get('condition') ?? '');
  }, [searchParams]);

  if (!workspaceId) {
    return (
      <EmptyState
        icon={PackagePlus}
        title="Create a workspace first"
        description="Assets live inside a workspace. Set one up in Settings, then register your first asset here."
        actionLabel="Go to Settings"
        actionHref="/settings"
      />
    );
  }

  const rows = query.data?.items ?? [];
  const showEmpty = !query.isLoading && !query.isError && rows.length === 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Assets"
        description="Everything your workspace owns. Search by tag, name or serial — tags are unique per workspace."
        actions={
          canManageAssets && (
            <>
              <Link to="/imports" className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'gap-2')}>
                <Upload aria-hidden="true" className="h-4 w-4" />
                <span className="hidden sm:inline">Import CSV</span>
              </Link>
              <Link to="/assets/new" className={cn(buttonVariants({ size: 'md' }))}>
                <PackagePlus aria-hidden="true" className="h-4 w-4" />
                New asset
              </Link>
            </>
          )
        }
      />

      {/* Filter row */}
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <form role="search" onSubmit={submitSearch} className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search tag, name, serial…"
              aria-label="Search assets"
              className="h-10 pl-9"
            />
          </div>
          <Select
            aria-label="Filter by status"
            className="w-36"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by condition"
            className="w-36"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
          >
            <option value="">All conditions</option>
            {['new', 'good', 'fair', 'poor', 'damaged', 'unknown'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>

        {/* QR / manual code lookup */}
        <form role="search" onSubmit={submitLookup} className="flex items-center gap-2">
          <div className="relative">
            <QrCode
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
              placeholder="Paste asset code…"
              aria-label="Find asset by QR code or asset ID"
              className="h-10 w-56 pl-9 font-mono text-xs"
            />
          </div>
          <Button type="submit" variant="ghost" size="sm">
            Find
          </Button>
        </form>
      </div>

      {canUseAi && aiAvailable && (
        <form
          onSubmit={askAi}
          className="mb-4 flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent-subtle/40 p-3"
        >
          <p className="text-xs text-muted-foreground">
            AI will send your request to{' '}
            <span className="font-medium text-foreground">
              {[preview.data?.primary, preview.data?.fallback]
                .filter((leg): leg is NonNullable<typeof leg> => leg !== null)
                .map(
                  (leg, index) =>
                    `${index === 0 ? '' : 'fallback '}${leg.connectionName} (${leg.modelLabel})`,
                )
                .join(' or ') || 'a configured AI provider'}
            </span>
            . AI is optional.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Sparkles
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent"
              />
              <Input
                value={aiQuestion}
                onChange={(event) => setAiQuestion(event.target.value)}
                placeholder="Ask AI to filter — e.g. damaged laptops or available assets"
                aria-label="Ask AI to filter assets"
                className="h-10 pl-9"
                disabled={aiBusy}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={aiBusy || !aiQuestion.trim() || !aiConsented}
            >
              {aiBusy ? 'Filtering…' : 'Ask AI'}
            </Button>
            {aiNote && (
              <p role="status" className="text-xs text-muted-foreground sm:ml-2">
                {aiNote}
              </p>
            )}
            {aiError && (
              <p role="alert" className="text-xs text-danger sm:ml-2">
                {aiError}
              </p>
            )}
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border"
              checked={aiConsented}
              onChange={(event) => setAiConsentRoute(event.target.checked ? aiRouteKey : null)}
            />
            <span>I understand my request will be shared with the provider above.</span>
          </label>
        </form>
      )}

      {/* Table */}
      {query.isLoading && (
        <p
          role="status"
          className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground"
        >
          Loading assets…
        </p>
      )}
      {query.isError && (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-subtle p-4 text-sm text-danger-subtle-foreground"
        >
          Could not load assets. Try again in a moment.
        </p>
      )}
      {showEmpty && (
        <EmptyState
          icon={PackagePlus}
          title={hasFilters ? 'No assets match these filters' : 'No assets yet'}
          description={
            hasFilters
              ? 'Try clearing the search, status or condition filter.'
              : canManageAssets
                ? 'Register assets to start tracking your equipment.'
                : 'Assets will appear here when they are added to this workspace.'
          }
          actionLabel={hasFilters ? 'Clear filters' : canManageAssets ? 'Add first asset' : undefined}
          actionHref={hasFilters ? '/assets' : canManageAssets ? '/assets/new' : undefined}
        />
      )}
      {!query.isLoading && rows.length > 0 && (
        <>
          <DataTable caption="Workspace assets" columns={columns} rows={rows} getRowId={(row) => row.id} />
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total} {total === 1 ? 'asset' : 'assets'} · page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next page"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
