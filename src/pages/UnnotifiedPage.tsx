import * as React from 'react';
import { BellOff, Calculator, Clock, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/AppShell';
import { DataTable, type Column } from '@/components/DataTable';
import { ExportButtons } from '@/components/ExportButtons';
import { AttendanceCalculationModal } from '@/components/AttendanceCalculationModal';
import { EvidenceModal } from '@/components/EvidencePanel';
import { Alert, Badge, Card, CardContent, StatCard } from '@/components/ui';
import { formatDisplayDate, weekdayShort } from '@/lib/dates';
import { buildDataset } from '@/lib/reports';
import { useStore } from '@/lib/store';
import { minutesToClock } from '@/lib/time';
import type { AuditRecord } from '@/lib/types';
import { matchStatusMeta } from '@/lib/statuses';

export function UnnotifiedPage() {
  const { result, searchQuery } = useStore();
  const [calculationRecord, setCalculationRecord] = React.useState<AuditRecord | null>(null);
  const [evidenceRecord, setEvidenceRecord] = React.useState<AuditRecord | null>(null);

  if (!result) {
    return (
      <>
        <PageHeader
          title="Unnotified attendance"
          description="Biometric lateness or absence with no matching WhatsApp notification."
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

  // Filter directly from Biometric Attendance records (Section 12: Do NOT generate them from WhatsApp)
  const unnotifiedLateRecords = result.auditRecords.filter((record) => {
    if (record.whatsappOnly) return false;
    if (record.biometric.isLate !== true) return false;
    return !record.whatsapp.hasNotification || matchStatusMeta(record.matchStatus).isUnnotified;
  });

  const unnotifiedAbsenceRecords = result.auditRecords.filter((record) => {
    if (record.whatsappOnly) return false;
    if (record.biometric.status !== 'ABSENT') return false;
    return !record.whatsapp.hasNotification || matchStatusMeta(record.matchStatus).isUnnotified;
  });

  const lateDataset = buildDataset('unnotified-late', result);
  const absenceDataset = buildDataset('unnotified-absence', result);

  const affectedEmployees = new Set(
    [...unnotifiedLateRecords, ...unnotifiedAbsenceRecords].map((r) => r.employeeName),
  ).size;

  // TABLE A: UNNOTIFIED LATE ARRIVALS COLUMNS (Specification Section 12)
  const lateColumns: Column<AuditRecord>[] = [
    {
      key: 'date',
      header: 'Date',
      value: (row) => row.date,
      render: (row) => <span className="whitespace-nowrap font-medium">{formatDisplayDate(row.date)}</span>,
    },
    { key: 'weekday', header: 'Day', value: (row) => weekdayShort(row.date) },
    {
      key: 'code',
      header: 'Employee ID',
      value: (row) => row.employeeCode ?? row.employeeId,
      render: (row) => <span className="tabular-nums font-mono text-xs">{row.employeeCode ?? row.employeeId}</span>,
    },
    {
      key: 'name',
      header: 'Employee Name',
      value: (row) => row.employeeName,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.employeeName}</span>,
    },
    { key: 'department', header: 'Department', value: (row) => row.department ?? '—' },
    {
      key: 'firstPunch',
      header: 'First Punch',
      value: (row) => row.biometric.firstPunch ?? -1,
      render: (row) =>
        row.biometric.firstPunch !== null ? (
          <span className="tabular-nums font-semibold">{minutesToClock(row.biometric.firstPunch)}</span>
        ) : (
          <span className="text-[var(--muted-foreground)]">—</span>
        ),
    },
    {
      key: 'lateCutoff',
      header: 'Late Cutoff',
      value: (row) => row.biometric.lateCutoffMinutes ?? -1,
      render: (row) =>
        row.biometric.lateCutoffMinutes !== null ? (
          <span className="tabular-nums">{minutesToClock(row.biometric.lateCutoffMinutes)}</span>
        ) : (
          <span className="text-[var(--muted-foreground)]">—</span>
        ),
    },
    {
      key: 'lateMinutes',
      header: 'Late Minutes',
      value: (row) => row.biometric.lateByMinutes ?? 0,
      render: (row) =>
        row.biometric.lateByMinutes ? (
          <Badge tone="danger">{row.biometric.lateByMinutes} min</Badge>
        ) : (
          <span className="text-[var(--muted-foreground)]">—</span>
        ),
    },
    {
      key: 'waNotification',
      header: 'WhatsApp Notification',
      value: (row) => (row.whatsapp.hasNotification ? 'Notified' : 'None found'),
      render: (row) =>
        row.whatsapp.hasNotification ? (
          <Badge tone="info">Notified</Badge>
        ) : (
          <Badge tone="neutral">None found</Badge>
        ),
    },
    {
      key: 'reason',
      header: 'Reason',
      value: (row) => row.biometric.lateCutoffLabel,
      render: (row) => <span className="text-xs text-[var(--muted-foreground)]">{row.biometric.lateCutoffLabel}</span>,
    },
    {
      key: 'evidence',
      header: 'Evidence',
      value: (row) => row.evidence.map((e) => e.detail).join(' • '),
      render: (row) => (
        <span className="line-clamp-1 max-w-[200px] text-xs text-[var(--muted-foreground)]" title={row.evidence.map((e) => e.detail).join('\n')}>
          {row.evidence[0]?.detail ?? 'Cutoff rule calculation'}
        </span>
      ),
    },
    {
      key: 'calculation',
      header: 'Audit Calculation',
      value: () => 'Calculation',
      render: (row) => (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-xs font-medium hover:bg-[var(--accent)]"
          onClick={(e) => {
            e.stopPropagation();
            setCalculationRecord(row);
          }}
          title="Show attendance calculation"
        >
          <Calculator className="size-3" /> Show Calculation
        </button>
      ),
    },
  ];

  // TABLE B: UNNOTIFIED ABSENCES COLUMNS (Specification Section 12)
  const absenceColumns: Column<AuditRecord>[] = [
    {
      key: 'date',
      header: 'Date',
      value: (row) => row.date,
      render: (row) => <span className="whitespace-nowrap font-medium">{formatDisplayDate(row.date)}</span>,
    },
    { key: 'weekday', header: 'Day', value: (row) => weekdayShort(row.date) },
    {
      key: 'code',
      header: 'Employee ID',
      value: (row) => row.employeeCode ?? row.employeeId,
      render: (row) => <span className="tabular-nums font-mono text-xs">{row.employeeCode ?? row.employeeId}</span>,
    },
    {
      key: 'name',
      header: 'Employee Name',
      value: (row) => row.employeeName,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.employeeName}</span>,
    },
    { key: 'department', header: 'Department', value: (row) => row.department ?? '—' },
    {
      key: 'firstPunch',
      header: 'First Punch',
      value: () => -1,
      render: () => <span className="text-[var(--muted-foreground)]">—</span>,
    },
    {
      key: 'attendanceStatus',
      header: 'Attendance Status',
      value: (row) => row.biometric.statusLabel,
      render: (row) => <Badge tone="danger">{row.biometric.statusLabel}</Badge>,
    },
    {
      key: 'waNotification',
      header: 'WhatsApp Notification',
      value: (row) => (row.whatsapp.hasNotification ? 'Notified' : 'None found'),
      render: (row) =>
        row.whatsapp.hasNotification ? (
          <Badge tone="info">Notified</Badge>
        ) : (
          <Badge tone="neutral">None found</Badge>
        ),
    },
    {
      key: 'exception',
      header: 'Exception',
      value: (row) => (row.biometric.hasRecord ? 'Cell without readable punch' : 'No biometric record found'),
      render: (row) => (
        <span className="text-xs text-[var(--muted-foreground)]">
          {row.biometric.hasRecord ? 'Cell without readable punch' : 'No biometric record found'}
        </span>
      ),
    },
    {
      key: 'evidence',
      header: 'Evidence',
      value: (row) => row.biometric.absentReason || 'No punch on working day',
      render: (row) => (
        <span className="line-clamp-1 max-w-[220px] text-xs text-[var(--muted-foreground)]" title={row.biometric.absentReason}>
          {row.biometric.absentReason || 'No punch on working day'}
        </span>
      ),
    },
    {
      key: 'calculation',
      header: 'Audit Calculation',
      value: () => 'Calculation',
      render: (row) => (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-xs font-medium hover:bg-[var(--accent)]"
          onClick={(e) => {
            e.stopPropagation();
            setCalculationRecord(row);
          }}
          title="Show attendance calculation"
        >
          <Calculator className="size-3" /> Show Calculation
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Unnotified attendance"
        description="Biometric lateness or absence with no matching WhatsApp notification. Generated strictly from biometric attendance records."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Unnotified late arrivals"
          value={unnotifiedLateRecords.length}
          hint="Late per the biometric record, with no matching message on that day"
          tone="warning"
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="Unnotified absences"
          value={unnotifiedAbsenceRecords.length}
          hint="No valid punch and no message for that employee that day"
          tone="danger"
          icon={<UserX className="size-4" />}
        />
        <StatCard
          label="Rows in this report"
          value={unnotifiedLateRecords.length + unnotifiedAbsenceRecords.length}
          hint="Every row carries full calculation evidence"
          icon={<BellOff className="size-4" />}
        />
        <StatCard
          label="Employees affected"
          value={affectedEmployees}
          hint="Distinct names across both unnotified lists"
        />
      </div>

      <Alert tone="warning" title="How to read this page" className="mb-5">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Calculated from Biometrics First:</strong> Attendance and lateness are determined from the biometric
            machine records. WhatsApp is only queried afterwards to check whether a notice was provided.
          </li>
          <li>
            “Unnotified” means: nothing in the uploaded WhatsApp export mentions this employee for that date.
          </li>
          <li>
            Every row includes the exact arrival time, weekday cutoff rule, late minutes, and calculation steps.
          </li>
        </ul>
      </Alert>

      <div className="space-y-6">
        {/* TABLE A: UNNOTIFIED LATE ARRIVALS */}
        <section>
          <Card className="mb-3 p-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-0">
              <div>
                <h2 className="text-base font-semibold">Table A: Potential unnotified late arrivals</h2>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Late per the biometric cutoff (Sat–Wed 06:45, Thu 08:00), with no WhatsApp message found.
                </p>
              </div>
              <ExportButtons
                dataset={lateDataset}
                baseName="mbk-unnotified-lateness"
                result={result}
                summaryLines={[`Unnotified late arrivals: ${unnotifiedLateRecords.length}`]}
              />
            </CardContent>
          </Card>
          <DataTable
            columns={lateColumns}
            rows={unnotifiedLateRecords}
            getRowId={(r) => r.id}
            pageSize={25}
            searchPlaceholder="Search late arrival by employee, ID, department…"
            externalSearch={searchQuery}
            onRowClick={(row) => setEvidenceRecord(row)}
            emptyMessage="No unnotified late arrivals found."
          />
        </section>

        {/* TABLE B: UNNOTIFIED ABSENCES */}
        <section>
          <Card className="mb-3 p-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-0">
              <div>
                <h2 className="text-base font-semibold">Table B: Potential unnotified absences</h2>
                <p className="text-sm text-[var(--muted-foreground)]">
                  No valid punch on a working day and no WhatsApp message found for that person on that date.
                </p>
              </div>
              <ExportButtons
                dataset={absenceDataset}
                baseName="mbk-unnotified-absences"
                result={result}
                summaryLines={[`Unnotified absences: ${unnotifiedAbsenceRecords.length}`]}
              />
            </CardContent>
          </Card>
          <DataTable
            columns={absenceColumns}
            rows={unnotifiedAbsenceRecords}
            getRowId={(r) => r.id}
            pageSize={25}
            searchPlaceholder="Search absence by employee, ID, department…"
            externalSearch={searchQuery}
            onRowClick={(row) => setEvidenceRecord(row)}
            emptyMessage="No unnotified absences found."
          />
        </section>
      </div>

      <AttendanceCalculationModal
        record={calculationRecord}
        open={calculationRecord !== null}
        onClose={() => setCalculationRecord(null)}
      />

      <EvidenceModal
        record={evidenceRecord}
        open={evidenceRecord !== null}
        onClose={() => setEvidenceRecord(null)}
      />
    </>
  );
}
