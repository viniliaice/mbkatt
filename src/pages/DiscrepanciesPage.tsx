import { AlertOctagon, Download, ShieldAlert, ShieldQuestion, UserX } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/AppShell';
import { DataTable, tableToCsv, type Column } from '@/components/DataTable';
import { ExportButtons } from '@/components/ExportButtons';
import { EvidenceModal } from '@/components/EvidencePanel';
import { BiometricBadge, MatchStatusBadge, NotificationBadge } from '@/components/StatusBadges';
import { Alert, Badge, Button, Card, CardContent, StatCard } from '@/components/ui';
import { formatDisplayDate } from '@/lib/dates';
import { buildDataset, download } from '@/lib/reports';
import { matchStatusMeta } from '@/lib/statuses';
import { useStore } from '@/lib/store';
import { minutesToClock } from '@/lib/time';
import type { AnalysisResult, AuditRecord } from '@/lib/types';

/** Compact evidence-first listing used by all three sections. */
function RecordTable({
  records,
  onEvidence,
  externalSearch,
}: {
  records: AuditRecord[];
  onEvidence: (record: AuditRecord) => void;
  externalSearch?: string;
}) {
  const columns: Column<AuditRecord>[] = [
    {
      key: 'date',
      header: 'Date',
      value: (row) => row.date,
      render: (row) => <span className="whitespace-nowrap font-medium">{formatDisplayDate(row.date)}</span>,
    },
    {
      key: 'employee',
      header: 'Employee',
      value: (row) => row.employeeName,
      render: (row) => (
        <span>
          {row.employeeName}
          {row.employeeCode ? (
            <span className="block text-xs text-[var(--muted-foreground)]">{row.employeeCode}</span>
          ) : null}
        </span>
      ),
    },
    { key: 'department', header: 'Department', value: (row) => row.department ?? '—', hideOnMobile: true },
    {
      key: 'whatsapp',
      header: 'WhatsApp says',
      value: (row) => row.whatsapp.statusLabel,
      render: (row) => (
        <div className="space-y-1">
          <span>{row.whatsapp.hasNotification ? row.whatsapp.statusLabel : 'nothing found'}</span>
          {row.whatsapp.originalMessages.length > 0 ? (
            <span className="block max-w-[340px] text-xs text-[var(--muted-foreground)]">
              “{row.whatsapp.originalMessages.join(' | ')}”
            </span>
          ) : null}
          {row.whatsapp.times.length > 0 ? (
            <span className="block text-xs text-[var(--muted-foreground)]">
              {row.whatsapp.senders.join(', ')} at {row.whatsapp.times.join(', ')}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'biometric',
      header: 'Biometric says',
      value: (row) => row.biometric.statusLabel,
      render: (row) => (
        <div className="space-y-1">
          <BiometricBadge evaluation={row.biometric} />
          <span className="block text-xs text-[var(--muted-foreground)]">
            {row.biometric.firstPunch !== null
              ? `first punch ${minutesToClock(row.biometric.firstPunch)}`
              : 'no punch recorded'}
            {row.biometric.lastPunch !== null ? ` · last ${minutesToClock(row.biometric.lastPunch)}` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'verdict',
      header: 'Verdict',
      value: (row) => row.matchLabel,
      render: (row) => (
        <div className="space-y-1">
          <MatchStatusBadge status={row.matchStatus} short={false} />
          <NotificationBadge status={row.notificationStatus} />
        </div>
      ),
    },
    {
      key: 'notes',
      header: 'Why',
      value: (row) => row.notes.join(' '),
      render: (row) => (
        <span className="block max-w-[320px] text-xs text-[var(--muted-foreground)]">
          {row.notes.join(' ') || '—'}
        </span>
      ),
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            download('mbk-discrepancy-view.csv', tableToCsv(columns, records), 'text/csv;charset=utf-8')
          }
        >
          <Download /> Export CSV
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={records}
        getRowId={(row) => row.id}
        initialSort={{ key: 'date', direction: 'desc' }}
        pageSize={15}
        externalSearch={externalSearch}
        onRowClick={onEvidence}
        searchPlaceholder="Search employee, message, verdict…"
        emptyMessage="No records in this category."
      />
    </div>
  );
}

function Section({
  title,
  description,
  records,
  dataset,
  baseName,
  result,
  summaryLines,
  onEvidence,
  externalSearch,
  tone,
}: {
  title: string;
  description: string;
  records: AuditRecord[];
  dataset: ReturnType<typeof buildDataset>;
  baseName: string;
  result: AnalysisResult;
  summaryLines: string[];
  onEvidence: (record: AuditRecord) => void;
  externalSearch?: string;
  tone: 'warning' | 'danger';
}) {
  return (
    <section className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-4">
          <div className="flex items-start gap-3">
            <AlertOctagon
              className={`mt-0.5 size-5 ${tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
            />
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="max-w-3xl text-sm text-[var(--muted-foreground)]">{description}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={records.length > 0 ? tone : 'success'}>{records.length} record(s)</Badge>
            <ExportButtons dataset={dataset} baseName={baseName} result={result} summaryLines={summaryLines} />
          </div>
        </CardContent>
      </Card>
      <RecordTable records={records} onEvidence={onEvidence} externalSearch={externalSearch} />
    </section>
  );
}

export function DiscrepanciesPage() {
  const { result, searchQuery } = useStore();
  const [evidence, setEvidence] = React.useState<AuditRecord | null>(null);

  if (!result) {
    return (
      <>
        <PageHeader title="Discrepancies" description="Where the biometric machine and WhatsApp do not agree." />
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

  const conflicts = result.auditRecords.filter((record) => matchStatusMeta(record.matchStatus).isConflict);
  const unnotifiedLate = result.auditRecords.filter((record) => {
    const meta = matchStatusMeta(record.matchStatus);
    return meta.isUnnotified && meta.group === 'late';
  });
  const unnotifiedAbsence = result.auditRecords.filter((record) => {
    const meta = matchStatusMeta(record.matchStatus);
    return meta.isUnnotified && meta.group === 'absent';
  });
  const claimNotConfirmed = result.auditRecords.filter(
    (record) => record.matchStatus === 'WHATSAPP_LATE_NOT_CONFIRMED',
  );

  const conflictDataset = buildDataset('discrepancies', result, conflicts);
  const unnotifiedLateDataset = buildDataset('unnotified-late', result, unnotifiedLate);
  const unnotifiedAbsenceDataset = buildDataset('unnotified-absence', result, unnotifiedAbsence);

  return (
    <>
      <PageHeader
        title="Discrepancies"
        description="Everything in one place where the two sources tell a different story. Each category is exported on its own, and every row keeps its raw message and punch."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Conflicting records"
          value={conflicts.length}
          hint="WhatsApp and biometric disagree"
          tone="danger"
          icon={<ShieldAlert className="size-4" />}
        />
        <StatCard
          label="Unnotified late arrivals"
          value={unnotifiedLate.length}
          hint="Late on the machine, silent in the chat"
          tone="warning"
          icon={<UserX className="size-4" />}
        />
        <StatCard
          label="Unnotified absences"
          value={unnotifiedAbsence.length}
          hint="Absent on the machine, silent in the chat"
          tone="danger"
          icon={<UserX className="size-4" />}
        />
        <StatCard
          label="Claims not confirmed"
          value={claimNotConfirmed.length}
          hint="Late reported on WhatsApp, on-time punch recorded"
          tone="warning"
          icon={<ShieldQuestion className="size-4" />}
        />
      </div>

      <Alert tone="info" title="Important distinction" className="mb-5">
        <p>
          <span className="font-semibold">“WhatsApp-reported lateness — not confirmed”</span> is not proof of
          lateness: the message claims the employee would be late, but the machine recorded a punch before the
          cut-off. <span className="font-semibold">“CONFLICT”</span> means something stronger: the person was
          reported absent (or sick/left early) while the biometric file shows them present. Both are shown below and
          never silently merged.
        </p>
      </Alert>

      <div className="space-y-7">
        <Section
          title="CONFLICT — the two sources contradict each other"
          description="A notification claims a status the biometric record directly contradicts (for example: reported absent but present, reported late but on time, reported present with no punch at all where a record was expected)."
          records={conflicts}
          dataset={conflictDataset}
          baseName="mbk-discrepancy-report"
          result={result}
          summaryLines={[`Conflicting records: ${conflicts.length}`]}
          onEvidence={setEvidence}
          externalSearch={searchQuery}
          tone="danger"
        />

        <Section
          title="UNNOTIFIED LATE ARRIVAL"
          description="The machine shows a late arrival on a working day and no WhatsApp message mentions this employee for that date."
          records={unnotifiedLate}
          dataset={unnotifiedLateDataset}
          baseName="mbk-unnotified-lateness"
          result={result}
          summaryLines={[`Unnotified late arrivals: ${unnotifiedLate.length}`]}
          onEvidence={setEvidence}
          externalSearch={searchQuery}
          tone="warning"
        />

        <Section
          title="UNNOTIFIED ABSENCE"
          description="A working day with no valid punch and no WhatsApp message. A complete absence of readable punches on a day the file does not cover is reported as a parsing problem instead, never as an absence."
          records={unnotifiedAbsence}
          dataset={unnotifiedAbsenceDataset}
          baseName="mbk-unnotified-absences"
          result={result}
          summaryLines={[`Unnotified absences: ${unnotifiedAbsence.length}`]}
          onEvidence={setEvidence}
          externalSearch={searchQuery}
          tone="danger"
        />
      </div>

      <EvidenceModal record={evidence} open={evidence !== null} onClose={() => setEvidence(null)} />
    </>
  );
}
