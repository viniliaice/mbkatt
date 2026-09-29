/**
 * Export controls shared by every report view. Each button exports exactly the
 * dataset that is on screen (same rows, same filters), never a re-computation.
 */

import { FileJson, FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui';
import { downloadCsv, downloadExcel, downloadJson, downloadPdf, type Dataset } from '@/lib/reports';
import type { AnalysisResult } from '@/lib/types';

function useExportState() {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  return { busy, setBusy, error, setError };
}

export function ExportButtons({
  dataset,
  baseName,
  result,
  size = 'sm',
  variant = 'outline',
  summaryLines,
}: {
  dataset: Dataset;
  baseName: string;
  result: AnalysisResult;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  summaryLines?: string[];
}) {
  const { busy, setBusy, error, setError } = useExportState();

  const run = async (kind: string, action: () => void | Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const disabled = Boolean(busy);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => run('csv', () => downloadCsv(dataset, baseName))}
      >
        {busy === 'csv' ? <Loader2 className="animate-spin" /> : <FileText />} CSV
      </Button>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => run('excel', () => downloadExcel(dataset, baseName))}
      >
        {busy === 'excel' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
      </Button>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => run('pdf', () => downloadPdf(dataset, baseName, result, { summaryLines }))}
      >
        {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <Printer />} PDF
      </Button>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => run('json', () => downloadJson(dataset, baseName, result))}
      >
        {busy === 'json' ? <Loader2 className="animate-spin" /> : <FileJson />} JSON
      </Button>
      {error ? <span className="text-xs text-red-600 dark:text-red-400">Export failed: {error}</span> : null}
    </div>
  );
}
