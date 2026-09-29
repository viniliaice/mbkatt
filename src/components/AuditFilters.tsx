/**
 * Audit filters shared by the Audit, Unnotified, Discrepancy and report pages.
 * Filters operate on audited rows only — they never change the underlying data.
 */

import * as React from 'react';
import { Filter, RotateCcw } from 'lucide-react';
import { Button, Card, Checkbox, Input, Label, Select } from '@/components/ui';
import { matchStatusMeta } from '@/lib/statuses';
import type { AnalysisResult, AuditRecord, MatchStatus } from '@/lib/types';

export type QuickFilter =
  | 'late'
  | 'absent'
  | 'sick'
  | 'leftEarly'
  | 'notified'
  | 'unnotified'
  | 'matched'
  | 'conflict'
  | 'uncertain'
  | 'unmatchedName'
  | 'parseIssue';

export interface AuditFilterState {
  from: string;
  to: string;
  employeeId: string;
  department: string;
  matchStatuses: MatchStatus[];
  quick: QuickFilter[];
}

export const EMPTY_FILTERS: AuditFilterState = {
  from: '',
  to: '',
  employeeId: '',
  department: '',
  matchStatuses: [],
  quick: [],
};

export function filtersActive(filters: AuditFilterState): boolean {
  return Boolean(
    filters.from ||
      filters.to ||
      filters.employeeId ||
      filters.department ||
      filters.matchStatuses.length > 0 ||
      filters.quick.length > 0,
  );
}

export function describeFilters(
  filters: AuditFilterState,
  result: AnalysisResult | null,
): string {
  const parts: string[] = [];
  if (filters.from || filters.to) {
    parts.push(`period ${filters.from || 'start'} → ${filters.to || 'end'}`);
  }
  if (filters.employeeId) {
    const employee = result?.employeeSummaries.find((entry) => entry.employeeId === filters.employeeId);
    parts.push(`employee ${employee?.name ?? filters.employeeId}`);
  }
  if (filters.department) parts.push(`department ${filters.department}`);
  if (filters.matchStatuses.length > 0) {
    parts.push(
      `status ${filters.matchStatuses.map((status) => matchStatusMeta(status).shortLabel).join(', ')}`,
    );
  }
  if (filters.quick.length > 0) parts.push(`quick filters ${filters.quick.join(', ')}`);
  return parts.join('; ') || 'none';
}

export function applyAuditFilters(
  records: AuditRecord[],
  filters: AuditFilterState,
  search: string,
): AuditRecord[] {
  const needle = search.trim().toLowerCase();
  return records.filter((record) => {
    if (filters.from && record.date < filters.from) return false;
    if (filters.to && record.date > filters.to) return false;
    if (filters.employeeId && record.employeeId !== filters.employeeId) return false;
    if (filters.department && (record.department ?? '') !== filters.department) return false;
    if (filters.matchStatuses.length > 0 && !filters.matchStatuses.includes(record.matchStatus)) {
      return false;
    }

    const meta = matchStatusMeta(record.matchStatus);
    for (const quick of filters.quick) {
      const ok =
        quick === 'late'
          ? record.biometric.isLate === true
          : quick === 'absent'
            ? record.biometric.status === 'ABSENT'
            : quick === 'sick'
              ? record.biometric.status === 'SICK_LEAVE' ||
                record.whatsapp.events.includes('SICK') ||
                record.whatsapp.events.includes('HOSPITAL')
              : quick === 'leftEarly'
                ? record.biometric.leftEarly === true
                : quick === 'notified'
                  ? record.whatsapp.hasNotification
                  : quick === 'unnotified'
                    ? meta.isUnnotified
                    : quick === 'matched'
                      ? meta.group !== 'review' && !meta.isConflict && record.matchStatus !== 'UNCERTAIN'
                      : quick === 'conflict'
                        ? meta.isConflict
                        : quick === 'uncertain'
                          ? record.matchStatus === 'UNCERTAIN'
                          : quick === 'unmatchedName'
                            ? record.matchStatus === 'WHATSAPP_UNMATCHED_NAME'
                            : quick === 'parseIssue'
                              ? record.biometric.status === 'PARSE_ISSUE'
                              : true;
      if (!ok) return false;
    }

    if (!needle) return true;
    const haystack = [
      record.employeeName,
      record.employeeCode ?? '',
      record.department ?? '',
      record.date,
      record.weekday,
      record.biometric.statusLabel,
      record.whatsapp.statusLabel,
      record.whatsapp.senders.join(' '),
      record.whatsapp.originalMessages.join(' '),
      record.matchLabel,
      record.notes.join(' '),
      record.biometric.firstPunch !== null ? String(record.biometric.firstPunch) : '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

const QUICK_LABELS: { value: QuickFilter; label: string }[] = [
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
  { value: 'sick', label: 'Sick' },
  { value: 'leftEarly', label: 'Left early' },
  { value: 'notified', label: 'Notified' },
  { value: 'unnotified', label: 'Unnotified' },
  { value: 'matched', label: 'Matched' },
  { value: 'conflict', label: 'Conflicting' },
  { value: 'uncertain', label: 'Uncertain' },
  { value: 'unmatchedName', label: 'Unmatched names' },
  { value: 'parseIssue', label: 'Parsing problems' },
];

export function AuditFilterBar({
  filters,
  onChange,
  result,
  showStatuses = true,
  extra,
}: {
  filters: AuditFilterState;
  onChange: (filters: AuditFilterState) => void;
  result: AnalysisResult;
  showStatuses?: boolean;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const departments = React.useMemo(
    () =>
      [...new Set(result.attendanceEmployees.map((employee) => employee.department).filter(Boolean))]
        .filter((value): value is string => Boolean(value))
        .sort(),
    [result.attendanceEmployees],
  );
  const statusOptions = React.useMemo(
    () =>
      [...new Set(result.auditRecords.map((record) => record.matchStatus))].sort(
        (a, b) => (matchStatusMeta(a).index ?? 99) - (matchStatusMeta(b).index ?? 99),
      ),
    [result.auditRecords],
  );

  const patch = (value: Partial<AuditFilterState>) => onChange({ ...filters, ...value });
  const active = filtersActive(filters);

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={filters.from}
          onChange={(event) => patch({ from: event.target.value })}
          aria-label="From date"
          className="w-[150px]"
        />
        <span className="text-sm text-[var(--muted-foreground)]">to</span>
        <Input
          type="date"
          value={filters.to}
          onChange={(event) => patch({ to: event.target.value })}
          aria-label="To date"
          className="w-[150px]"
        />
        <Select
          value={filters.employeeId}
          onChange={(event) => patch({ employeeId: event.target.value })}
          aria-label="Employee"
          className="w-[190px]"
        >
          <option value="">All employees</option>
          {result.employeeSummaries.map((employee) => (
            <option key={employee.employeeId} value={employee.employeeId}>
              {employee.name}
            </option>
          ))}
        </Select>
        <Select
          value={filters.department}
          onChange={(event) => patch({ department: event.target.value })}
          aria-label="Department"
          className="w-[170px]"
        >
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          <Filter /> {open ? 'Hide filters' : 'More filters'}
          {active ? (
            <span className="rounded-full bg-[var(--primary)]/15 px-1.5 text-xs">
              {filters.quick.length + filters.matchStatuses.length + (filters.from ? 1 : 0) + (filters.to ? 1 : 0) + (filters.employeeId ? 1 : 0) + (filters.department ? 1 : 0)}
            </span>
          ) : null}
        </Button>
        {active ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
            <RotateCcw /> Reset
          </Button>
        ) : null}
        {extra ? <div className="ml-auto flex flex-wrap items-center gap-2">{extra}</div> : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
          <div>
            <Label className="mb-2 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Quick filters
            </Label>
            <div className="flex flex-wrap gap-3">
              {QUICK_LABELS.map((entry) => (
                <label key={entry.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={filters.quick.includes(entry.value)}
                    onChange={(event) =>
                      patch({
                        quick: event.target.checked
                          ? [...filters.quick, entry.value]
                          : filters.quick.filter((value) => value !== entry.value),
                      })
                    }
                  />
                  {entry.label}
                </label>
              ))}
            </div>
          </div>

          {showStatuses ? (
            <div>
              <Label className="mb-2 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Match status
              </Label>
              <div className="flex flex-wrap gap-3">
                {statusOptions.map((status) => {
                  const meta = matchStatusMeta(status);
                  return (
                    <label key={status} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={filters.matchStatuses.includes(status)}
                        onChange={(event) =>
                          patch({
                            matchStatuses: event.target.checked
                              ? [...filters.matchStatuses, status]
                              : filters.matchStatuses.filter((value) => value !== status),
                          })
                        }
                      />
                      <span>
                        {meta.index !== null ? `#${meta.index} ` : ''}
                        {meta.shortLabel}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
