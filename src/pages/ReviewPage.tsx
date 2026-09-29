import {
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  RotateCcw,
  ShieldQuestion,
  UserPlus,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { PageHeader } from '@/components/AppShell';
import { EvidenceModal } from '@/components/EvidencePanel';
import { AudienceBadge, ConfidenceBadge, TierBadge } from '@/components/StatusBadges';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  EmptyState,
  Input,
  Select,
  Separator,
  Tabs,
} from '@/components/ui';
import { EVENT_FILTER_ORDER, EVENT_LABELS } from '@/lib/statuses';
import { useStore } from '@/lib/store';
import type {
  AnalysisResult,
  Audience,
  ReviewIssue,
  ReviewIssueType,
  StaffEventType,
  WhatsAppMessage,
} from '@/lib/types';

const TYPE_LABELS: Record<ReviewIssueType, string> = {
  uncertain_classification: 'Uncertain classification',
  uncertain_name_match: 'Uncertain name match',
  conflicting_attendance: 'Conflicting attendance',
  missing_dates: 'Missing dates',
  malformed_time: 'Malformed times',
  duplicate_record: 'Duplicate records',
  employee_without_punches: 'Employees without punches',
  unparsed_message: 'Unparsed lines',
  unknown_event: 'Unrecognised events',
};

const TYPE_ORDER: ReviewIssueType[] = [
  'uncertain_name_match',
  'uncertain_classification',
  'conflicting_attendance',
  'unknown_event',
  'malformed_time',
  'duplicate_record',
  'missing_dates',
  'employee_without_punches',
  'unparsed_message',
];

function MessageActions({ message, result }: { message: WhatsAppMessage; result: AnalysisResult }) {
  const { setAudience, setEvents, removeMention, addSubject, removeSubject, corrections } = useStore();
  const audience: Audience = corrections.audience[message.id] ?? message.classification.audience;
  const events: StaffEventType[] = corrections.events[message.id] ?? message.classification.events.map((event) => event.type);
  const removed = corrections.removedMentions[message.id] ?? [];

  const toggleEvent = (event: StaffEventType, checked: boolean) => {
    const next = checked ? [...new Set([...events, event])] : events.filter((entry) => entry !== event);
    setEvents(message.id, next);
  };

  return (
    <div className="mt-3 space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Staff or student?
        </p>
        <div className="flex flex-wrap gap-2">
          {(['staff', 'student', 'uncertain'] as Audience[]).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={audience === option ? 'default' : 'outline'}
              onClick={() => setAudience(message.id, option)}
            >
              {option === 'staff' ? 'Staff' : option === 'student' ? 'Student' : 'Uncertain'}
              {audience === option ? <CheckCircle2 /> : null}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Attendance event(s) — keep the original wording in mind
        </p>
        <div className="flex flex-wrap gap-2">
          {EVENT_FILTER_ORDER.map((event) => (
            <label
              key={event}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                events.includes(event) ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--border)]'
              }`}
            >
              <Checkbox
                checked={events.includes(event)}
                onChange={(changed) => toggleEvent(event, changed.target.checked)}
                className="size-3.5"
              />
              {EVENT_LABELS[event]}
            </label>
          ))}
        </div>
        <div className="mt-2">
          <Button size="sm" variant="ghost" onClick={() => setEvents(message.id, [])}>
            <XCircle /> No attendance event (e.g. general announcement)
          </Button>
        </div>
      </div>

      {message.classification.mentions.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            People detected in the message — remove any that are not employees
          </p>
          <div className="flex flex-wrap gap-2">
            {message.classification.mentions.map((mention) => {
              const isRemoved = removed.includes(mention.text);
              return (
                <span
                  key={mention.text}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                    isRemoved
                      ? 'border-red-300 bg-red-50 text-red-700 line-through dark:bg-red-950/50 dark:text-red-200'
                      : 'border-[var(--border)]'
                  }`}
                >
                  {mention.text}
                  {mention.isSelf ? <Badge tone="neutral">“I”</Badge> : null}
                  {isRemoved ? (
                    <span className="text-[10px] uppercase">removed</span>
                  ) : (
                    <button
                      type="button"
                      className="text-red-600 hover:underline dark:text-red-400"
                      onClick={() => removeMention(message.id, mention.text)}
                      aria-label={`Remove ${mention.text} from this message`}
                    >
                      remove
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Removing a person only affects the current analysis; use “Reset decisions” to undo.
          </p>
        </div>
      ) : null}

      <SubjectAttach message={message} result={result} onAdd={addSubject} onRemove={removeSubject} />
    </div>
  );
}

/**
 * Manual attribution (spec 34/44): attach an employee to a message the matcher
 * could not resolve. The attribution is explicit — it is never presented as an
 * automatic match, and the attached employee shows it in their own record.
 */
function SubjectAttach({
  message,
  result,
  onAdd,
  onRemove,
}: {
  message: WhatsAppMessage;
  result: AnalysisResult;
  onAdd: (messageId: string, employeeId: string) => void;
  onRemove: (messageId: string, employeeId: string) => void;
}) {
  const { corrections } = useStore();
  const attached = corrections.addedSubjects[message.id] ?? [];
  const [selected, setSelected] = React.useState('');
  const employees = [...result.attendanceEmployees].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        Attach an employee by hand
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          aria-label="Employee to attach to this message"
          className="w-[280px]"
        >
          <option value="">Choose an employee…</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
              {employee.employeeCode ? ` (${employee.employeeCode})` : ''}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected}
          onClick={() => {
            onAdd(message.id, selected);
            setSelected('');
          }}
        >
          <UserPlus /> Attach
        </Button>
        {attached.map((employeeId) => {
          const employee = employees.find((entry) => entry.id === employeeId);
          return (
            <span
              key={employeeId}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-1 text-xs"
            >
              {employee?.name ?? employeeId}
              <Badge tone="neutral">manual</Badge>
              <button
                type="button"
                className="text-red-600 hover:underline dark:text-red-400"
                onClick={() => onRemove(message.id, employeeId)}
                aria-label={`Detach ${employee?.name ?? employeeId}`}
              >
                detach
              </button>
            </span>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
        Use this when the message clearly concerns an employee the matcher could not resolve (a nick-name, a spelling
        that is not obvious, a student reporting on a teacher's behalf). The attribution is recorded as manual and is
        never a guess.
      </p>
    </div>
  );
}

function NameMatchActions({ issue, result }: { issue: ReviewIssue; result: AnalysisResult }) {
  const { setNameOverride, addAlias, corrections } = useStore();
  const match = result.nameMatches.find((entry) => entry.whatsappName === issue.whatsappName);
  if (!match) {
    return <p className="mt-2 text-sm text-[var(--muted-foreground)]">The name match is no longer present.</p>;
  }
  const override = corrections.nameOverrides[match.whatsappName];
  const options = [
    ...(match.employeeId
      ? [{ employeeId: match.employeeId, employeeName: match.employeeName ?? '', confidence: match.confidence }]
      : []),
    ...match.alternatives,
  ].filter(
    (option, index, list) =>
      option.employeeId && list.findIndex((entry) => entry.employeeId === option.employeeId) === index,
  );

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <TierBadge tier={match.tier} />
        <Badge tone={match.confidence >= 85 ? 'success' : match.confidence >= 60 ? 'warning' : 'danger'}>
          {match.confidence}% confidence
        </Badge>
        <span className="text-[var(--muted-foreground)]">
          appears {match.occurrences}× in the chat · method: {match.method}
          {override ? ` · currently overridden (${override === 'reject' ? 'rejected' : 'manual'})` : ''}
        </span>
      </div>
      <ul className="space-y-1 text-xs text-[var(--muted-foreground)]">
        {match.reasons.map((reason, index) => (
          <li key={index}>• {reason}</li>
        ))}
      </ul>
      <div className="space-y-2">
        {options.map((option) => (
          <div key={option.employeeId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-2">
            <span className="text-sm">
              {option.employeeName} <span className="text-[var(--muted-foreground)]">({option.confidence}%)</span>
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNameOverride(match.whatsappName, option.employeeId)}
              >
                <CheckCircle2 /> Approve this match
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNameOverride(match.whatsappName, option.employeeId);
                  addAlias({
                    whatsappName: match.whatsappName,
                    employeeId: option.employeeId,
                    employeeName: option.employeeName,
                  });
                }}
              >
                Approve &amp; remember as alias
              </Button>
            </div>
          </div>
        ))}
        {options.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No similar employee name was found in the attendance files. If this person really is an employee, fix the
            attendance file (or add the person there) and re-run the analysis — the app will not invent an employee.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" onClick={() => setNameOverride(match.whatsappName, 'reject')}>
          <XCircle /> It is not an employee — keep unmatched
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNameOverride(match.whatsappName, null)}>
          <RotateCcw /> Reset to automatic matching
        </Button>
      </div>
    </div>
  );
}

/**
 * Person matching layer (spec 43/44): every name used in WhatsApp with its
 * candidate employees, confidence, reason, current match and manual controls.
 */
function PersonMatchingTable({ result }: { result: AnalysisResult }) {
  const { setNameOverride, addAlias, corrections } = useStore();
  const [search, setSearch] = React.useState('');

  const matches = result.nameMatches
    .filter((match) => {
      if (!search.trim()) return true;
      const needle = search.trim().toLowerCase();
      const haystack = [match.whatsappName, match.employeeName ?? '', ...match.alternatives.map((alt) => alt.employeeName)]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    })
    .sort((a, b) => b.occurrences - a.occurrences || a.whatsappName.localeCompare(b.whatsappName));

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Person matching</h2>
            <p className="max-w-3xl text-sm text-[var(--muted-foreground)]">
              WhatsApp names are parsed first and matched to attendance employees afterwards — never the other way
              round. Short names, titles, initials, punctuation and Somali transliteration variants are all considered;
              one shared name is never enough to merge two people.
            </p>
          </div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter names…"
            className="w-64"
          />
        </div>

        {matches.length === 0 ? (
          <EmptyState
            title="No names match the filter"
            description="Clear the search box to see every WhatsApp name found in the export."
          />
        ) : (
          <div className="space-y-3">
            {matches.map((match) => {
              const override = corrections.nameOverrides[match.whatsappName];
              const candidates = [
                ...(match.employeeId
                  ? [
                      {
                        employeeId: match.employeeId,
                        employeeName: match.employeeName ?? '',
                        confidence: match.confidence,
                        current: true,
                      },
                    ]
                  : []),
                ...match.alternatives.map((alt) => ({ ...alt, current: false })),
              ].filter(
                (candidate, index, list) =>
                  candidate.employeeId && list.findIndex((entry) => entry.employeeId === candidate.employeeId) === index,
              );

              return (
                <div key={match.whatsappName} className="rounded-lg border border-[var(--border)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">“{match.whatsappName}”</span>
                    <TierBadge tier={match.tier} />
                    <ConfidenceBadge score={match.confidence} />
                    <Badge tone="neutral">{match.occurrences}× in the chat</Badge>
                    {override ? <Badge tone="warning">manual decision recorded</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    Method: {match.method}
                    {match.reasons.length > 0 ? ` — ${match.reasons.join(' ')}` : ''}
                  </p>

                  <div className="mt-3 space-y-2">
                    {candidates.length === 0 ? (
                      <p className="text-sm text-[var(--muted-foreground)]">
                        No similar employee was found in the attendance files — nothing is guessed. If this person works
                        at the school, add them to the attendance file (or check the spelling) and re-run.
                      </p>
                    ) : (
                      candidates.map((candidate) => (
                        <div
                          key={candidate.employeeId}
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 ${
                            candidate.current ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)]'
                          }`}
                        >
                          <span className="text-sm">
                            {candidate.employeeName}{' '}
                            <span className="text-[var(--muted-foreground)]">
                              — confidence {candidate.confidence}%
                              {candidate.current ? ' · current match' : ' · alternative'}
                            </span>
                          </span>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setNameOverride(match.whatsappName, candidate.employeeId)}
                            >
                              <CheckCircle2 /> Select this person
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setNameOverride(match.whatsappName, candidate.employeeId);
                                addAlias({
                                  whatsappName: match.whatsappName,
                                  employeeId: candidate.employeeId,
                                  employeeName: candidate.employeeName,
                                });
                              }}
                            >
                              Save mapping
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setNameOverride(match.whatsappName, 'reject')}>
                      <XCircle /> Not an employee
                    </Button>
                    {override ? (
                      <Button size="sm" variant="ghost" onClick={() => setNameOverride(match.whatsappName, null)}>
                        <RotateCcw /> Reset to automatic
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Alert tone="info" title="Mappings are kept for the current analysis">
          <p>
            “Save mapping” adds the pairing to the alias list (visible in Settings) so it applies automatically the next
            time the analysis runs. Manual mappings and the automatic confidence score are always shown side by side.
          </p>
        </Alert>
      </CardContent>
    </Card>
  );
}

function IssueCard({
  issue,
  result,
  onEvidence,
}: {
  issue: ReviewIssue;
  result: AnalysisResult;
  onEvidence: (recordId: string) => void;
}) {
  const { dismissRecord, corrections } = useStore();
  const message = issue.messageId ? result.messages.find((entry) => entry.id === issue.messageId) : undefined;
  const dismissed = issue.auditId ? corrections.dismissedRecords.includes(issue.auditId) : false;

  const tone = issue.severity === 'high' ? 'danger' : issue.severity === 'medium' ? 'warning' : 'neutral';

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{issue.severity} priority</Badge>
            <Badge tone="outline">{TYPE_LABELS[issue.type]}</Badge>
            {issue.sourceFile ? (
              <span className="text-xs text-[var(--muted-foreground)]">
                {issue.sourceFile}
                {issue.sourceLocation ? ` · ${issue.sourceLocation}` : ''}
              </span>
            ) : null}
            {message ? <AudienceBadge audience={message.classification.audience} /> : null}
          </div>
          <p className="mt-2 font-medium">{issue.title}</p>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">{issue.detail}</p>
        </div>
        {issue.auditId ? (
          <div className="flex flex-col items-end gap-2">
            <Button size="sm" variant="outline" onClick={() => onEvidence(issue.auditId as string)}>
              View original evidence
            </Button>
            {dismissed ? (
              <Badge tone="success">dismissed for this analysis</Badge>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => dismissRecord(issue.auditId as string)}
                title="Hide this row from the audit for the current analysis"
              >
                <XCircle /> Dismiss as not applicable
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {issue.raw ? (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--muted)] p-3 text-xs scrollbar-thin">
          {issue.raw}
        </pre>
      ) : null}

      {(issue.type === 'uncertain_classification' || issue.type === 'unknown_event') && message ? (
        <MessageActions message={message} result={result} />
      ) : null}

      {issue.type === 'uncertain_name_match' ? <NameMatchActions issue={issue} result={result} /> : null}

      {issue.type === 'malformed_time' || issue.type === 'unparsed_message' || issue.type === 'duplicate_record' ? (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          This is reported for transparency. The affected value is left out of the calculations rather than guessed —
          correct the source file and re-run the analysis for a cleaner report.
        </p>
      ) : null}

      {issue.type === 'missing_dates' ? (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          {issue.detail.includes('no attendance')
            ? 'Upload the attendance export for these dates to complete the audit.'
            : 'These dates are excluded from the audit entirely — they cannot be judged from either source.'}
        </p>
      ) : null}
    </Card>
  );
}

export function ReviewPage() {
  const { result, corrections, resetCorrections, runAnalysis, analyzing } = useStore();
  const [tab, setTab] = React.useState<'all' | 'matching' | ReviewIssueType>('all');
  const [evidenceId, setEvidenceId] = React.useState<string | null>(null);

  if (!result) {
    return (
      <>
        <PageHeader
          title="Review Center"
          description="Resolve uncertain classifications, name matches and conflicts before relying on the audit."
        />
        <Alert tone="info" title="No analysis yet">
          <p>Upload your files and run the analysis to populate the Review Center.</p>
        </Alert>
      </>
    );
  }

  const issues = result.reviewIssues;
  const counts = TYPE_ORDER.map((type) => ({ type, count: issues.filter((issue) => issue.type === type).length }));
  const visible = tab === 'all' || tab === 'matching' ? issues : issues.filter((issue) => issue.type === tab);
  const correctionCount =
    Object.keys(corrections.audience).length +
    Object.keys(corrections.events).length +
    Object.keys(corrections.nameOverrides).length +
    Object.keys(corrections.removedMentions).length +
    corrections.dismissedRecords.length;

  const evidenceRecord =
    result.auditRecords.find((record) => record.id === evidenceId) ??
    (evidenceId ? result.auditRecords.find((record) => record.matchStatus === 'UNCERTAIN') ?? null : null);

  return (
    <>
      <PageHeader
        title="Review Center"
        description={`${issues.length} item(s) need a human decision. Decisions are kept for this analysis and applied the next time the analysis runs — nothing is guessed on your behalf.`}
        actions={
          <>
            <Button variant="outline" onClick={resetCorrections} disabled={correctionCount === 0}>
              <RotateCcw /> Reset {correctionCount > 0 ? `${correctionCount} decision(s)` : 'decisions'}
            </Button>
            <Button onClick={runAnalysis} disabled={analyzing}>
              <RefreshCw className={analyzing ? 'animate-spin' : ''} /> Re-run analysis with my decisions
            </Button>
          </>
        }
      />

      {correctionCount > 0 ? (
        <Alert tone="success" title="You have manual decisions pending" className="mb-4">
          <p>
            {correctionCount} decision(s) recorded. They are stored with the uploads and will be applied when you
            press “Re-run analysis with my decisions”.
          </p>
        </Alert>
      ) : null}

      <Tabs<'all' | 'matching' | ReviewIssueType>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All items', count: issues.length },
          { value: 'matching', label: 'Person matching', count: result.nameMatches.length },
          ...counts.map((entry) => ({
            value: entry.type,
            label: TYPE_LABELS[entry.type],
            count: entry.count,
          })),
        ]}
      />

      {tab === 'matching' ? <PersonMatchingTable result={result} /> : null}

      {tab === 'matching' ? null : visible.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="size-8" />}
          title="Nothing to review in this category"
          description="Every message, name match and attendance row in this category is unambiguous, or you have already resolved it."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((issue) => (
            <IssueCard key={issue.id} issue={issue} result={result} onEvidence={setEvidenceId} />
          ))}
        </div>
      )}

      <Separator className="my-6" />

      <Card className="p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ShieldQuestion className="size-4" /> How manual corrections work
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
          <li>The uploaded files are never modified — corrections live on top of them and are listed above.</li>
          <li>
            Re-running the analysis rebuilds the audit with your decisions applied: corrected audiences, corrected
            events, approved names (with alias rules) and dismissed rows.
          </li>
          <li>
            Unmatched names stay unmatched until you explicitly approve a candidate. A similar name alone never marks
            someone as “notified”.
          </li>
        </ul>
      </Card>

      <EvidenceModal record={evidenceRecord} open={evidenceRecord !== null} onClose={() => setEvidenceId(null)} />
    </>
  );
}
