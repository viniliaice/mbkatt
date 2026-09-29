import { Badge, Button, Modal, KeyValue } from '@/components/ui';
import { formatDisplayDate } from '@/lib/dates';
import type { AuditRecord } from '@/lib/types';

export interface AttendanceCalculationModalProps {
  open: boolean;
  onClose: () => void;
  record: AuditRecord | null;
}

export function AttendanceCalculationModal({
  open,
  onClose,
  record,
}: AttendanceCalculationModalProps) {
  if (!record) return null;

  const debug = record.calculationDebug;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Attendance Calculation Audit"
      description={`Step-by-step verification of how the attendance engine calculated this verdict.`}
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Core Calculation Key/Values */}
        <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <KeyValue label="Employee" value={`${record.employeeName} (${record.employeeCode ?? record.employeeId})`} />
          <KeyValue label="Department" value={record.department ?? '—'} />
          <KeyValue label="Date" value={`${formatDisplayDate(record.date)} (${record.weekday})`} />
          <KeyValue label="First Punch" value={debug?.firstPunch ?? 'None recorded'} />
          <KeyValue label="Last Punch" value={debug?.lastPunch ?? '—'} />
          <KeyValue label="Punch Count" value={debug?.punchCount ?? record.biometric.punchCount} />
          <KeyValue label="Cutoff Rule" value={debug?.cutoff ?? 'N/A'} />
          <KeyValue label="Late Minutes" value={`${debug?.lateMinutes ?? 0} mins`} />
        </div>

        {/* Step-by-Step Logic Breakdown */}
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Calculation Engine Steps
          </h4>
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2">
              <span className="font-mono font-semibold text-[var(--primary)]">1. Working Day:</span>
              <span>{record.biometric.workingDayReason}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-mono font-semibold text-[var(--primary)]">2. Punch Comparison:</span>
              <span className="font-mono">{debug?.comparison ?? 'Evaluated'}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-mono font-semibold text-[var(--primary)]">3. Biometric Verdict:</span>
              <span className="font-semibold">{debug?.calculatedStatus ?? record.biometric.status}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-mono font-semibold text-[var(--primary)]">4. WhatsApp Search:</span>
              <span>{debug?.whatsappMatch ?? 'None'}</span>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-[var(--border)]">
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">Final Matrix Status:</span>
              <Badge tone={record.finalStatus?.includes('UNNOTIFIED') ? 'danger' : record.finalStatus?.includes('NOTIFIED') ? 'warning' : 'success'}>
                {record.finalStatus ?? record.matchLabel}
              </Badge>
            </div>
          </div>
        </div>

        {/* Evidence Logs */}
        {record.evidence.length > 0 && (
          <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Underlying Evidence
            </h4>
            <ul className="space-y-1.5 text-xs">
              {record.evidence.map((item, idx) => (
                <li key={idx} className="flex flex-col gap-0.5 border-b border-[var(--border)]/40 pb-1.5 last:border-none last:pb-0">
                  <span className="font-medium text-[var(--foreground)]">{item.label}</span>
                  <span className="text-[var(--muted-foreground)]">{item.detail}</span>
                  {item.raw && (
                    <span className="font-mono text-[11px] text-[var(--muted-foreground)]/80 bg-[var(--muted)] px-1.5 py-0.5 rounded">
                      Raw: {item.raw}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
