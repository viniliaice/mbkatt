/**
 * Excel Workbook Preview & Diagnostics Modal (Specifications 2, 22, 23, 24, 25, 29).
 *
 * Provides:
 *  - Overview tab: metadata, sheets detected, employee count, punches, status.
 *  - Sheets tab: preview structured parsed tables for each worksheet with classification & confidence.
 *  - Raw Data tab: inspect original spreadsheet grid with Excel column letters & row numbers.
 *  - Diagnostics tab: cell-level audit (Cell, Raw Value, Detected Type, Parsed Value, Status, Problem, Action).
 */

import * as React from 'react';
import {
  Eye,
  Layers,
  ListChecks,
  PlayCircle,
  Table as TableIcon,
} from 'lucide-react';
import { Badge, Button, Modal, KeyValue, Alert } from '@/components/ui';
import { formatDisplayDate } from '@/lib/dates';
import type {
  ExcelWorkbookMeta,
  ExcelWorkbookParseResult,
} from '@/lib/types';

export interface ExcelWorkbookModalProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  meta: ExcelWorkbookMeta;
  workbookData?: ExcelWorkbookParseResult;
  initialTab?: 'overview' | 'sheets' | 'raw' | 'diagnostics';
  onAnalyze?: () => void;
}

export function ExcelWorkbookModal({
  open,
  onClose,
  fileName,
  meta,
  workbookData,
  initialTab = 'overview',
  onAnalyze,
}: ExcelWorkbookModalProps) {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'sheets' | 'raw' | 'diagnostics'>(initialTab);
  const [selectedSheet, setSelectedSheet] = React.useState<string>(
    meta.sheets[0]?.sheetName ?? '',
  );
  const [diagFilter, setDiagFilter] = React.useState<'ALL' | 'SUCCESS' | 'UNRECOGNIZED' | 'REVIEW' | 'WARNING'>('ALL');

  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  React.useEffect(() => {
    if (meta.sheets.length > 0 && (!selectedSheet || !meta.sheets.some((s) => s.sheetName === selectedSheet))) {
      setSelectedSheet(meta.sheets[0].sheetName);
    }
  }, [meta.sheets, selectedSheet]);

  const currentSheetMeta = meta.sheets.find((s) => s.sheetName === selectedSheet);
  const currentSheetTable = workbookData?.sheetTables[selectedSheet];
  const currentRawGrid = workbookData?.rawGrids[selectedSheet] ?? [];
  const diagnostics = workbookData?.diagnostics ?? [];

  const filteredDiagnostics = React.useMemo(() => {
    if (diagFilter === 'ALL') return diagnostics;
    return diagnostics.filter((d) => d.status === diagFilter);
  }, [diagnostics, diagFilter]);

  const hasSheetErrors = meta.sheets.some((s) => s.status !== 'Parsed');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Excel Workbook — ${fileName}`}
      description={`${meta.formatDescription} · ${meta.sheetCount} worksheets detected`}
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="text-xs text-[var(--muted-foreground)]">
            {meta.employeeCount} employees · {meta.recordCount} attendance records · {meta.punchCount} punches
          </div>
          <div className="flex gap-2">
            {onAnalyze && (
              <Button onClick={() => { onClose(); onAnalyze(); }}>
                <PlayCircle /> Analyze Attendance
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2">
          <Button
            size="sm"
            variant={activeTab === 'overview' ? 'default' : 'outline'}
            onClick={() => setActiveTab('overview')}
          >
            <Eye className="size-3.5" /> Preview Workbook
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'sheets' ? 'default' : 'outline'}
            onClick={() => setActiveTab('sheets')}
          >
            <Layers className="size-3.5" /> Preview Sheets
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'raw' ? 'default' : 'outline'}
            onClick={() => setActiveTab('raw')}
          >
            <TableIcon className="size-3.5" /> Preview Raw Data
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'diagnostics' ? 'default' : 'outline'}
            onClick={() => setActiveTab('diagnostics')}
          >
            <ListChecks className="size-3.5" /> Diagnostics ({diagnostics.length})
          </Button>
        </div>

        {/* 1. OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {hasSheetErrors && (
              <Alert tone="warning" title="Partial Sheet Warning">
                <p>Workbook detected but some sheets could not be parsed. Review individual sheet status below.</p>
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <KeyValue label="File" value={fileName} />
              <KeyValue label="Type" value={meta.formatDescription} />
              <KeyValue label="Sheets detected" value={meta.sheetCount} />
              <KeyValue label="Employees" value={meta.employeeCount} />
              <KeyValue label="Attendance records" value={meta.recordCount} />
              <KeyValue label="Punches" value={meta.punchCount} />
              <KeyValue
                label="Date range"
                value={
                  meta.dateRange.first
                    ? `${formatDisplayDate(meta.dateRange.first)} – ${formatDisplayDate(meta.dateRange.last)}`
                    : '—'
                }
              />
              <KeyValue label="Parsing errors" value={meta.errorCount} />
              <KeyValue label="Warnings" value={meta.warningCount} />
            </div>

            {/* Sheets Breakdown Table */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <h4 className="mb-3 text-sm font-semibold">Sheets Detected ({meta.sheets.length})</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                      <th className="py-2 px-3 font-medium">Sheet Name</th>
                      <th className="py-2 px-3 font-medium">Detected Type</th>
                      <th className="py-2 px-3 font-medium">Rows</th>
                      <th className="py-2 px-3 font-medium">Columns</th>
                      <th className="py-2 px-3 font-medium">Records</th>
                      <th className="py-2 px-3 font-medium">Confidence</th>
                      <th className="py-2 px-3 font-medium">Parsing Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meta.sheets.map((sheet) => (
                      <tr key={sheet.sheetName} className="border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/40">
                        <td className="py-2 px-3 font-medium">{sheet.sheetName}</td>
                        <td className="py-2 px-3">
                          <Badge tone="primary">{sheet.typeLabel}</Badge>
                        </td>
                        <td className="py-2 px-3">{sheet.rowCount}</td>
                        <td className="py-2 px-3">{sheet.columnCount}</td>
                        <td className="py-2 px-3">{sheet.recordCount}</td>
                        <td className="py-2 px-3">{sheet.confidence}%</td>
                        <td className="py-2 px-3">
                          <Badge tone={sheet.status === 'Parsed' ? 'success' : 'warning'}>
                            {sheet.status === 'Parsed' ? '✓ Parsed' : '⚠ Needs review'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 2. SHEETS TAB (Parsed Tables) */}
        {activeTab === 'sheets' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--muted-foreground)]">Worksheet:</span>
                <select
                  value={selectedSheet}
                  onChange={(e) => setSelectedSheet(e.target.value)}
                  className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs font-medium"
                >
                  {meta.sheets.map((s) => (
                    <option key={s.sheetName} value={s.sheetName}>
                      {s.sheetName} ({s.typeLabel})
                    </option>
                  ))}
                </select>
              </div>

              {currentSheetMeta && (
                <div className="flex items-center gap-2">
                  <Badge tone="primary">Type: {currentSheetMeta.typeLabel}</Badge>
                  <Badge tone="neutral">Confidence: {currentSheetMeta.confidence}%</Badge>
                  <Badge tone={currentSheetMeta.status === 'Parsed' ? 'success' : 'warning'}>
                    Status: {currentSheetMeta.status}
                  </Badge>
                </div>
              )}
            </div>

            {currentSheetTable ? (
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] scrollbar-thin">
                <table className="w-full text-xs text-left">
                  <thead className="sticky top-0 bg-[var(--muted)] shadow-xs">
                    <tr className="border-b border-[var(--border)]">
                      <th className="py-2 px-2 text-[var(--muted-foreground)] w-10">#</th>
                      {currentSheetTable.headers.map((h, i) => (
                        <th key={i} className="py-2 px-2 font-medium whitespace-nowrap">
                          {String(h || `Col ${i + 1}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentSheetTable.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="border-b border-[var(--border)]/40 hover:bg-[var(--muted)]/30">
                        <td className="py-1.5 px-2 text-[var(--muted-foreground)] font-mono text-[10px]">
                          {rIdx + 1}
                        </td>
                        {currentSheetTable.headers.map((_, cIdx) => (
                          <td key={cIdx} className="py-1.5 px-2 whitespace-nowrap font-mono text-[11px]">
                            {row[cIdx] !== undefined && row[cIdx] !== null ? String(row[cIdx]) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">No table data available for this sheet.</p>
            )}
          </div>
        )}

        {/* 3. RAW DATA TAB (Grid with cell addresses) */}
        {activeTab === 'raw' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Worksheet:</span>
              <select
                value={selectedSheet}
                onChange={(e) => setSelectedSheet(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs font-medium"
              >
                {meta.sheets.map((s) => (
                  <option key={s.sheetName} value={s.sheetName}>
                    {s.sheetName} ({s.rowCount} rows × {s.columnCount} cols)
                  </option>
                ))}
              </select>
            </div>

            <div className="max-h-[50vh] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2 scrollbar-thin">
              <table className="border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th className="border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-center font-mono text-[10px] text-[var(--muted-foreground)]">
                      #
                    </th>
                    {Array.from({ length: Math.min(35, currentRawGrid[0]?.length || 15) }, (_, i) => {
                      const letter = String.fromCharCode(65 + (i % 26));
                      const prefix = i >= 26 ? 'A' : '';
                      return (
                        <th
                          key={i}
                          className="border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-center font-mono text-[10px] text-[var(--muted-foreground)]"
                        >
                          {prefix + letter}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {currentRawGrid.slice(0, 30).map((row, rIdx) => (
                    <tr key={rIdx}>
                      <td className="border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-center font-mono text-[10px] text-[var(--muted-foreground)]">
                        {rIdx + 1}
                      </td>
                      {Array.from({ length: Math.min(35, currentRawGrid[0]?.length || 15) }, (_, cIdx) => (
                        <td
                          key={cIdx}
                          className="border border-[var(--border)]/60 bg-[var(--card)] px-2 py-1 font-mono text-[11px] whitespace-nowrap"
                        >
                          {row[cIdx] || ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Showing first 30 rows. Legacy Excel formats, merged header spans, and formatted cells are extracted cleanly.
            </p>
          </div>
        )}

        {/* 4. DIAGNOSTICS TAB */}
        {activeTab === 'diagnostics' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="font-medium text-[var(--muted-foreground)]">Filter:</span>
                {(['ALL', 'SUCCESS', 'UNRECOGNIZED', 'REVIEW', 'WARNING'] as const).map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={diagFilter === mode ? 'default' : 'outline'}
                    className="h-7 text-xs px-2"
                    onClick={() => setDiagFilter(mode)}
                  >
                    {mode}
                  </Button>
                ))}
              </div>
              <span className="text-xs text-[var(--muted-foreground)]">
                Showing {filteredDiagnostics.length} of {diagnostics.length} cell audits
              </span>
            </div>

            <div className="max-h-[50vh] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] scrollbar-thin">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-[var(--muted)] shadow-xs">
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-2 px-2 font-medium">Cell</th>
                    <th className="py-2 px-2 font-medium">Sheet</th>
                    <th className="py-2 px-2 font-medium">Raw Value</th>
                    <th className="py-2 px-2 font-medium">Detected Type</th>
                    <th className="py-2 px-2 font-medium">Parsing Result</th>
                    <th className="py-2 px-2 font-medium">Status</th>
                    <th className="py-2 px-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDiagnostics.slice(0, 50).map((d, idx) => (
                    <tr key={idx} className="border-b border-[var(--border)]/40 hover:bg-[var(--muted)]/30">
                      <td className="py-1.5 px-2 font-mono font-medium">{d.cell}</td>
                      <td className="py-1.5 px-2 text-[var(--muted-foreground)]">{d.sheet}</td>
                      <td className="py-1.5 px-2 font-mono">{d.rawValue}</td>
                      <td className="py-1.5 px-2">{d.detectedType}</td>
                      <td className="py-1.5 px-2 font-medium">{d.parsedValue}</td>
                      <td className="py-1.5 px-2">
                        <Badge
                          tone={
                            d.status === 'SUCCESS'
                              ? 'success'
                              : d.status === 'UNRECOGNIZED'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {d.status}
                        </Badge>
                      </td>
                      <td className="py-1.5 px-2 text-[var(--muted-foreground)]">{d.action || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredDiagnostics.length > 50 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                …and {filteredDiagnostics.length - 50} more diagnostic entries recorded.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
