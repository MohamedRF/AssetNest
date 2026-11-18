import { Download, Package, Plus, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiPendingButton } from '../components/ApiPendingButton';
import { AssetStatusBadge, type AssetStatus } from '../components/AssetStatusBadge';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { buttonVariants } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

/** Row shape the API will hydrate (Phase 1). Kept in sync with the asset registry. */
export interface AssetRow {
  id: string;
  tag: string;
  displayName: string;
  status: AssetStatus;
  condition: string;
  location: string;
  updatedAt: string;
}

// TODO(api): query GET /api/v1/assets with page cursor + filters once the API ships (Phase 1).
const EMPTY_ROWS: readonly AssetRow[] = [];

const assetColumns: ReadonlyArray<DataTableColumn<AssetRow>> = [
  { key: 'tag', header: 'Tag' },
  { key: 'displayName', header: 'Name' },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <AssetStatusBadge status={row.status} />,
  },
  { key: 'condition', header: 'Condition' },
  { key: 'location', header: 'Location' },
  { key: 'updatedAt', header: 'Updated' },
];

export function AssetsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');

  // Keep the field in sync when the topbar search navigates to /assets?q=…
  useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
  }, [searchParams]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return EMPTY_ROWS;
    // Client-side narrowing applies once rows exist; today the registry is empty on purpose.
    return EMPTY_ROWS.filter(
      (row) => row.tag.toLowerCase().includes(needle) || row.displayName.toLowerCase().includes(needle),
    );
  }, [query]);

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    setSearchParams(trimmed.length > 0 ? { q: trimmed } : {}, { replace: true });
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Assets"
        description="Your registry — every asset, its tag, status and where it lives."
        actions={
          <>
            <ApiPendingButton label="Import" icon={Upload} size="md" />
            <ApiPendingButton label="Export" icon={Download} size="md" />
            <Link to="/assets/new" className={cn(buttonVariants({ size: 'md' }))}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              New asset
            </Link>
          </>
        }
      />

      <form role="search" onSubmit={applySearch} className="relative mb-4 max-w-md">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by tag or name…"
          aria-label="Filter assets by tag or name"
          className="pl-9"
        />
      </form>

      <DataTable<AssetRow>
        caption="Asset registry"
        columns={assetColumns}
        rows={filteredRows}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState
            icon={Package}
            title={query.trim().length > 0 ? 'No matches' : 'No assets yet'}
            description={
              query.trim().length > 0
                ? `Nothing in the registry matches “${query.trim()}”. Clear the filter or add a new asset.`
                : 'Create your first asset to start the registry. Imports from CSV and QR label printing arrive with the API (Phase 1).'
            }
            actionLabel="Add your first asset"
            actionHref="/assets/new"
          />
        }
      />

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        {EMPTY_ROWS.length} assets · Import, export, saved filters and bulk actions require the API (Phase 1).
      </p>
    </div>
  );
}
