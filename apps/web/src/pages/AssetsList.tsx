import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, PackagePlus, QrCode, Search, Upload } from 'lucide-react';
import type { AssetListQuery, AssetPage } from '@assetnest/sdk';
import { ASSET_STATUSES, AssetStatusBadge } from '../components/AssetStatusBadge';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Button, buttonVariants } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/input';
import { assetsApi } from '../lib/assets-api';
import { cn } from '../lib/utils';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';

type AssetRow = AssetPage['items'][number];

const PAGE_SIZE = 20;

export function AssetsList() {
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [lookup, setLookup] = useState('');
  const page = Number.parseInt(searchParams.get('page') ?? '1', 10) || 1;

  const query = useQuery({
    queryKey: ['assets', workspaceId, q, status, page],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      assetsApi.list(workspaceId, {
        page,
        pageSize: PAGE_SIZE,
        q: q || undefined,
        status: (status || undefined) as AssetListQuery['status'],
      }),
  });

  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams();
    if (q.trim()) next.set('q', q.trim());
    if (status) next.set('status', status);
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

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
        demo={false}
        description="Everything your workspace owns. Search by tag, name or serial — tags are unique per workspace."
        actions={
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
              placeholder="Scan or paste asset code…"
              aria-label="Find asset by QR code or asset ID"
              className="h-10 w-56 pl-9 font-mono text-xs"
            />
          </div>
          <Button type="submit" variant="ghost" size="sm">
            Find
          </Button>
        </form>
      </div>

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
          Could not load assets. Check that the API is running and try again.
        </p>
      )}
      {showEmpty && (
        <EmptyState
          icon={PackagePlus}
          title={q || status ? 'No assets match these filters' : 'Register your first asset'}
          description={
            q || status
              ? 'Try clearing the search or status filter.'
              : 'Laptops, tools, appliances, furniture — if your workspace owns it, it belongs here.'
          }
          actionLabel={q || status ? 'Clear filters' : 'Add first asset'}
          actionHref={q || status ? '/assets' : '/assets/new'}
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
