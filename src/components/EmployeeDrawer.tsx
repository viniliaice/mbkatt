/**
 * Employee profile: summary counters + chronological history.
 * Rendered both as a slide-over (from tables) and inside the Employees page.
 */

import { CalendarCheck, Clock, LogOut, MessageSquare, Phone, ShieldAlert, X } from 'lucide-react';
import * as React from 'react';
import { EvidenceModal } from '@/components/EvidencePanel';
import { BiometricBadge, MatchStatusBadge, NotificationBadge } from '@/components/StatusBadges';
import { Badge, Button, Card, KeyValue, Separator, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatDisplayDate, weekdayShort } from '@/lib/dates';
import { useStore } from '@/lib/store';
import { minutesToClock } from '@/lib/time';
import type { AuditRecord, EmployeeSummary } from '@/lib/types';

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

export function EmployeeHistoryTable({
  summary,
  onEvidence,
}: {
  summary: EmployeeSummary;
  onEvidence: (record: AuditRecord) => void;
}) {
  const history = [...summary.history].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <Table>
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>Day</TH>
            <TH>First punch</TH>
            <TH>Last punch</TH>
            <TH>Attendance</TH>
            <TH>WhatsApp</TH>
            <TH>Notification</TH>
            <TH>Verdict</TH>
            <TH className="text-right">Evidence</TH>
          </TR>
        </THead>
        <TBody>
          {history.map((record) => (
            <TR key={record.id}>
              <TD className="whitespace-nowrap font-medium">{formatDisplayDate(record.date)}</TD>
              <TD>{weekdayShort(record.date)}</TD>
              <TD className="tabular-nums">
                {record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : '—'}
              </TD>
              <TD className="tabular-nums">
                {record.biometric.lastPunch !== null ? minutesToClock(record.biometric.lastPunch) : '—'}
              </TD>
              <TD>
                <BiometricBadge evaluation={record.biometric} />
              </TD>
              <TD className="max-w-[360px]">
                {record.whatsapp.hasNotification ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge tone="info">{record.whatsapp.statusLabel}</Badge>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {record.whatsapp.senders.join(', ')} · {record.whatsapp.times.join(', ')}
                      </span>
                    </div>
                    <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-[var(--muted-foreground)] scrollbar-thin">
                      {record.whatsapp.originalMessages.join('\n---\n')}
                    </pre>
                  </div>
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)]">no message found</span>
                )}
              </TD>
              <TD>
                <NotificationBadge status={record.notificationStatus} />
              </TD>
              <TD>
                <MatchStatusBadge status={record.matchStatus} />
              </TD>
              <TD className="text-right">
                <Button variant="ghost" size="sm" onClick={() => onEvidence(record)}>
                  View original evidence
                </Button>
              </TD>
            </TR>
          ))}
          {history.length === 0 ? (
            <TR>
              <TD colSpan={9} className="text-center text-sm text-[var(--muted-foreground)]">
                No audited days for this employee.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}

export function EmployeeProfile({
  summary,
  onEvidence,
}: {
  summary: EmployeeSummary;
  onEvidence: (record: AuditRecord) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={<CalendarCheck className="size-3.5" />}
          label="Present days"
          value={summary.presentDays}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <Metric
          icon={<Clock className="size-3.5" />}
          label="Late days"
          value={summary.lateDays}
          tone="text-amber-600 dark:text-amber-400"
        />
        <Metric icon={<X className="size-3.5" />} label="Absent days" value={summary.absentDays} tone="text-red-600 dark:text-red-400" />
        <Metric
          icon={<LogOut className="size-3.5" />}
          label="Left early"
          value={summary.leftEarlyDays}
          tone="text-violet-600 dark:text-violet-400"
        />
        <Metric icon={<MessageSquare className="size-3.5" />} label="WhatsApp notifications" value={summary.whatsappNotificationCount} />
        <Metric icon={<X className="size-3.5" />} label="Unnotified late days" value={summary.unnotifiedLateDays} tone="text-amber-600 dark:text-amber-400" />
        <Metric icon={<X className="size-3.5" />} label="Unnotified absences" value={summary.unnotifiedAbsenceDays} tone="text-red-600 dark:text-red-400" />
        <Metric icon={<ShieldAlert className="size-3.5" />} label="Conflicting days" value={summary.conflictDays} tone="text-red-600 dark:text-red-400" />
      </div>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">Employee details</h3>
        <div className="grid gap-x-6 md:grid-cols-2">
          <KeyValue label="Employee ID" value={summary.employeeCode ?? '—'} />
          <KeyValue label="Department" value={summary.department ?? '—'} />
          <KeyValue label="Period observed" value={`${formatDisplayDate(summary.firstDate)} – ${formatDisplayDate(summary.lastDate)}`} />
          <KeyValue label="Working days observed" value={summary.workingDaysObserved} />
          <KeyValue label="On-time days" value={summary.onTimeDays} />
          <KeyValue label="Sick days" value={summary.sickDays} />
          <KeyValue
            label="Attendance rate"
            value={summary.attendanceRate === null ? '—' : `${Math.round(summary.attendanceRate * 100)}%`}
          />
          <KeyValue label="Uncertain days" value={summary.uncertainDays} />
          <KeyValue label="Names used in the chat" value={summary.whatsappNames.join(', ') || '—'} />
        </div>
        {summary.whatsappNames.length === 0 ? (
          <p className="mt-2 flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
            <Phone className="mt-0.5 size-3.5" /> This employee never appears by name in the WhatsApp export — every
            status below comes from the attendance files only.
          </p>
        ) : null}
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Chronological history</h3>
        <EmployeeHistoryTable summary={summary} onEvidence={onEvidence} />
      </div>
    </div>
  );
}

/** Slide-over drawer used from the audit table and the employees list. */
export function EmployeeDrawer({
  employeeId,
  open,
  onClose,
  onEvidence,
}: {
  employeeId: string | null;
  open: boolean;
  onClose: () => void;
  /** optional external handler; when omitted the drawer shows the evidence itself */
  onEvidence?: (record: AuditRecord) => void;
}) {
  const { result } = useStore();
  const [internal, setInternal] = React.useState<AuditRecord | null>(null);
  const summary = result?.employeeSummaries.find((entry) => entry.employeeId === employeeId) ?? null;
  const handleEvidence = onEvidence ?? setInternal;

  return (
    <>
      {open && summary ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
          <div
            role="dialog"
            aria-label={`Employee profile ${summary.name}`}
            className="animate-fade-in h-full w-full max-w-4xl overflow-y-auto bg-[var(--background)] p-5 shadow-2xl scrollbar-thin"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">{summary.name}</h2>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {summary.employeeCode ? `${summary.employeeCode} · ` : ''}
                  {summary.department ?? 'Department not recorded'} · {summary.workingDaysObserved} audited day(s)
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close employee profile">
                <X />
              </Button>
            </div>
            <Separator className="mb-4" />
            <EmployeeProfile summary={summary} onEvidence={handleEvidence} />
          </div>
        </div>
      ) : null}
      {onEvidence ? null : (
        <EvidenceModal record={internal} open={internal !== null} onClose={() => setInternal(null)} />
      )}
    </>
  );
}
