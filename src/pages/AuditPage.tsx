import { AlertTriangle, Download, FileSpreadsheet, Filter, Info, Sparkles, X } from 'lucide-react';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/AppShell';
import {
  AuditFilterBar,
  EMPTY_FILTERS,
  applyAuditFilters,
  describeFilters,
  filtersActive,
  type AuditFilterState,
} from '@/components/AuditFilters';
import { DataTable, tableToCsv, type Column } from '@/components/DataTable';
import { EmployeeDrawer } from '@/components/EmployeeDrawer';
import { EvidenceModal } from '@/components/EvidencePanel';
import { BiometricBadge, MatchStatusBadge, NotificationBadge } from '@/components/StatusBadges';
import { Alert, Badge, Button, Card, CardContent } from '@/components/ui';
import { formatDisplayDate } from '@/lib/dates';
import { download } from '@/lib/reports';
import { useStore } from '@/lib/store';
import { minutesToClock } from '@/lib/time';
import type { AuditRecord } from '@/lib/types';

const QUICK_LABELS: Record<string, string> = {
  late: 'Late',
  absent: 'Absent',
  sick: 'Sick',
  leftEarly: 'Left early',
  notified: 'Notified',
  unnotified: 'Unnotified',
  matched: 'Matched',
  conflict: 'Conflicting',
  uncertain: 'Uncertain',
  unmatchedName: 'Unmatched name',
  parseIssue: 'Parsing issue',
};

export function AuditPage() {
  const { result, searchQuery } = useStore();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = React.useState<AuditFilterState>(() => ({
    ...EMPTY_FILTERS,
    quick: params.getAll('quick') as AuditFilterState['quick'],
  }));
  const [evidence, setEvidence] = React.useState<AuditRecord | null>(null);
  const [employeeId, setEmployeeId] = React.useState<string | null>(params.get('employee'));
  const [showFilters, setShowFilters] = React.useState(true);

  // keep the URL in sync so filtered views can be shared / bookmarked
  React.useEffect(() => {
    const next = new URLSearchParams();
    filters.quick.forEach((quick) => next.append('quick', quick));
    if (filters.from) next.set('from', filters.from);
    if (filters.to) next.set('to', filters.to);
    if (filters.employeeId) next.set('employee', filters.employeeId);
    if (filters.department) next.set('department', filters.department);
    setParams(next, { replace: true });
  }, [filters, setParams]);

  if (!result) {
    return (
      <>
        <PageHeader title="Attendance audit" description="The daily cross-reference of biometric punches and WhatsApp notifications." />
        <Alert tone="info" title="No analysis yet">
          <p>
            Upload your files and run the analysis first — <Link to="/upload" className="underline">go to Upload Files</Link>.
          </p>
        </Alert>
      </>
    );
  }

  const rows = applyAuditFilters(result.auditRecords, filters, searchQuery);

  const columns: Column<AuditRecord>[] = [
    {
      key: 'date',
      header: 'Date',
      value: (row) => row.date,
      render: (row) => <span className="whitespace-nowrap font-medium">{formatDisplayDate(row.date)}</span>,
    },
    { key: 'weekday', header: 'Day', value: (row) => row.weekday },
    {
      key: 'code',
      header: 'Employee ID',
      value: (row) => row.employeeCode ?? '',
      render: (row) => <span className="tabular-nums">{row.employeeCode ?? '—'}</span>,
      hideOnMobile: true,
    },
    {
      key: 'name',
      header: 'Employee name',
      value: (row) => row.employeeName,
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium underline-offset-2 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            setEmployeeId(row.employeeId);
          }}
        >
          {row.employeeName}
        </button>
      ),
    },
    { key: 'department', header: 'Department', value: (row) => row.department ?? '—', hideOnMobile: true },
    {
      key: 'firstPunch',
      header: 'Biometric first punch',
      value: (row) => row.biometric.firstPunch ?? -1,
      render: (row) =>
        row.biometric.firstPunch !== null ? (
          <span className="tabular-nums">{minutesToClock(row.biometric.firstPunch)}</span>
        ) : (
          <span className="text-[var(--muted-foreground)]">no punch</span>
        ),
    },
    {
      key: 'lastPunch',
      header: 'Biometric last punch',
      value: (row) => row.biometric.lastPunch ?? -1,
      render: (row) =>
        row.biometric.lastPunch !== null ? (
          <span className="tabular-nums">{minutesToClock(row.biometric.lastPunch)}</span>
        ) : (
          <span className="text-[var(--muted-foreground)]">—</span>
        ),
      hideOnMobile: true,
    },
    {
      key: 'attendance',
      header: 'Attendance status',
      value: (row) => row.biometric.statusLabel,
      render: (row) => <BiometricBadge evaluation={row.biometric} />,
    },
    {
      key: 'whatsappStatus',
      header: 'WhatsApp status',
      value: (row) => row.whatsapp.statusLabel,
      render: (row) =>
        row.whatsapp.hasNotification ? (
          <span>{row.whatsapp.statusLabel}</span>
        ) : (
          <span className="text-[var(--muted-foreground)]">no message</span>
        ),
    },
    {
      key: 'sender',
      header: 'WhatsApp sender',
      value: (row) => row.whatsapp.senders.join(', '),
      render: (row) => row.whatsapp.senders.join(', ') || '—',
      hideOnMobile: true,
    },
    {
      key: 'waTime',
      header: 'WhatsApp time',
      value: (row) => row.whatsapp.minutesOfDay ?? -1,
      render: (row) => <span className="tabular-nums">{row.whatsapp.times.join(', ') || '—'}</span>,
      hideOnMobile: true,
    },
    {
      key: 'message',
      header: 'WhatsApp original message',
      value: (row) => row.whatsapp.originalMessages.join(' | '),
      render: (row) =>
        row.whatsapp.originalMessages.length === 0 ? (
          <span className="text-[var(--muted-foreground)]">—</span>
        ) : (
          <span className="line-clamp-2 max-w-[320px] text-xs" title={row.whatsapp.originalMessages.join('\n---\n')}>
            {row.whatsapp.originalMessages.join(' | ')}
          </span>
        ),
    },
    {
      key: 'notification',
      header: 'Notification status',
      value: (row) => row.notificationStatus,
      render: (row) => <NotificationBadge status={row.notificationStatus} />,
    },
    {
      key: 'match',
      header: 'Match status',
      value: (row) => row.matchLabel,
      render: (row) => <MatchStatusBadge status={row.matchStatus} />,
    },
    {
      key: 'confidence',
      header: 'Confidence',
      value: (row) => row.confidenceScore,
      render: (row) => (
        <Badge tone={row.confidence === 'high' ? 'success' : row.confidence === 'medium' ? 'warning' : 'danger'}>
          {row.confidence} · {row.confidenceScore}%
        </Badge>
      ),
      hideOnMobile: true,
    },
    {
      key: 'notes',
      header: 'Notes',
      value: (row) => row.notes.join(' '),
      render: (row) =>
        row.notes.length === 0 ? (
          <span className="text-[var(--muted-foreground)]">—</span>
        ) : (
          <span className="line-clamp-2 max-w-[280px] text-xs" title={row.notes.join('\n')}>
            {row.notes.join(' ')}
          </span>
        ),
      hideOnMobile: true,
    },
  ];

  const activeFilterCount = Object.keys(QUICK_LABELS).filter((key) =>
    (filters.quick as string[]).includes(key),
  ).length;

  return (
    <>
      <PageHeader
        title="Attendance audit"
        description={`${result.auditRecords.length} audited employee-days across ${result.coverage.workingDates.length} working days. Every status is explained by the raw evidence behind it.`}
        actions={
          <>
            <Button variant="outline" onClick={() => setShowFilters((value) => !value)}>
              <Filter /> {showFilters ? 'Hide filters' : 'Filters'}
              {activeFilterCount > 0 ? <Badge tone="primary">{activeFilterCount}</Badge> : null}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                download(
                  `mbk-attendance-audit-${result.coverage.firstDate}-to-${result.coverage.lastDate}.csv`,
                  tableToCsv(columns, rows),
                  'text/csv;charset=utf-8',
                )
              }
            >
              <Download /> Export this view
            </Button>
          </>
        }
      />

      {showFilters ? (
        <AuditFilterBar filters={filters} onChange={setFilters} result={result} showStatuses />
      ) : null}

      <Card className="mt-4">
        <CardContent className="pt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="neutral">{rows.length} row(s) shown</Badge>
            {filtersActive(filters) || searchQuery.trim() !== '' ? (
              <>
                <span className="text-[var(--muted-foreground)]">{describeFilters(filters, result)}</span>
                <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  <X /> Clear filters
                </Button>
              </>
            ) : (
              <span className="text-[var(--muted-foreground)]">
                Use the filters to focus on unnotified lateness, absences, conflicts or a single employee.
              </span>
            )}
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            initialSort={{ key: 'date', direction: 'desc' }}
            pageSize={25}
            searchPlaceholder="Search date, name, message text…"
            externalSearch={searchQuery}
            onRowClick={(row) => setEvidence(row)}
            emptyMessage="No audited rows match the current filters."
            rowClassName={(row) =>
              row.matchStatus === 'AGREED' ? undefined : 'bg-[var(--accent)]/40 hover:bg-[var(--accent)]/70'
            }
          />
          <p className="mt-3 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Sparkles className="size-3.5" /> Click any row to open “View original evidence”: the exact WhatsApp
            text, the attendance cell it came from, and the rule that produced the status.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-start gap-3 pt-5 text-sm">
          <Info className="mt-0.5 size-4 text-[var(--muted-foreground)]" />
          <div className="space-y-1 text-[var(--muted-foreground)]">
            <p>
              <span className="font-medium text-[var(--foreground)]">Reading the verdicts:</span> a WhatsApp claim is
              never treated as proof of lateness. “WhatsApp-reported lateness — not confirmed” means the machine
              recorded an on-time punch, so the report and the biometric record disagree about the reason, not about
              attendance.
            </p>
            <p>
              Rows highlighted in colour are the ones worth attention — everything else is either in agreement or has
              no notification to compare against.
            </p>
          </div>
        </CardContent>
      </Card>

      {rows.length === 0 && result.reviewIssues.length > 0 ? (
        <Alert tone="warning" title="Need something else?" className="mt-4">
          <p>
            <AlertTriangle className="mr-1 inline size-4" />
            {result.reviewIssues.length} item(s) are waiting in the{' '}
            <Link to="/review" className="underline">
              Review Center
            </Link>
            .
          </p>
        </Alert>
      ) : null}

      <EvidenceModal record={evidence} open={evidence !== null} onClose={() => setEvidence(null)} />
      <EmployeeDrawer
        employeeId={employeeId}
        open={employeeId !== null}
        onClose={() => setEmployeeId(null)}
        onEvidence={setEvidence}
      />
      <p className="mt-4 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        <FileSpreadsheet className="size-3.5" /> Full audit export with every column is available on the{' '}
        <Link to="/reports" className="underline">
          Reports
        </Link>{' '}
        page.
      </p>
    </>
  );
}
