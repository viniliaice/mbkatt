/**
 * Administrative review dialog (specification item 34).
 *
 * The administrator can confirm excused / unexcused, mark leave, correct the
 * attendance values, add documentation and record an administrative action.
 * Everything recorded here is attributed to a named reviewer with a timestamp;
 * the app itself never writes a reason, a document or a decision.
 */

import { Check, Clock, FileText, MessageSquare, Paperclip, Plus, RotateCcw, ShieldCheck, X } from 'lucide-react';
import * as React from 'react';
import { EvidenceList } from '@/components/EvidencePanel';
import { BiometricBadge, ExcuseStatusBadge, NotificationBadge } from '@/components/StatusBadges';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  KeyValue,
  Label,
  Modal,
  Separator,
  Textarea,
} from '@/components/ui';
import { ADMIN_EXCUSE_LABELS } from '@/lib/types';
import { formatDisplayDate, weekdayShort } from '@/lib/dates';
import { useStore } from '@/lib/store';
import { minutesToClock } from '@/lib/time';
import type { AdminExcuseStatus, AdminReviewEntry, AuditRecord } from '@/lib/types';

const LAST_REVIEWER_KEY = 'mbk-last-reviewer';

const DOCUMENTATION_PRESETS = [
  'Medical certificate received',
  'Doctor note received',
  'Letter from parent/guardian',
  'Verbal explanation only',
  'No documentation provided',
];

const ACTION_PRESETS = [
  'Logged',
  'Verbal reminder',
  'HR-01 warning issued',
  'HR-02 warning issued',
  'Deduction applied per policy',
  'Refer to head teacher',
  'No action required',
];

export function AdminReviewDialog({
  record,
  open,
  onClose,
}: {
  record: AuditRecord | null;
  open: boolean;
  onClose: () => void;
}) {
  const { corrections, setAdminReview } = useStore();
  const existing = record ? corrections.adminReviews[record.id] : undefined;

  const [excuseStatus, setExcuseStatus] = React.useState<AdminExcuseStatus>('pending');
  const [documentation, setDocumentation] = React.useState('');
  const [action, setAction] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [reviewer, setReviewer] = React.useState('');
  const [correctionOn, setCorrectionOn] = React.useState(false);
  const [firstPunch, setFirstPunch] = React.useState('');
  const [lastPunch, setLastPunch] = React.useState('');
  const [attachment, setAttachment] = React.useState<{ name: string; size: number } | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const storedReviewer = window.localStorage.getItem(LAST_REVIEWER_KEY) ?? '';
    setExcuseStatus(existing?.excuseStatus ?? 'pending');
    setDocumentation(existing?.documentation ?? '');
    setAction(existing?.administrativeAction ?? '');
    setNotes(existing?.notes ?? '');
    setReviewer(existing?.reviewer ?? storedReviewer);
    setCorrectionOn(Boolean(existing?.correction));
    setFirstPunch(
      existing?.correction?.firstPunch != null
        ? minutesToClock(existing.correction.firstPunch)
        : record?.biometric.firstPunch != null
          ? minutesToClock(record.biometric.firstPunch)
          : '',
    );
    setLastPunch(
      existing?.correction?.lastPunch != null
        ? minutesToClock(existing.correction.lastPunch)
        : record?.biometric.lastPunch != null
          ? minutesToClock(record.biometric.lastPunch)
          : '',
    );
    setAttachment(
      existing?.attachedFileName
        ? { name: existing.attachedFileName, size: existing.attachedFileSize ?? 0 }
        : null,
    );
    setSaved(false);
  }, [open, record, existing]);

  if (!record) return null;

  const toMinutes = (value: string): number | null => {
    if (!/^\d{1,2}:\d{2}/.test(value)) return null;
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const save = (action0: string) => {
    const entry: AdminReviewEntry = {
      auditId: record.id,
      excuseStatus,
      documentation,
      administrativeAction: action,
      notes,
      reviewer: reviewer.trim() || 'unspecified reviewer',
      decidedAt: new Date().toISOString(),
      attachedFileName: attachment?.name,
      attachedFileSize: attachment?.size,
      correction: correctionOn
        ? { firstPunch: toMinutes(firstPunch), lastPunch: toMinutes(lastPunch) }
        : undefined,
      history: [{ at: new Date().toISOString(), by: reviewer.trim() || 'unspecified reviewer', action: action0 }],
    };
    setAdminReview(record.id, entry);
    window.localStorage.setItem(LAST_REVIEWER_KEY, entry.reviewer);
    setSaved(true);
  };

  const quickSet = (status: AdminExcuseStatus, label: string) => {
    const entry: AdminReviewEntry = {
      auditId: record.id,
      excuseStatus: status,
      documentation,
      administrativeAction: action,
      notes,
      reviewer: reviewer.trim() || 'unspecified reviewer',
      decidedAt: new Date().toISOString(),
      attachedFileName: attachment?.name,
      attachedFileSize: attachment?.size,
      correction: correctionOn ? { firstPunch: toMinutes(firstPunch), lastPunch: toMinutes(lastPunch) } : undefined,
      history: [{ at: new Date().toISOString(), by: reviewer.trim() || 'unspecified reviewer', action: label }],
    };
    setExcuseStatus(status);
    setAdminReview(record.id, entry);
    window.localStorage.setItem(LAST_REVIEWER_KEY, entry.reviewer);
    setSaved(true);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Administrative review — ${record.employeeName}`}
      description={`${formatDisplayDate(record.date)} (${weekdayShort(record.date)}) · ${record.biometric.workingDayReason}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {existing ? (
            <Button
              variant="ghost"
              onClick={() => {
                setAdminReview(record.id, null);
                setExcuseStatus('pending');
                setSaved(false);
              }}
            >
              <RotateCcw /> Clear decision
            </Button>
          ) : null}
          <Button onClick={() => save('Decision recorded')}>
            <Check /> Save decision
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <BiometricBadge evaluation={record.biometric} />
          <NotificationBadge status={record.notificationStatus} />
          <ExcuseStatusBadge status={excuseStatus} />
          {existing ? <Badge tone="success">decision recorded</Badge> : <Badge tone="warning">pending review</Badge>}
          {saved ? <Badge tone="success">saved</Badge> : null}
        </div>

        <Alert tone="info" title="What the data shows — and what it does not">
          <p>
            WhatsApp notification: <span className="font-medium">{record.whatsapp.hasNotification ? 'YES' : 'NO'}</span>{' '}
            {record.whatsapp.hasNotification ? `(${record.whatsapp.senders.join(', ')} at ${record.whatsapp.times.join(', ')})` : ''}{' '}
            · Administrative excuse: <span className="font-medium">NOT DECIDED BY THE SYSTEM</span>. A notification does
            not make an absence excused — this dialog is where that decision is recorded.
          </p>
        </Alert>

        <div>
          <Label className="mb-2 block">Quick decision</Label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => quickSet('excused', 'Confirm Excused')}>
              <Check /> Confirm Excused
            </Button>
            <Button variant="outline" size="sm" onClick={() => quickSet('unexcused', 'Confirm Unexcused')}>
              <X /> Confirm Unexcused
            </Button>
            <Button variant="outline" size="sm" onClick={() => quickSet('leave', 'Mark as Leave')}>
              <ShieldCheck /> Mark as Leave
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCorrectionOn(true)}>
              <Clock /> Correct Attendance
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDocumentation(documentation || 'Medical certificate received')}>
              <FileText /> Add Documentation
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAction(action || 'Logged')}>
              <Plus /> Add Administrative Action
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Reviewer name (recorded with the decision, and required for the audit trail):
          </p>
          <Input
            className="mt-1 max-w-xs"
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
            placeholder="e.g. Head Teacher"
          />
        </div>

        <Separator />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4" /> Attendance evidence
            </h3>
            <KeyValue label="Employee ID" value={record.employeeCode ?? '—'} />
            <KeyValue label="Date" value={formatDisplayDate(record.date)} />
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
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[var(--muted-foreground)]">
                Original attendance record
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--muted)] p-2 text-xs scrollbar-thin">
                {record.evidence
                  .filter((item) => item.kind === 'attendance')
                  .map((item) => `${item.detail}\n${item.raw ?? ''}`)
                  .join('\n\n') || 'No attendance row exists for this day.'}
              </pre>
            </details>
          </Card>

          <Card className="p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="size-4" /> WhatsApp evidence
            </h3>
            <KeyValue label="Notified" value={record.whatsapp.hasNotification ? 'Yes' : 'No'} />
            <KeyValue label="Sender" value={record.whatsapp.senders.join(', ') || '—'} />
            <KeyValue label="Date / time" value={`${formatDisplayDate(record.date)} · ${record.whatsapp.times.join(', ') || '—'}`} />
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--muted)] p-2 text-xs scrollbar-thin">
              {record.whatsapp.originalMessages.join('\n---\n') || 'No message found for this employee on this date.'}
            </pre>
          </Card>
        </div>

        {correctionOn ? (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Correct the attendance values (manual override)</h3>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">
              Only use this when the machine file itself is wrong. The original values stay available in the evidence
              trail, and the override is recorded with your name.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="mb-1 block">First punch</Label>
                <Input type="time" value={firstPunch} onChange={(event) => setFirstPunch(event.target.value)} className="w-36" />
              </div>
              <div>
                <Label className="mb-1 block">Last punch</Label>
                <Input type="time" value={lastPunch} onChange={(event) => setLastPunch(event.target.value)} className="w-36" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCorrectionOn(false)}>
                Cancel correction
              </Button>
            </div>
          </Card>
        ) : null}

        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="size-4" /> Documentation &amp; administrative action
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label className="mb-1 block">Documentation provided</Label>
              <Input
                value={documentation}
                onChange={(event) => setDocumentation(event.target.value)}
                placeholder="Type exactly what was received…"
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {DOCUMENTATION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDocumentation(preset)}
                    className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--accent)]"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-1 block">Administrative action taken</Label>
              <Input value={action} onChange={(event) => setAction(event.target.value)} placeholder="e.g. HR-01 issued" />
              <div className="mt-2 flex flex-wrap gap-1">
                {ACTION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAction(preset)}
                    className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--accent)]"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <Label className="mb-1 block">Reviewer notes (printed in the administrative report)</Label>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Notes you want in section 6 of the report…"
              />
            </div>
            <div>
              <Label className="mb-1 block">Supporting document (kept in this browser only)</Label>
              <input
                type="file"
                className="block w-full text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) setAttachment({ name: file.name, size: file.size });
                }}
              />
              {attachment ? (
                <p className="mt-2 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <Paperclip className="size-3.5" /> {attachment.name} ({(attachment.size / 1024).toFixed(1)} KB) —
                  attached to this decision. The file itself is never uploaded anywhere; only its name is recorded.
                </p>
              ) : (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  Nothing attached. The system never claims a document exists unless you attach or describe one.
                </p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <Label className="mb-1 block">Excuse status being recorded</Label>
            <div className="flex flex-wrap gap-2">
              {(['pending', 'excused', 'unexcused', 'leave'] as AdminExcuseStatus[]).map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={excuseStatus === status ? 'default' : 'outline'}
                  onClick={() => setExcuseStatus(status)}
                >
                  {ADMIN_EXCUSE_LABELS[status]}
                </Button>
              ))}
            </div>
          </div>
        </Card>

        {existing?.history?.length ? (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Decision history</h3>
            <ul className="space-y-1 text-sm text-[var(--muted-foreground)]">
              {existing.history.map((entry, index) => (
                <li key={index}>
                  {new Date(entry.at).toLocaleString()} — {entry.by}: {entry.action}
                  {entry.detail ? ` (${entry.detail})` : ''}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4" /> Full evidence trail
          </h3>
          <EvidenceList items={record.evidence} />
        </div>
      </div>
    </Modal>
  );
}
