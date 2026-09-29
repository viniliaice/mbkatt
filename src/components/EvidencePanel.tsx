/**
 * Evidence panel — requirement §23 and §25: every calculated status must be
 * traceable back to the file, date, employee, punch and WhatsApp message that
 * produced it, including the untouched raw text.
 */

import { FileText, MessageSquare, Ruler, Search, ShieldCheck, Sigma, UserCheck } from 'lucide-react';
import * as React from 'react';
import { Badge, Button, Card, KeyValue, Modal, Separator } from '@/components/ui';
import { BiometricBadge, MatchStatusBadge, NotificationBadge } from '@/components/StatusBadges';
import { formatDisplayDate, weekdayShort } from '@/lib/dates';
import { minutesToClock } from '@/lib/time';
import type { AuditRecord, EvidenceItem } from '@/lib/types';

const KIND_META: Record<EvidenceItem['kind'], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  whatsapp: { label: 'WhatsApp message', icon: MessageSquare },
  attendance: { label: 'Attendance file', icon: FileText },
  rule: { label: 'Rule applied', icon: Ruler },
  name: { label: 'Name matching', icon: UserCheck },
  calculation: { label: 'Calculation', icon: Sigma },
  validation: { label: 'Validation note', icon: ShieldCheck },
};

export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No evidence recorded.</p>;
  }
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const meta = KIND_META[item.kind];
        const Icon = meta.icon;
        return (
          <div
            key={`${item.label}-${index}`}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="outline" className="gap-1">
                <Icon className="size-3.5" /> {meta.label}
              </Badge>
              <span className="text-sm font-medium">{item.label}</span>
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{item.detail}</p>
            {item.sourceFile || item.sourceLocation ? (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Source: {item.sourceFile ?? '—'}
                {item.sourceLocation ? ` (${item.sourceLocation})` : ''}
              </p>
            ) : null}
            {item.raw ? (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--muted)] p-2 text-xs scrollbar-thin">
                {item.raw}
              </pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function EvidenceModal({
  record,
  open,
  onClose,
}: {
  record: AuditRecord | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!record) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Evidence — ${record.employeeName}`}
      description={`${formatDisplayDate(record.date)} (${weekdayShort(record.date)}) · every status below is derived from the raw data shown here.`}
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <MatchStatusBadge status={record.matchStatus} short={false} />
          <BiometricBadge evaluation={record.biometric} />
          <NotificationBadge status={record.notificationStatus} />
          <Badge tone={record.confidence === 'high' ? 'success' : record.confidence === 'medium' ? 'warning' : 'danger'}>
            Confidence: {record.confidence} ({record.confidenceScore}%)
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Biometric side</h3>
            <KeyValue label="Employee ID" value={record.employeeCode ?? '—'} />
            <KeyValue label="Department" value={record.department ?? '—'} />
            <KeyValue
              label="First punch"
              value={record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : 'No punch'}
            />
            <KeyValue
              label="Last punch"
              value={record.biometric.lastPunch !== null ? minutesToClock(record.biometric.lastPunch) : '—'}
            />
            <KeyValue label="Punches read" value={record.biometric.punchCount} />
            <KeyValue label="Cut-off applied" value={record.biometric.lateCutoffLabel || '—'} />
            <KeyValue
              label="Late by"
              value={
                record.biometric.lateByMinutes !== null
                  ? `${record.biometric.lateByMinutes} min`
                  : '—'
              }
            />
            <KeyValue label="Working day" value={record.biometric.workingDayReason} />
          </Card>

          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">WhatsApp side</h3>
            <KeyValue label="Notification found" value={record.whatsapp.hasNotification ? 'Yes' : 'No'} />
            <KeyValue label="Event(s)" value={record.whatsapp.statusLabel} />
            <KeyValue label="Sender(s)" value={record.whatsapp.senders.join(', ') || '—'} />
            <KeyValue label="Time(s)" value={record.whatsapp.times.join(', ') || '—'} />
            <KeyValue label="Subjects named" value={record.whatsapp.subjectTexts.join(', ') || '—'} />
            <KeyValue
              label="Audience classification"
              value={record.whatsapp.audience === 'staff' ? 'Staff' : record.whatsapp.audience === 'student' ? 'Student' : 'Uncertain'}
            />
          </Card>
        </div>

        {record.notes.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Notes</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
              {record.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <Separator />

        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Search className="size-4" /> View original evidence
          </h3>
          <EvidenceList items={record.evidence} />
        </div>
      </div>
    </Modal>
  );
}

/** Small inline trigger used in tables. */
export function EvidenceButton({ onClick, label = 'Evidence' }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="h-7 px-2 text-xs">
      <Search /> {label}
    </Button>
  );
}
