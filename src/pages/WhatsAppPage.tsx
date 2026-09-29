import { Download, MessageSquare, ShieldQuestion } from 'lucide-react';
import * as React from 'react';
import { PageHeader } from '@/components/AppShell';
import { DataTable, tableToCsv, type Column } from '@/components/DataTable';
import { EvidenceList } from '@/components/EvidencePanel';
import { AudienceBadge, EventBadge, MatchStatusBadge, TierBadge } from '@/components/StatusBadges';
import { Alert, Badge, Button, Card, CardContent, Modal, Select, StatCard, Tabs } from '@/components/ui';
import { formatDisplayDate } from '@/lib/dates';
import { EVENT_FILTER_ORDER, EVENT_LABELS } from '@/lib/statuses';
import { download } from '@/lib/reports';
import { useStore } from '@/lib/store';
import type { StaffEventType, WhatsAppEventRow, WhatsAppMessage } from '@/lib/types';

type Tab = 'events' | 'messages';

export function WhatsAppPage() {
  const { result } = useStore();
  const [tab, setTab] = React.useState<Tab>('events');
  const [event, setEvent] = React.useState<StaffEventType | ''>('');
  const [row, setRow] = React.useState<WhatsAppEventRow | null>(null);
  const [message, setMessage] = React.useState<WhatsAppMessage | null>(null);

  if (!result) {
    return (
      <>
        <PageHeader title="WhatsApp reports" description="Every message read from the export, with the classification and its link to the attendance file." />
        <Alert tone="info" title="No analysis yet">
          <p>Upload the WhatsApp export and run the analysis to see the messages.</p>
        </Alert>
      </>
    );
  }

  const events = result.whatsappEvents.filter((entry) => !event || entry.event === event);
  const messages = result.messages;

  const eventColumns: Column<WhatsAppEventRow>[] = [
    {
      key: 'date',
      header: 'Date',
      value: (entry) => entry.date ?? '',
      render: (entry) => <span className="whitespace-nowrap font-medium">{formatDisplayDate(entry.date)}</span>,
    },
    { key: 'time', header: 'Time', value: (entry) => entry.minutesOfDay ?? -1, render: (entry) => <span className="tabular-nums">{entry.timeText ?? '—'}</span> },
    { key: 'sender', header: 'Sender', value: (entry) => entry.sender ?? '—' },
    {
      key: 'employee',
      header: 'Employee',
      value: (entry) => entry.employeeName ?? entry.subjectText,
      render: (entry) => (
        <div>
          <span className="font-medium">{entry.employeeName ?? '— not matched —'}</span>
          <span className="block text-xs text-[var(--muted-foreground)]">“{entry.subjectText}”</span>
        </div>
      ),
    },
    {
      key: 'event',
      header: 'Event',
      value: (entry) => EVENT_LABELS[entry.event],
      render: (entry) => <EventBadge event={entry.event} />,
    },
    {
      key: 'message',
      header: 'Original message',
      value: (entry) => entry.originalMessage,
      render: (entry) => (
        <button
          type="button"
          onClick={(event_) => {
            event_.stopPropagation();
            setRow(entry);
          }}
          className="line-clamp-2 max-w-[380px] text-left text-xs underline-offset-2 hover:underline"
          title={entry.originalMessage}
        >
          {entry.originalMessage}
        </button>
      ),
    },
    {
      key: 'classification',
      header: 'Classification',
      value: (entry) => entry.audience,
      render: (entry) => (
        <div className="space-y-1">
          <AudienceBadge audience={entry.audience} />
          <span className="block max-w-[220px] text-xs text-[var(--muted-foreground)]">
            {entry.classificationReason}
          </span>
        </div>
      ),
    },
    {
      key: 'match',
      header: 'Match to attendance',
      value: (entry) => entry.matchLabel,
      render: (entry) => (
        <div className="space-y-1">
          <MatchStatusBadge status={entry.matchStatus} />
          <TierBadge tier={entry.nameTier} />
        </div>
      ),
    },
    { key: 'biometric', header: 'Biometric side', value: (entry) => entry.biometricSummary, hideOnMobile: true },
    {
      key: 'confidence',
      header: 'Confidence',
      value: (entry) => entry.nameConfidence,
      render: (entry) => (
        <Badge tone={entry.confidence === 'high' ? 'success' : entry.confidence === 'medium' ? 'warning' : 'danger'}>
          {entry.nameConfidence}%
        </Badge>
      ),
      hideOnMobile: true,
    },
  ];

  const messageColumns: Column<WhatsAppMessage>[] = [
    {
      key: 'date',
      header: 'Date',
      value: (entry) => entry.date ?? '',
      render: (entry) => <span className="whitespace-nowrap">{formatDisplayDate(entry.date)}</span>,
    },
    { key: 'time', header: 'Time', value: (entry) => entry.minutesOfDay ?? -1, render: (entry) => <span className="tabular-nums">{entry.timeText ?? '—'}</span> },
    { key: 'sender', header: 'Sender', value: (entry) => entry.sender ?? 'System' },
    {
      key: 'message',
      header: 'Message',
      value: (entry) => entry.raw,
      render: (entry) => (
        <button
          type="button"
          onClick={(event_) => {
            event_.stopPropagation();
            setMessage(entry);
          }}
          className="line-clamp-2 max-w-[420px] text-left underline-offset-2 hover:underline"
        >
          {entry.raw}
        </button>
      ),
    },
    {
      key: 'audience',
      header: 'Classification',
      value: (entry) => entry.classification.audience,
      render: (entry) => <AudienceBadge audience={entry.classification.audience} />,
    },
    {
      key: 'events',
      header: 'Events',
      value: (entry) => entry.classification.events.map((detected) => EVENT_LABELS[detected.type]).join(', '),
      render: (entry) =>
        entry.classification.events.length === 0 ? (
          <span className="text-[var(--muted-foreground)]">none</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {entry.classification.events.map((detected, index) => (
              <EventBadge key={`${detected.type}-${index}`} event={detected.type} />
            ))}
          </div>
        ),
    },
    {
      key: 'mentions',
      header: 'People mentioned',
      value: (entry) => entry.classification.mentions.map((mention) => mention.text).join(', '),
      hideOnMobile: true,
    },
    {
      key: 'file',
      header: 'Source',
      value: (entry) => `${entry.fileName} line ${entry.lineNumber}`,
      render: (entry) => (
        <span className="text-xs text-[var(--muted-foreground)]">
          {entry.fileName}:{entry.lineNumber}
        </span>
      ),
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="WhatsApp reports"
        description={`${messages.length} message(s) parsed from ${result.files.filter((file) => file.kind === 'whatsapp').length} export(s). Student/bus messages are kept and shown, never deleted.`}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              if (tab === 'events') {
                download('mbk-whatsapp-events.csv', tableToCsv(eventColumns, events), 'text/csv;charset=utf-8');
              } else {
                download(
                  'mbk-whatsapp-messages.csv',
                  tableToCsv(messageColumns, messages),
                  'text/csv;charset=utf-8',
                );
              }
            }}
          >
            <Download /> Export this view
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Staff notifications"
          value={result.summary.staffMessages}
          hint="Messages classified as staff attendance"
          tone="primary"
          icon={<MessageSquare className="size-4" />}
        />
        <StatCard
          label="Staff event rows"
          value={result.whatsappEvents.length}
          hint="One row per employee mentioned in a staff message"
        />
        <StatCard
          label="Student messages"
          value={result.summary.studentMessages}
          hint="Bus/grade/pickup messages — kept but not audited"
          tone="info"
        />
        <StatCard
          label="Uncertain messages"
          value={result.summary.uncertainMessages}
          hint="Need a decision in the Review Center"
          tone="warning"
          icon={<ShieldQuestion className="size-4" />}
        />
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end justify-between gap-3 pt-5">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'events', label: 'Attendance events', count: result.whatsappEvents.length },
              { value: 'messages', label: 'All messages', count: messages.length },
            ]}
          />
          {tab === 'events' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]" htmlFor="event-filter">
                Filter by event type
              </label>
              <Select
                id="event-filter"
                value={event}
                onChange={(changed) => setEvent(changed.target.value as StaffEventType | '')}
                className="w-[220px]"
              >
                <option value="">All event types</option>
                {EVENT_FILTER_ORDER.map((type) => (
                  <option key={type} value={type}>
                    {EVENT_LABELS[type]}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {tab === 'events' ? (
        <DataTable
          columns={eventColumns}
          rows={events}
          getRowId={(entry) => entry.id}
          initialSort={{ key: 'date', direction: 'desc' }}
          pageSize={25}
          searchPlaceholder="Search sender, message text, employee…"
          emptyMessage="No staff events match the current filter."
          onRowClick={setRow}
        />
      ) : (
        <DataTable
          columns={messageColumns}
          rows={messages}
          getRowId={(entry) => entry.id}
          initialSort={{ key: 'date', direction: 'desc' }}
          pageSize={25}
          searchPlaceholder="Search sender, message text…"
          emptyMessage="No messages match the current filter."
          onRowClick={setMessage}
        />
      )}

      <Modal
        open={row !== null}
        onClose={() => setRow(null)}
        size="lg"
        title={row ? `Message evidence — ${row.employeeName ?? row.subjectText}` : ''}
        description={row ? `${formatDisplayDate(row.date)} ${row.timeText ?? ''} · ${row.sender ?? 'unknown sender'}` : undefined}
        footer={
          <Button variant="outline" onClick={() => setRow(null)}>
            Close
          </Button>
        }
      >
        {row ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <EventBadge event={row.event} />
              <AudienceBadge audience={row.audience} />
              <MatchStatusBadge status={row.matchStatus} short={false} />
              <TierBadge tier={row.nameTier} />
              <Badge tone="neutral">name confidence {row.nameConfidence}%</Badge>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Classification reason</h3>
              <p className="text-sm text-[var(--muted-foreground)]">{row.classificationReason}</p>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Biometric comparison</h3>
              <p className="text-sm text-[var(--muted-foreground)]">{row.biometricSummary}</p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Full evidence trail</h3>
              <EvidenceList items={row.evidence} />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={message !== null}
        onClose={() => setMessage(null)}
        size="lg"
        title="Message detail"
        description={message ? `${message.fileName}, line ${message.lineNumber}` : undefined}
        footer={
          <Button variant="outline" onClick={() => setMessage(null)}>
            Close
          </Button>
        }
      >
        {message ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <AudienceBadge audience={message.classification.audience} />
              <Badge tone="neutral">audience confidence {Math.round(message.classification.audienceConfidence * 100)}%</Badge>
              {message.classification.manual ? <Badge tone="warning">manually corrected</Badge> : null}
              {message.isSystem ? <Badge tone="neutral">system message</Badge> : null}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Original message (untouched)</h3>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--muted)] p-3 text-sm scrollbar-thin">
                {message.raw}
              </pre>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-sm font-semibold">Classification reasons</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
                  {message.classification.audienceReasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                  {message.classification.notes.map((note, index) => (
                    <li key={`note-${index}`}>{note}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold">Detected in the text</h3>
                <ul className="space-y-1 text-sm text-[var(--muted-foreground)]">
                  <li>Events: {message.classification.events.map((detected) => `${EVENT_LABELS[detected.type]} (“${detected.phrase}”)`).join('; ') || 'none'}</li>
                  <li>People: {message.classification.mentions.map((mention) => mention.text).join(', ') || 'none'}</li>
                  <li>Student info: {message.classification.studentInfo.join(', ') || 'none'}</li>
                  <li>Bus info: {message.classification.busInfo.join(', ') || 'none'}</li>
                  <li>Date as written: {message.dateText ?? 'unparsed'} · time: {message.timeText ?? 'unparsed'}</li>
                </ul>
              </div>
            </div>
            {message.parseWarnings.length > 0 ? (
              <Alert tone="warning" title="Parsing notes">
                <ul className="list-disc space-y-1 pl-5">
                  {message.parseWarnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            <p className="text-xs text-[var(--muted-foreground)]">
              Original lines {message.rawLines.length > 0 ? `${message.lineNumber}–${message.lineNumber + message.rawLines.length - 1}` : message.lineNumber}{' '}
              of {message.fileName}. Nothing is rewritten — classifications can be corrected in the Review Center.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
