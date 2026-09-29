/**
 * Renders a report `Dataset` (columns + rows) with the shared table behaviour
 * (sorting, searching, pagination) so every on-screen report matches the file
 * it exports.
 */

import * as React from 'react';
import { DataTable, type Column } from '@/components/DataTable';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import type { Dataset } from '@/lib/reports';

function cellText(value: string | number): string {
  return typeof value === 'number' ? String(value) : value;
}

export function DatasetTable({
  dataset,
  pageSize = 25,
  title,
  externalSearch,
  showHeader = true,
}: {
  dataset: Dataset;
  pageSize?: number;
  title?: string;
  externalSearch?: string;
  showHeader?: boolean;
}) {
  const rows = React.useMemo(
    () => dataset.rows.map((row, index) => ({ id: `${dataset.title}-${index}`, cells: row.map(cellText) })),
    [dataset],
  );

  const columns: Column<{ id: string; cells: string[] }>[] = dataset.columns.map((header, index) => ({
    key: `col-${index}`,
    header,
    value: (row) => row.cells[index] ?? '',
    render: (row) => {
      const value = row.cells[index] ?? '';
      if (value === '') return <span className="text-[var(--muted-foreground)]">—</span>;
      // Long free-text columns (messages, notes) get a clamped cell with a tooltip.
      if (value.length > 120) {
        return (
          <span className="line-clamp-3 block max-w-[420px] whitespace-pre-wrap text-xs" title={value}>
            {value}
          </span>
        );
      }
      return <span className="text-xs">{value}</span>;
    },
    hideOnMobile: index > 4,
  }));

  const table = (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      pageSize={pageSize}
      externalSearch={externalSearch}
      searchPlaceholder={`Search in ${dataset.columns.length} columns…`}
      emptyMessage="Nothing to report — no records match this report's criteria."
    />
  );

  if (!showHeader) return table;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? dataset.title}</CardTitle>
        <CardDescription>
          {dataset.description}
          {dataset.filters ? ` · ${dataset.filters}` : ''} · {dataset.rows.length} record(s)
        </CardDescription>
      </CardHeader>
      <CardContent>{table}</CardContent>
    </Card>
  );
}
