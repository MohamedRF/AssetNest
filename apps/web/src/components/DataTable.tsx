import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  /** Render cell contents. Falls back to String(row[key]). */
  render?: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  caption: string;
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  getRowId: (row: T) => string;
  /** Rendered in place of the body when there is no data. */
  emptyState?: ReactNode;
}

/**
 * Accessible table shell. Sorting, pagination and row interactions land
 * with the asset list.
 */
export function DataTable<T extends object>({
  caption,
  columns,
  rows,
  getRowId,
  emptyState,
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyState !== undefined) {
    return <div className="w-full">{emptyState}</div>;
  }

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowId(row)} className="border-b border-border last:border-b-0 hover:bg-muted/50">
              {columns.map((column) => (
                <td key={column.key} className={cn('px-4 py-3 align-middle', column.className)}>
                  {column.render
                    ? column.render(row)
                    : String((row as Record<string, unknown>)[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
