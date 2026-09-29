/**
 * Generic data table: sorting, client-side pagination and an optional text
 * filter. Every table in the app uses it so behaviour stays consistent.
 */

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from 'lucide-react';
import * as React from 'react';
import { Button, Input, Select, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: string;
  /** value used for sorting and for the CSV export */
  value?: (row: T) => string | number | null | undefined;
  render?: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  /** hide on small screens (still exported) */
  hideOnMobile?: boolean;
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  initialSort?: { key: string; direction: 'asc' | 'desc' };
  pageSize?: number;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  /** extra controls rendered next to the search box */
  toolbar?: React.ReactNode;
  searchPlaceholder?: string;
  externalSearch?: string;
  rowClassName?: (row: T) => string | undefined;
  compact?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  initialSort,
  pageSize = 25,
  emptyMessage = 'No records to show.',
  onRowClick,
  toolbar,
  searchPlaceholder = 'Search…',
  externalSearch,
  rowClassName,
  compact = false,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState(initialSort ?? null);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [size, setSize] = React.useState(pageSize);

  const effectiveSearch = (externalSearch ?? '').trim() || search;

  React.useEffect(() => {
    setPage(1);
  }, [effectiveSearch, size, rows.length]);

  const valueOf = React.useCallback(
    (row: T, column: Column<T>): string | number => {
      if (column.value) {
        const value = column.value(row);
        return value === null || value === undefined ? '' : value;
      }
      const raw = (row as unknown as Record<string, unknown>)[column.key];
      if (raw === null || raw === undefined) return '';
      return typeof raw === 'number' ? raw : String(raw);
    },
    [],
  );

  const searched = React.useMemo(() => {
    if (!effectiveSearch) return rows;
    const needle = effectiveSearch.toLowerCase();
    return rows.filter((row) =>
      columns.some((column) => String(valueOf(row, column)).toLowerCase().includes(needle)),
    );
  }, [columns, effectiveSearch, rows, valueOf]);

  const sorted = React.useMemo(() => {
    if (!sort) return searched;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return searched;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...searched].sort((a, b) => {
      const left = valueOf(a, column);
      const right = valueOf(b, column);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      const asNumber = Number(left);
      const asNumberRight = Number(right);
      if (!Number.isNaN(asNumber) && !Number.isNaN(asNumberRight) && left !== '' && right !== '') {
        return (asNumber - asNumberRight) * direction;
      }
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
    });
  }, [columns, searched, sort, valueOf]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / size));
  const safePage = Math.min(page, pageCount);
  const visible = sorted.slice((safePage - 1) * size, safePage * size);

  const toggleSort = (column: Column<T>) => {
    if (column.sortable === false) return;
    setSort((current) =>
      current?.key === column.key
        ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, direction: 'asc' },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {externalSearch === undefined ? (
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8"
              aria-label="Search table"
            />
          </div>
        ) : null}
        {toolbar}
        <div className="ml-auto flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <span className="tabular-nums">
            {sorted.length} row{sorted.length === 1 ? '' : 's'}
          </span>
          <Select
            aria-label="Rows per page"
            value={String(size)}
            onChange={(event) => setSize(Number(event.target.value))}
            className="h-8 w-[86px] text-xs"
          >
            {[10, 25, 50, 100, 250].map((option) => (
              <option key={option} value={option}>
                {option} / page
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                return (
                  <TH
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      column.headerClassName,
                      column.hideOnMobile ? 'hidden lg:table-cell' : undefined,
                      column.sortable === false ? undefined : 'cursor-pointer select-none',
                    )}
                    aria-sort={isSorted ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => toggleSort(column)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {column.header}
                      {column.sortable === false ? null : isSorted ? (
                        sort?.direction === 'asc' ? (
                          <ChevronUp className="size-3" />
                        ) : (
                          <ChevronDown className="size-3" />
                        )
                      ) : (
                        <ChevronDown className="size-3 opacity-25" />
                      )}
                    </span>
                  </TH>
                );
              })}
            </TR>
          </THead>
          <TBody>
            {visible.map((row) => (
              <TR
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick ? 'cursor-pointer' : undefined, rowClassName?.(row))}
              >
                {columns.map((column) => (
                  <TD
                    key={column.key}
                    className={cn(
                      compact ? 'py-1.5' : undefined,
                      column.hideOnMobile ? 'hidden lg:table-cell' : undefined,
                      column.className,
                    )}
                  >
                    {column.render ? column.render(row) : String(valueOf(row, column) ?? '')}
                  </TD>
                ))}
              </TR>
            ))}
            {visible.length === 0 ? (
              <TR className="hover:bg-transparent">
                <TD colSpan={columns.length} className="py-10 text-center text-[var(--muted-foreground)]">
                  {emptyMessage}
                </TD>
              </TR>
            ) : null}
          </TBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted-foreground)]">
          Page {safePage} of {pageCount}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1}
          >
            <ChevronLeft /> Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={safePage >= pageCount}
          >
            Next <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Exports the currently sorted/filtered table rows as CSV. */
export function tableToCsv<T>(columns: Column<T>[], rows: T[]): string {
  const header = columns.map((column) => escapeCsv(column.header)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        if (column.value) return escapeCsv(column.value(row));
        const raw = (row as unknown as Record<string, unknown>)[column.key];
        return escapeCsv(raw === null || raw === undefined ? '' : String(raw));
      })
      .join(','),
  );
  return [header, ...lines].join('\n');
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
