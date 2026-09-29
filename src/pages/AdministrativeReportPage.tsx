/**
 * Teacher Attendance Administrative Summary (specification items 29, 33, 34,
 * 35, 36, 37).
 */

import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Filter,
  Printer,
  ShieldCheck,
  Sliders,
  TriangleAlert,
  X,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/AppShell';
import { AdminReviewDialog } from '@/components/AdminReviewDialog';
import { DataTable, tableToCsv, type Column } from '@/components/DataTable';
import { EvidenceModal } from '@/components/EvidencePanel';
import { AdminStatusBadge, ExcuseStatusBadge, LateMinutesBadge } from '@/components/StatusBadges';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  KeyValue,
  Modal,
  Select,
  Separator,
  StatCard,
  Tabs,
} from '@/components/ui';
import { downloadAdminReportExcel, downloadAdminReportPdf, describeAdminRules } from '@/lib/adminReport';
import { ADMIN_EXCUSE_LABELS } from '@/lib/types';
import { formatDisplayDate } from '@/lib/dates';
import { download } from '@/lib/reports';
import { useStore } from '@/lib/store';
import type {
  AdminExcuseStatus,
  AdminLogRow,
  AdminStatus,
  AdminTeacherStats,
  AuditRecord,
} from '@/lib/types';

type SortKey = 'name' | 'rate' | 'late' | 'lateMinutes' | 'absences';

interface AdminFilters {
  from: string;
  to: string;
  employeeId: string;
  department: string;
  grade: string;
  status: AdminStatus | '';
  excuse: AdminExcuseStatus | '';
  onlyLate: boolean;
  onlyAbsent: boolean;
}

const EMPTY_FILTERS: AdminFilters = {
  from: '',
  to: '',
  employeeId: '',
  department: '',
  grade: '',
  status: '',
  excuse: '',
  onlyLate: false,
  onlyAbsent: false,
};

export function AdministrativeReportPage() {
  const { result, settings, searchQuery } = useStore();
  const [filters, setFilters] = React.useState<AdminFilters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = React.useState<SortKey>('name');
  const [tab, setTab] = React.useState<'summary' | 'log'>('summary');
  const [reviewTarget, setReviewTarget] = React.useState<AuditRecord | null>(null);
  const [evidenceTarget, setEvidenceTarget] = React.useState<AuditRecord | null>(null);
  const [rateDetail, setRateDetail] = React.useState<AdminTeacherStats | null>(null);
  const [pdfBusy, setPdfBusy] = React.useState(false);

  if (!result) {
    return (
      <>
        <PageHeader
          title="Teacher Attendance Administrative Summary"
          description="Per-teacher absences, lateness, late minutes, attendance rate and administrative status."
        />
        <Alert tone="info" title="No analysis yet">
          <p>
            Upload your files and run the analysis first —{' '}
            <Link to="/upload" className="underline">
              go to Upload Files
            </Link>
            .
          </p>
        </Alert>
      </>
    );
  }

  const reviews = result.admin.reviews;

  /* ------------------------------------------------------- filtering (spec 35) */
  const matchesFilters = (stats: AdminTeacherStats, log: AdminLogRow[]): boolean => {
    if (filters.employeeId && stats.employeeId !== filters.employeeId) return false;
    if (filters.department && (stats.department ?? '') !== filters.department) return false;
    if (filters.grade && (stats.grade ?? '') !== filters.grade) return false;
    if (filters.status && stats.status !== filters.status) return false;
    if (filters.excuse && !log.some((row) => row.excuseStatus === filters.excuse)) return false;
    if (filters.onlyLate && stats.lateOccurrences === 0) return false;
    if (filters.onlyAbsent && stats.fullAbsencesExcused + stats.fullAbsencesUnexcused + stats.fullAbsencesPending === 0)
      return false;
    if (filters.from || filters.to) {
      const within = log.some(
        (row) => (!filters.from || row.date >= filters.from) && (!filters.to || row.date <= filters.to),
      );
      if (log.length > 0 && !within) return false;
    }
    return true;
  };

  const logByEmployee = new Map<string, AdminLogRow[]>();
  for (const row of result.admin.log) {
    const list = logByEmployee.get(row.employeeId) ?? [];
    list.push(row);
    logByEmployee.set(row.employeeId, list);
  }

  const teacherRows = result.admin.teacherStats
    .filter((stats) => matchesFilters(stats, logByEmployee.get(stats.employeeId) ?? []))
    .sort((a, b) => {
      switch (sortKey) {
        case 'rate':
          return (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1);
        case 'late':
          return b.lateOccurrences - a.lateOccurrences || a.employeeName.localeCompare(b.employeeName);
        case 'lateMinutes':
          return b.totalLateMinutes - a.totalLateMinutes || a.employeeName.localeCompare(b.employeeName);
        case 'absences':
          return (
            b.fullAbsencesExcused + b.fullAbsencesUnexcused + b.fullAbsencesPending -
            (a.fullAbsencesExcused + a.fullAbsencesUnexcused + a.fullAbsencesPending) ||
            a.employeeName.localeCompare(b.employeeName)
          );
        default:
          return a.employeeName.localeCompare(b.employeeName);
      }
    });

  const logRows = result.admin.log
    .filter((row) => {
      if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
      if (filters.department && (row.department ?? '') !== filters.department) return false;
      if (filters.grade && (row.grade ?? '') !== filters.grade) return false;
      if (filters.excuse && row.excuseStatus !== filters.excuse) return false;
      if (filters.status) {
        const stats = result.admin.teacherStats.find((teacher) => teacher.employeeId === row.employeeId);
        if (!stats || stats.status !== filters.status) return false;
      }
      if (filters.onlyLate && row.type !== 'LATE') return false;
      if (filters.onlyAbsent && !['FULL_ABSENT', 'SICK'].includes(row.type)) return false;
      if (filters.from && row.date < filters.from) return false;
      if (filters.to && row.date > filters.to) return false;
      if (searchQuery.trim()) {
        const needle = searchQuery.trim().toLowerCase();
        const haystack = `${row.employeeName} ${row.reasonProvided} ${row.documentation} ${row.administrativeAction} ${row.typeLabel}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
    .filter((row) => teacherRows.some((teacher) => teacher.employeeId === row.employeeId));

  const departments = [...new Set(result.admin.teacherStats.map((teacher) => teacher.department ?? '').filter(Boolean))].sort();
  const grades = [...new Set(result.admin.teacherStats.map((teacher) => teacher.grade ?? '').filter(Boolean))].sort();
  const activeFilters =
    Object.entries(filters).filter(([, value]) => value !== '' && value !== false).length + (searchQuery.trim() ? 1 : 0);

  const filterDescription = [
    filters.from || filters.to ? `period ${filters.from || 'start'} → ${filters.to || 'end'}` : '',
    filters.employeeId
      ? `teacher ${result.admin.teacherStats.find((teacher) => teacher.employeeId === filters.employeeId)?.employeeName ?? ''}`
      : '',
    filters.department ? `department ${filters.department}` : '',
    filters.grade ? `grade ${filters.grade}` : '',
    filters.status ? `administrative status ${filters.status.replace(/_/g, ' ')}` : '',
    filters.excuse ? `excuse status ${ADMIN_EXCUSE_LABELS[filters.excuse]}` : '',
    filters.onlyLate ? 'late only' : '',
    filters.onlyAbsent ? 'absences only' : '',
    searchQuery.trim() ? `search "${searchQuery.trim()}"` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  /* ------------------------------------------------------- export datasets (spec 36) */
  const summaryDataset = {
    title: 'Teacher Attendance Administrative Summary',
    description: `${settings.schoolName} — administrative attendance summary for ${formatDisplayDate(
      result.coverage.firstDate,
    )} to ${formatDisplayDate(result.coverage.lastDate)}. WhatsApp notification and administrative excuse are separate fields; late minutes come from biometric evidence.`,
    filters: filterDescription || undefined,
    columns: [
      'Teacher Name',
      'Department / Grade',
      'Full Absences (Excused)',
      'Full Absences (Unexcused)',
      'Late Occurrences',
      'Total Late Time (Mins)',
      'Attendance Rate (%)',
      'Administrative Status',
      'Status Rule Applied',
    ],
    rows: teacherRows.map((teacher) => [
      teacher.employeeName,
      [teacher.department, teacher.grade].filter(Boolean).join(' / ') || '—',
      teacher.fullAbsencesExcused,
      teacher.fullAbsencesUnexcused,
      teacher.lateOccurrences,
      teacher.totalLateMinutes,
      teacher.attendanceRate === null ? 'n/a' : teacher.attendanceRate.toFixed(1),
      teacher.statusLabel,
      teacher.statusRule,
    ]),
  };

  const logDataset = {
    title: 'Itemized Absence and Late Arrival Log',
    description: `${settings.schoolName} — every itemized absence, late arrival, sick day and early departure with the reason found in the data and the administrative decision recorded.`,
    filters: filterDescription || undefined,
    columns: [
      'Date',
      'Teacher Name',
      'Type',
      'Recorded Time In',
      'Reason Provided',
      'Status',
      'Documentation / Action Taken',
    ],
    rows: logRows.map((row) => [
      row.date,
      row.employeeName,
      row.typeLabel,
      row.recordedTimeIn ?? 'N/A',
      row.reasonProvided,
      ADMIN_EXCUSE_LABELS[row.excuseStatus],
      `${row.documentation} / ${row.administrativeAction}`,
    ]),
  };

  const reviewNotes = Object.values(reviews)
    .filter((entry) => entry.notes.trim() !== '')
    .map((entry) => {
      const record = result.auditRecords.find((item) => item.id === entry.auditId);
      return {
        date: record?.date ?? '',
        employeeName: record?.employeeName ?? 'Unknown',
        reviewer: entry.reviewer,
        note: entry.notes,
      };
    });

  const withAttachment = Object.values(reviews).filter((entry) => entry.attachedFileName).length;

  /* ------------------------------------------------------- table columns */
  const summaryColumns: Column<AdminTeacherStats>[] = [
    {
      key: 'name',
      header: 'Teacher Name',
      value: (row) => row.employeeName,
      render: (row) => (
        <span>
          <span className="font-medium">{row.employeeName}</span>
          {row.employeeCode ? (
            <span className="block text-xs text-[var(--muted-foreground)]">{row.employeeCode}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'department',
      header: 'Department / Grade',
      value: (row) => `${row.department ?? ''} ${row.grade ?? ''}`,
      render: (row) => (
        <span>
          {row.department ?? '—'}
          {row.grade ? <span className="block text-xs text-[var(--muted-foreground)]">Grade {row.grade}</span> : null}
        </span>
      ),
    },
    {
      key: 'excused',
      header: 'Full Absences (Excused)',
      value: (row) => row.fullAbsencesExcused,
      render: (row) =>
        row.fullAbsencesExcused === 0 ? (
          <span className="text-[var(--muted-foreground)]">0</span>
        ) : (
          <Badge tone="success">{row.fullAbsencesExcused}</Badge>
        ),
    },
    {
      key: 'unexcused',
      header: 'Full Absences (Unexcused)',
      value: (row) => row.fullAbsencesUnexcused,
      render: (row) =>
        row.fullAbsencesUnexcused === 0 ? (
          <span className="text-[var(--muted-foreground)]">0</span>
        ) : (
          <Badge tone="danger">{row.fullAbsencesUnexcused}</Badge>
        ),
    },
    {
      key: 'pending',
      header: 'Absences Pending',
      value: (row) => row.fullAbsencesPending,
      render: (row) =>
        row.fullAbsencesPending === 0 ? (
          <span className="text-[var(--muted-foreground)]">0</span>
        ) : (
          <Badge tone="warning">{row.fullAbsencesPending}</Badge>
        ),
      hideOnMobile: true,
    },
    {
      key: 'late',
      header: 'Late Occurrences',
      value: (row) => row.lateOccurrences,
      render: (row) => (row.lateOccurrences === 0 ? '0' : <span className="font-medium">{row.lateOccurrences}</span>),
    },
    {
      key: 'minutes',
      header: 'Total Late Time (Mins)',
      value: (row) => row.totalLateMinutes,
      render: (row) => <span className="tabular-nums">{row.totalLateMinutes}</span>,
    },
    {
      key: 'rate',
      header: 'Attendance Rate (%)',
      value: (row) => row.attendanceRate ?? -1,
      render: (row) =>
        row.attendanceRate === null ? (
          <Badge tone="neutral">n/a</Badge>
        ) : (
          <button
            type="button"
            className="font-medium underline-offset-2 hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              setRateDetail(row);
            }}
            title="Show the calculation"
          >
            {row.attendanceRate.toFixed(1)}%
          </button>
        ),
    },
    {
      key: 'status',
      header: 'Administrative Status',
      value: (row) => row.statusLabel,
      render: (row) => (
        <span className="space-y-1">
          <AdminStatusBadge label={row.statusLabel} tone={row.statusTone} reason={row.statusReason} />
          <span className="block max-w-[260px] text-xs text-[var(--muted-foreground)]">{row.statusReason}</span>
        </span>
      ),
    },
    {
      key: 'notifications',
      header: 'WhatsApp Notifications',
      value: (row) => row.whatsappNotifications,
      hideOnMobile: true,
    },
  ];

  const logColumns: Column<AdminLogRow>[] = [
    {
      key: 'date',
      header: 'Date',
      value: (row) => row.date,
      render: (row) => <span className="whitespace-nowrap font-medium">{formatDisplayDate(row.date)}</span>,
    },
    {
      key: 'teacher',
      header: 'Teacher Name',
      value: (row) => row.employeeName,
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium underline-offset-2 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            const record = result.auditRecords.find((item) => item.id === row.auditId);
            if (record) setEvidenceTarget(record);
          }}
        >
          {row.employeeName}
        </button>
      ),
    },
    { key: 'type', header: 'Type', value: (row) => row.typeLabel },
    {
      key: 'time',
      header: 'Recorded Time In',
      value: (row) => row.recordedTimeIn ?? '',
      render: (row) => (row.recordedTimeIn ? <span className="tabular-nums">{row.recordedTimeIn}</span> : 'N/A'),
    },
    {
      key: 'reason',
      header: 'Reason Provided',
      value: (row) => row.reasonProvided,
      render: (row) => (
        <span className={`block max-w-[360px] text-xs ${row.reasonProvided.startsWith('Not provided') ? 'text-[var(--muted-foreground)] italic' : ''}`}>
          {row.reasonProvided}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      value: (row) => ADMIN_EXCUSE_LABELS[row.excuseStatus],
      render: (row) => <ExcuseStatusBadge status={row.excuseStatus} />,
    },
    {
      key: 'documentation',
      header: 'Documentation / Action Taken',
      value: (row) => `${row.documentation} ${row.administrativeAction}`,
      render: (row) => (
        <span className="block max-w-[300px] text-xs">
          <span className={row.documentation.startsWith('Not provided') ? 'text-[var(--muted-foreground)] italic' : ''}>
            {row.documentation}
          </span>
          <span className="block text-[var(--muted-foreground)]">{row.administrativeAction}</span>
          {row.reviewer ? (
            <span className="block text-[var(--muted-foreground)]">
              by {row.reviewer}
              {row.decidedAt ? ` · ${new Date(row.decidedAt).toLocaleString()}` : ''}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'lateMinutes',
      header: 'Late Minutes',
      value: (row) => row.matchedLateMinutes ?? -1,
      render: (row) => <LateMinutesBadge minutes={row.matchedLateMinutes ?? 0} />,
      hideOnMobile: true,
    },
    {
      key: 'review',
      header: 'Review',
      value: () => '',
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            const record = result.auditRecords.find((item) => item.id === row.auditId);
            if (record) setReviewTarget(record);
          }}
        >
          {row.excuseStatus === 'pending' ? 'Review' : 'Update decision'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Teacher Attendance Administrative Summary"
        description={`${settings.schoolName} — ${formatDisplayDate(result.coverage.firstDate)} to ${formatDisplayDate(
          result.coverage.lastDate,
        )}. WhatsApp notification and administrative excuse are recorded separately; a notification never makes an absence excused by itself.`}
        actions={
          <>
            <Link
              to="/settings"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-medium hover:bg-[var(--accent)]"
            >
              <Sliders className="size-4" /> Thresholds
            </Link>
            <Button
              disabled={pdfBusy}
              onClick={async () => {
                setPdfBusy(true);
                try {
                  await downloadAdminReportPdf(result, { filters: filterDescription, notes: reviewNotes });
                } finally {
                  setPdfBusy(false);
                }
              }}
            >
              <Printer /> {pdfBusy ? 'Preparing…' : 'Administrative report (PDF)'}
            </Button>
          </>
        }
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Teachers in report" value={teacherRows.length} hint={`${result.admin.teacherStats.length} in total`} />
        <StatCard
          label="Absences pending review"
          value={result.admin.teacherStats.reduce((sum, teacher) => sum + teacher.fullAbsencesPending, 0)}
          hint="No administrative decision recorded yet"
          tone="warning"
          icon={<AlertTriangle className="size-4" />}
        />
        <StatCard
          label="Log entries"
          value={logRows.length}
          hint={`${result.admin.log.length} itemized day(s) in total`}
        />
        <StatCard
          label="Review Required / Critical"
          value={result.admin.teacherStats.filter((teacher) => teacher.status !== 'SATISFACTORY' && teacher.status !== 'PERFECT_ATTENDANCE').length}
          hint="Per the configured thresholds"
          tone="danger"
          icon={<TriangleAlert className="size-4" />}
        />
      </section>

      <Alert tone="info" title="How the administrative status is decided" className="mb-4">
        <div className="grid gap-1 md:grid-cols-2">
          {describeAdminRules(settings).map((rule) => (
            <p key={rule}>• {rule}</p>
          ))}
        </div>
        <p className="mt-2">
          Every status shows the exact rule and reason that produced it (hover a status badge). All thresholds are
          editable in{' '}
          <Link to="/settings" className="underline">
            Settings
          </Link>
          .
        </p>
      </Alert>

      {withAttachment > 0 ? (
        <Alert tone="success" title="Documentation recorded" className="mb-4">
          <p>
            {withAttachment} decision(s) reference a supporting document. Only the file name is stored — the document
            itself stays on your computer.
          </p>
        </Alert>
      ) : null}

      {/* ---------------------------------------------------- filters (spec 35) */}
      <Card className="mb-4">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Filter className="size-4" /> Filters
              {activeFilters > 0 ? <Badge tone="primary">{activeFilters} active</Badge> : null}
            </CardTitle>
            <CardDescription>{filterDescription || 'Showing every teacher and every itemized day.'}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFilters(EMPTY_FILTERS)} disabled={activeFilters === 0}>
              <X /> Clear
            </Button>
            <Button
              variant="outline"
              onClick={() => download('mbk-admin-summary.csv', tableToCsv(summaryColumns, teacherRows), 'text/csv;charset=utf-8')}
            >
              <Download /> Teachers (CSV)
            </Button>
            <ExportIconButton
              label="Log (CSV)"
              onClick={() => download('mbk-admin-log.csv', tableToCsv(logColumns, logRows), 'text/csv;charset=utf-8')}
            />
            <Button
              variant="outline"
              onClick={async () => {
                await downloadAdminReportExcel(result, { filters: filterDescription, notes: reviewNotes });
              }}
            >
              <FileSpreadsheet /> Excel (all sections)
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const blob = JSON.stringify({ summary: summaryDataset.rows, log: logDataset.rows, notes: reviewNotes }, null, 2);
                download('mbk-admin-report.json', blob, 'application/json');
              }}
            >
              <Download /> JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">From</label>
            <Input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">To</label>
            <Input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Teacher</label>
            <Select
              value={filters.employeeId}
              onChange={(event) => setFilters({ ...filters, employeeId: event.target.value })}
            >
              <option value="">All teachers</option>
              {result.admin.teacherStats.map((teacher) => (
                <option key={teacher.employeeId} value={teacher.employeeId}>
                  {teacher.employeeName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Department</label>
            <Select
              value={filters.department}
              onChange={(event) => setFilters({ ...filters, department: event.target.value })}
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Grade</label>
            <Select value={filters.grade} onChange={(event) => setFilters({ ...filters, grade: event.target.value })}>
              <option value="">All grades</option>
              {grades.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Administrative status</label>
            <Select
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value as AdminStatus | '' })}
            >
              <option value="">All statuses</option>
              <option value="PERFECT_ATTENDANCE">Perfect Attendance</option>
              <option value="SATISFACTORY">Satisfactory</option>
              <option value="VERBAL_NOTICE">Verbal Notice</option>
              <option value="REVIEW_REQUIRED">Review Required</option>
              <option value="CRITICAL_REVIEW">Critical Review</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Excuse status</label>
            <Select
              value={filters.excuse}
              onChange={(event) => setFilters({ ...filters, excuse: event.target.value as AdminExcuseStatus | '' })}
            >
              <option value="">Excused / Unexcused / Pending</option>
              <option value="excused">Excused</option>
              <option value="unexcused">Unexcused</option>
              <option value="pending">Pending Review</option>
              <option value="leave">Approved Leave</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Sort teachers by</label>
            <Select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="name">Teacher name (A–Z)</option>
              <option value="rate">Attendance rate (lowest first)</option>
              <option value="late">Late occurrences</option>
              <option value="lateMinutes">Total late minutes</option>
              <option value="absences">Absences</option>
            </Select>
          </div>
          <div className="flex items-end gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.onlyLate}
                onChange={(event) => setFilters({ ...filters, onlyLate: event.target.checked })}
              />
              Late only
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.onlyAbsent}
                onChange={(event) => setFilters({ ...filters, onlyAbsent: event.target.checked })}
              />
              Absent only
            </label>
          </div>
        </CardContent>
      </Card>

      <Tabs<'summary' | 'log'>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'summary', label: 'Teacher summary', count: teacherRows.length },
          { value: 'log', label: 'Itemized absence & late log', count: logRows.length },
        ]}
      />

      {tab === 'summary' ? (
        <Card>
          <CardContent className="pt-5">
            <DataTable
              columns={summaryColumns}
              rows={teacherRows}
              getRowId={(row) => row.employeeId}
              initialSort={{ key: 'name', direction: 'asc' }}
              pageSize={25}
              externalSearch={searchQuery}
              searchPlaceholder="Search teacher, department, status…"
              emptyMessage="No teachers match the current filters."
              onRowClick={(row) => setRateDetail(row)}
            />
            <p className="mt-3 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <ShieldCheck className="size-3.5" /> Click a row (or the percentage) to see exactly how the attendance
              rate was calculated.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-5">
            {logRows.length === 0 ? (
              <EmptyState
                title="Nothing in the itemized log"
                description="No absence, late arrival, sick day or early departure matches the current filters. Adjust the filters or run the analysis again."
              />
            ) : (
              <DataTable
                columns={logColumns}
                rows={logRows}
                getRowId={(row) => row.id}
                initialSort={{ key: 'date', direction: 'desc' }}
                pageSize={25}
                externalSearch={searchQuery}
                searchPlaceholder="Search teacher, reason, documentation…"
                emptyMessage="No log entries match the current filters."
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------- attendance-rate details (spec 32) */}
      <Modal
        open={rateDetail !== null}
        onClose={() => setRateDetail(null)}
        title={rateDetail ? `Attendance rate — ${rateDetail.employeeName}` : ''}
        description="Every number below comes from the audited rows; nothing is estimated."
        footer={
          <>
            {rateDetail ? (
              <Button
                variant="outline"
                onClick={() => {
                  const record = result.auditRecords.find((item) => item.employeeId === rateDetail.employeeId && item.biometric.isLate);
                  if (record) setReviewTarget(record);
                }}
                disabled={!result.auditRecords.some((item) => item.employeeId === rateDetail.employeeId && item.biometric.isLate)}
              >
                Review a late arrival
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setRateDetail(null)}>
              Close
            </Button>
          </>
        }
      >
        {rateDetail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <AdminStatusBadge label={rateDetail.statusLabel} tone={rateDetail.statusTone} />
              <Badge tone="neutral">{rateDetail.statusRule}</Badge>
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">{rateDetail.statusReason}</p>
            <Separator />
            {rateDetail.attendanceRate === null ? (
              <Alert tone="warning" title="No rate available">
                <p>{rateDetail.rateDetail.explanation}</p>
              </Alert>
            ) : (
              <>
                <KeyValue
                  label="Attendance rate"
                  value={
                    <span className="text-lg font-semibold">
                      {rateDetail.attendanceRate.toFixed(1)}%
                      <span className="ml-2 text-sm font-normal text-[var(--muted-foreground)]">
                        = {rateDetail.rateDetail.present} ÷ {rateDetail.rateDetail.countedDays}
                      </span>
                    </span>
                  }
                />
                <div className="rounded-lg border border-[var(--border)] p-3 text-sm">
                  <p>Expected working days: {rateDetail.rateDetail.expectedWorkingDays}</p>
                  <p>Present: {rateDetail.rateDetail.present}</p>
                  <p>Approved absence excluded: {rateDetail.rateDetail.excludedExcused}</p>
                  <p>Approved leave excluded: {rateDetail.rateDetail.excludedLeave}</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">{rateDetail.rateDetail.explanation}</p>
                </div>
              </>
            )}
            <Separator />
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="p-3">
                <p className="text-xs uppercase text-[var(--muted-foreground)]">Absences</p>
                <p className="mt-1 text-sm">
                  Excused: {rateDetail.fullAbsencesExcused} · Unexcused: {rateDetail.fullAbsencesUnexcused} · Pending:{' '}
                  {rateDetail.fullAbsencesPending}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-xs uppercase text-[var(--muted-foreground)]">Lateness</p>
                <p className="mt-1 text-sm">
                  {rateDetail.lateOccurrences} occurrence(s) · {rateDetail.totalLateMinutes} confirmed minute(s)
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-xs uppercase text-[var(--muted-foreground)]">Sick / early departure</p>
                <p className="mt-1 text-sm">
                  {rateDetail.sickDays} sick day(s) · {rateDetail.leftEarlyDays} early departure(s)
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-xs uppercase text-[var(--muted-foreground)]">WhatsApp</p>
                <p className="mt-1 text-sm">{rateDetail.whatsappNotifications} notification(s) linked to this teacher</p>
              </Card>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  const record = result.auditRecords
                    .filter((item) => item.employeeId === rateDetail.employeeId)
                    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
                  if (record) setReviewTarget(record);
                  setRateDetail(null);
                }}
              >
                Open the most recent day for review
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <AdminReviewDialog record={reviewTarget} open={reviewTarget !== null} onClose={() => setReviewTarget(null)} />
      <EvidenceModal record={evidenceTarget} open={evidenceTarget !== null} onClose={() => setEvidenceTarget(null)} />
    </>
  );
}

function ExportIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      <Download /> {label}
    </Button>
  );
}
