/**
 * Upload & parsing validation screen — specification items 38, 45–51.
 *
 * Two separate operations are shown for every file: (1) identification
 * (file type + confidence, from structure) and (2) parsing (how many records
 * were actually read). A file can be confidently identified as a WhatsApp
 * export and still yield zero messages — that difference is always visible
 * here, with the diagnostics that explain it.
 */

import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  FileText,
  Info,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/AppShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  KeyValue,
  Modal,
  Progress,
  Select,
  Spinner,
  StatCard,
} from '@/components/ui';
import { FILE_KIND_LABELS } from '@/lib/detect';
import { formatDisplayDate } from '@/lib/dates';
import { useStore } from '@/lib/store';
import type { FileKind, ReviewIssue, ValidationReport } from '@/lib/types';

/** One entry of the validation report — the per-file detail shown in the cards. */
type FileValidation = ValidationReport['files'][number];

const PROBLEM_CATEGORIES: { id: ReviewIssue['type'][]; label: string; hint: string }[] = [
  { id: ['unparsed_message'], label: 'WhatsApp lines / files', hint: 'Timestamps, senders or message blocks a format did not cover.' },
  { id: ['malformed_time'], label: 'Attendance times', hint: 'Cells whose time value could not be read.' },
  { id: ['duplicate_record'], label: 'Duplicate records', hint: 'The same employee/day appearing more than once.' },
  { id: ['employee_without_punches'], label: 'Employees without punches', hint: 'Employees with no readable punch at all.' },
  { id: ['missing_dates'], label: 'Missing dates', hint: 'Dates present in one source but not the other.' },
  { id: ['uncertain_classification'], label: 'Uncertain classifications', hint: 'Messages that may be staff or student — review them.' },
  { id: ['uncertain_name_match'], label: 'Name matching', hint: 'Possible or unmatched WhatsApp names.' },
  { id: ['conflicting_attendance'], label: 'Conflicts', hint: 'WhatsApp and biometric records that disagree.' },
  { id: ['unknown_event'], label: 'Unrecognised events', hint: 'Staff messages with no attendance event detected.' },
];

function SeverityBadge({ issue }: { issue: ReviewIssue }) {
  if (issue.critical) return <Badge tone="danger">critical</Badge>;
  if (issue.severity === 'high') return <Badge tone="danger">high</Badge>;
  if (issue.severity === 'medium') return <Badge tone="warning">medium</Badge>;
  return <Badge tone="neutral">low</Badge>;
}

export function UploadPage() {
  const {
    files,
    addFiles,
    removeFile,
    setFileKind,
    clearAll,
    runAnalysis,
    analyzing,
    progress,
    result,
    loadSamples,
    settings,
    updateSettings,
  } = useStore();
  const navigate = useNavigate();
  const [dragging, setDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<{ file: FileValidation; mode: 'raw' | 'parsed' } | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) await addFiles(event.dataTransfer.files);
  };

  const kindOf = (file: (typeof files)[number]) => file.kindOverride ?? file.kind;
  const whatsappFiles = files.filter((file) => kindOf(file) === 'whatsapp');
  const attendanceFiles = files.filter((file) => kindOf(file) === 'attendance');
  const unknownFiles = files.filter((file) => kindOf(file) === 'unknown');

  const validation: ValidationReport | null = result?.validation ?? null;
  const criticalProblems = validation?.problems.filter((issue) => issue.critical) ?? [];
  const otherProblems = validation?.problems.filter((issue) => !issue.critical) ?? [];
  const canAnalyze = files.length > 0 && unknownFiles.length === 0 && !analyzing;
  const fileReport = (fileId: string) => validation?.files.find((entry) => entry.fileId === fileId) ?? null;

  /* deterministic per-category counts (spec 47) */
  const categoryCounts = PROBLEM_CATEGORIES.map((category) => ({
    ...category,
    items: otherProblems.filter((issue) => category.id.includes(issue.type)),
    criticalItems: criticalProblems.filter((issue) => category.id.includes(issue.type)),
  }));

  return (
    <>
      <PageHeader
        title="Upload &amp; parsing validation"
        description="Add the WhatsApp chat export and the attendance file(s). Everything is read locally in this browser tab — nothing is sent to a server. Identification and parsing are reported separately for every file."
        actions={
          <>
            <Button variant="outline" onClick={loadSamples}>
              Load sample files
            </Button>
            {files.length > 0 ? (
              <Button variant="destructive" onClick={clearAll}>
                <Trash2 /> Delete all files
              </Button>
            ) : null}
          </>
        }
      />

      {/* ------------------------------------------------------------ 1. upload */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mb-5 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] bg-[var(--card)]'
        }`}
      >
        <Upload className="size-8 text-[var(--muted-foreground)]" />
        <div>
          <p className="font-medium">Drag &amp; drop your files here</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Supported: .md, .txt, .csv, .tsv and Excel (.xlsx/.xls) · WhatsApp exports in all supported formats
            (bracketed, ISO, dash and markdown heading styles) are recognised automatically
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".md,.txt,.csv,.tsv,.xlsx,.xls,.xlsm"
          className="hidden"
          onChange={async (event) => {
            if (event.target.files?.length) await addFiles(event.target.files);
            event.target.value = '';
            setAcknowledged(false);
          }}
        />
        <Button onClick={() => inputRef.current?.click()}>
          <Upload /> Choose files
        </Button>
      </div>

      {/* -------------------------------------------------- 2. files detected */}
      {files.length > 0 ? (
        <Card className="mb-5">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Files detected ({files.length})</CardTitle>
              <CardDescription>
                {whatsappFiles.length > 0 ? (
                  <span className="mr-3 inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3.5 text-emerald-600" /> {whatsappFiles.length} WhatsApp export
                  </span>
                ) : null}
                {attendanceFiles.length > 0 ? (
                  <span className="mr-3 inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3.5 text-emerald-600" /> {attendanceFiles.length} attendance file
                    {attendanceFiles.length > 1 ? 's' : ''}
                  </span>
                ) : null}
                {unknownFiles.length > 0 ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="size-3.5" /> {unknownFiles.length} unrecognised
                  </span>
                ) : null}
              </CardDescription>
            </div>
            <Button onClick={runAnalysis} disabled={!canAnalyze}>
              {analyzing ? <Spinner /> : <PlayCircle />}
              {analyzing ? 'Analyzing…' : result ? 'Re-analyze' : 'Analyze attendance'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {unknownFiles.length > 0 ? (
              <Alert tone="warning" title="Some files could not be identified">
                <p>
                  Identification and parsing are different steps: choose the correct type for each file below before
                  analysing, so the audit is built from the right data.
                </p>
              </Alert>
            ) : null}

            {files.map((file) => {
              const kind = kindOf(file);
              const report = fileReport(file.id);
              return (
                <div key={file.id} className="rounded-lg border border-[var(--border)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {kind === 'whatsapp' ? (
                          <MessageSquare className="size-4" />
                        ) : kind === 'attendance' ? (
                          <FileSpreadsheet className="size-4" />
                        ) : (
                          <AlertTriangle className="size-4 text-amber-600" />
                        )}
                        <span className="font-medium">{file.name}</span>
                        <Badge tone={kind === 'whatsapp' ? 'info' : kind === 'attendance' ? 'primary' : 'warning'}>
                          {FILE_KIND_LABELS[kind]}
                        </Badge>
                        {file.kindOverride ? <Badge tone="warning">type set manually</Badge> : null}
                        <Badge tone={file.detection.confidence > 0.6 ? 'success' : 'neutral'}>
                          detection {Math.round(file.detection.confidence * 100)}%
                        </Badge>
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>

                      <div className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        {report?.kind === 'whatsapp' ? (
                          <>
                            <KeyValue label="Messages parsed" value={report.recordsParsed} />
                            <KeyValue label="Staff messages" value={report.staffMessages ?? 0} />
                            <KeyValue label="Student messages" value={report.studentMessages ?? 0} />
                            <KeyValue label="Uncertain messages" value={report.uncertainMessages ?? 0} />
                          </>
                        ) : null}
                        {report?.kind === 'attendance' ? (
                          <>
                            <KeyValue label="Employees" value={report.employees ?? 0} />
                            <KeyValue label="Records parsed" value={report.records ?? 0} />
                            <KeyValue label="Punches read" value={report.punches ?? 0} />
                            <KeyValue
                              label="Date range"
                              value={`${formatDisplayDate(report.dateRange?.first ?? null)} – ${formatDisplayDate(
                                report.dateRange?.last ?? null,
                              )}`}
                            />
                          </>
                        ) : null}
                        {!report ? (
                          <p className="text-xs text-[var(--muted-foreground)]">
                            Not parsed yet — press “Analyze attendance” to run identification and parsing.
                          </p>
                        ) : null}
                      </div>

                      <ul className="mt-3 space-y-0.5 text-xs text-[var(--muted-foreground)]">
                        {file.detection.reasons.slice(0, 4).map((reason, index) => (
                          <li key={index}>• {reason}</li>
                        ))}
                      </ul>
                      {report && report.warnings.length > 0 ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-amber-700 dark:text-amber-300">
                            {report.warnings.length} parsing note(s)
                          </summary>
                          <ul className="mt-1 space-y-0.5 text-xs text-[var(--muted-foreground)]">
                            {report.warnings.slice(0, 12).map((warning, index) => (
                              <li key={index}>• {warning}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-stretch gap-2">
                      <Select
                        aria-label={`Type of ${file.name}`}
                        value={kind}
                        onChange={(event) => setFileKind(file.id, event.target.value as FileKind)}
                        className="w-[190px]"
                      >
                        <option value="whatsapp">WhatsApp chat export</option>
                        <option value="attendance">Attendance file</option>
                        <option value="unknown">Unrecognised</option>
                      </Select>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!report}
                          onClick={() => report && setPreview({ file: report, mode: 'raw' })}
                        >
                          <Eye /> Raw
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!report}
                          onClick={() => report && setPreview({ file: report, mode: 'parsed' })}
                        >
                          <ListChecks /> Parsed
                        </Button>
                        <Button variant="outline" size="sm" disabled={analyzing} onClick={runAnalysis}>
                          <RefreshCw className={analyzing ? 'animate-spin' : ''} /> Re-analyze
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => removeFile(file.id)}
                        >
                          <X />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <Alert tone="info" title="What happens next">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Each file is identified from its structure (not its name) and the confidence is shown.</li>
            <li>Each file is parsed separately, and the number of records actually read is reported.</li>
            <li>If a WhatsApp export is identified but nothing can be parsed, the diagnostics explain why.</li>
            <li>Duplicate attendance files are compared and you choose which source is used.</li>
            <li>You review the validation summary before the audit is generated.</li>
          </ol>
        </Alert>
      )}

      {analyzing && progress ? (
        <Card className="mb-5 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin" />
            {progress.step}…
          </div>
          <Progress value={progress.ratio * 100} />
        </Card>
      ) : null}

      {/* ------------------------------------- 3. WhatsApp parsing diagnostics */}
      {result && whatsappFiles.length > 0 ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="size-4" /> WhatsApp parsing diagnostics
            </CardTitle>
            <CardDescription>
              These counters come straight from the parser. They are what makes a “0 messages” result explainable
              instead of silent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {validation?.files
              .filter((entry) => entry.kind === 'whatsapp')
              .map((entry) => {
                const diagnostics = entry.diagnostics;
                if (!diagnostics) {
                  return (
                    <Alert key={entry.fileId} tone="warning" title={`${entry.fileName}: not parsed`}>
                      <p>{entry.warnings[0] ?? 'The file was not parsed at all.'}</p>
                    </Alert>
                  );
                }
                const failed = diagnostics.parsedMessages === 0;
                return (
                  <div key={entry.fileId} className="space-y-3">
                    {failed ? (
                      <Alert tone="danger" title={`${entry.fileName}: WhatsApp parsing failed or no messages were recognized`}>
                        <p>
                          {diagnostics.formatMismatch
                            ? 'PARSER FORMAT MISMATCH — timestamp-like lines were found, but none matched a supported export format.'
                            : 'No timestamp-like lines were found in this file at all.'}
                        </p>
                        {diagnostics.unrecognisedSamples.length > 0 ? (
                          <div className="mt-2">
                            <p className="font-medium">First unrecognised lines:</p>
                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-2 text-xs">
                              {diagnostics.unrecognisedSamples.join('\n')}
                            </pre>
                          </div>
                        ) : null}
                        {diagnostics.sampleLines.length > 0 ? (
                          <div className="mt-2">
                            <p className="font-medium">Recognised sample lines:</p>
                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-2 text-xs">
                              {diagnostics.sampleLines.join('\n')}
                            </pre>
                          </div>
                        ) : null}
                      </Alert>
                    ) : (
                      <Alert tone="success" title={`${entry.fileName}: parsed successfully`}>
                        <p>
                          {diagnostics.parsedMessages} message(s) recognised across {diagnostics.formatsDetected.length}{' '}
                          format(s): {diagnostics.formatsDetected.join(', ')}.
                        </p>
                      </Alert>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <StatCard label="Date headings" value={diagnostics.dateHeadings} hint="Markdown/date headings used to date messages" />
                      <StatCard label="Timestamps detected" value={diagnostics.timestamps} />
                      <StatCard label="Sender patterns" value={diagnostics.senderPatterns} />
                      <StatCard label="Message blocks" value={diagnostics.messageBlocks} />
                      <StatCard label="Parsed messages" value={diagnostics.parsedMessages} tone={failed ? 'danger' : 'success'} />
                      <StatCard label="Malformed" value={diagnostics.malformed} tone={diagnostics.malformed > 0 ? 'warning' : 'neutral'} />
                      <StatCard label="Missing sender" value={diagnostics.missingSender} tone={diagnostics.missingSender > 0 ? 'warning' : 'neutral'} />
                      <StatCard label="Multi-line recovered" value={diagnostics.recoveredMultiline} hint="Continuation lines kept inside one message" />
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------- 4. duplicate source check */}
      {result && result.attendanceFiles.length > 1 ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4" /> Attendance file comparison
            </CardTitle>
            <CardDescription>
              Nothing is double-counted: employees and days appearing in more than one file are counted once, and the
              source used for each overlapping day is stated below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.sourceComparison.map((comparison) => (
              <div key={comparison.fileIds.join('-')} className="rounded-lg border border-[var(--border)] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      comparison.relation === 'conflicting'
                        ? 'danger'
                        : comparison.relation === 'unrelated'
                          ? 'neutral'
                          : 'warning'
                    }
                  >
                    {comparison.relation.replace('-', ' ')}
                  </Badge>
                  <span className="text-sm font-medium">
                    {comparison.fileNames[0]} ↔ {comparison.fileNames[1]}
                  </span>
                </div>
                <p className="mt-2 text-sm">{comparison.relationLabel}</p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">{comparison.explanation}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--muted-foreground)]">Use for the calculation:</span>
                  <Button
                    size="sm"
                    variant={settings.primaryAttendanceSource === 'both' ? 'default' : 'outline'}
                    onClick={async () => {
                      updateSettings({ primaryAttendanceSource: 'both' });
                      await runAnalysis();
                    }}
                  >
                    Use both
                  </Button>
                  <Button
                    size="sm"
                    variant={settings.primaryAttendanceSource === comparison.fileIds[0] ? 'default' : 'outline'}
                    onClick={async () => {
                      updateSettings({ primaryAttendanceSource: comparison.fileIds[0] });
                      await runAnalysis();
                    }}
                  >
                    {comparison.fileNames[0]} as primary
                  </Button>
                  <Button
                    size="sm"
                    variant={settings.primaryAttendanceSource === comparison.fileIds[1] ? 'default' : 'outline'}
                    onClick={async () => {
                      updateSettings({ primaryAttendanceSource: comparison.fileIds[1] });
                      await runAnalysis();
                    }}
                  >
                    {comparison.fileNames[1]} as primary
                  </Button>
                  <Button
                    size="sm"
                    variant={settings.primaryAttendanceSource === 'auto' ? 'default' : 'outline'}
                    onClick={async () => {
                      updateSettings({ primaryAttendanceSource: 'auto' });
                      await runAnalysis();
                    }}
                  >
                    Automatic
                  </Button>
                </div>
              </div>
            ))}
            {result.sourceNotes.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-sm text-[var(--muted-foreground)]">
                  Which source was used for each overlapping day ({result.sourceNotes.length})
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-[var(--muted-foreground)]">
                  {result.sourceNotes.map((note, index) => (
                    <li key={index}>• {note}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------ 5. validation before analysis */}
      {result ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-600" /> Validation before analysis
            </CardTitle>
            <CardDescription>
              Real counts read from your files — nothing is estimated. Numbers marked “n/a” mean the data was not in
              the file at all.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="WhatsApp messages" value={result.validation.totals.whatsappMessages} />
              <StatCard label="Staff messages" value={result.validation.totals.staffMessages} tone="primary" />
              <StatCard label="Student messages" value={result.validation.totals.studentMessages} tone="info" />
              <StatCard label="Uncertain messages" value={result.validation.totals.uncertainMessages} tone="warning" />
              <StatCard label="Attendance employees" value={result.validation.totals.attendanceEmployees} />
              <StatCard label="Employees matched" value={result.validation.totals.employeesMatched} tone="success" />
              <StatCard
                label="Requiring review"
                value={result.validation.totals.employeesRequiringReview}
                tone="warning"
              />
              <StatCard label="Unmatched names" value={result.validation.totals.unmatchedNames} tone="danger" />
              <StatCard label="Attendance records" value={result.validation.totals.attendanceRecords} />
              <StatCard label="Punches read" value={result.validation.totals.punches} />
              <StatCard label="Dates found" value={result.validation.totals.datesFound} />
              <StatCard label="Working days" value={result.coverage.workingDates.length} />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Card className="p-3">
                <p className="text-xs uppercase text-[var(--muted-foreground)]">Coverage</p>
                <p className="mt-1 text-sm font-medium">
                  {formatDisplayDate(result.coverage.firstDate)} – {formatDisplayDate(result.coverage.lastDate)}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Attendance data: {formatDisplayDate(result.coverage.attendanceFirstDate)} –{' '}
                  {formatDisplayDate(result.coverage.attendanceLastDate)}
                  <br />
                  WhatsApp chat: {formatDisplayDate(result.coverage.whatsappFirstDate)} –{' '}
                  {formatDisplayDate(result.coverage.whatsappLastDate)}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-xs uppercase text-[var(--muted-foreground)]">Parsing problems</p>
                <p className="mt-1 text-sm font-medium">
                  {validation?.totals.criticalProblems ?? 0} critical · {validation?.totals.warningProblems ?? 0} warning
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Critical problems stop an honest audit: resolve them or accept the audit explicitly.
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-xs uppercase text-[var(--muted-foreground)]">Audited rows produced</p>
                <p className="mt-1 text-sm font-medium">{result.auditRecords.length}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {result.employeeSummaries.length} employee summaries · {result.admin.log.length} administrative log
                  entries
                </p>
              </Card>
            </div>

            {criticalProblems.length > 0 ? (
              <Alert tone="danger" title={`Critical parsing problems (${criticalProblems.length})`}>
                <ul className="list-disc space-y-1 pl-5">
                  {criticalProblems.map((issue) => (
                    <li key={issue.id}>
                      <span className="font-medium">{issue.title}</span>
                      {issue.sourceFile ? ` — ${issue.sourceFile}` : ''}
                      <span className="block text-xs">{issue.detail}</span>
                      {issue.suggestion ? <span className="block text-xs italic">{issue.suggestion}</span> : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => inputRef.current?.click()}>
                    <Upload /> Replace the files
                  </Button>
                  <Button variant={acknowledged ? 'default' : 'outline'} onClick={() => setAcknowledged(true)}>
                    {acknowledged ? <CheckCircle2 /> : <XCircle />} Proceed anyway
                  </Button>
                  <span className="text-xs">
                    {acknowledged
                      ? 'You chose to proceed; the affected days stay marked as parsing problems and are never treated as absences.'
                      : '“Proceed to Analyze” stays disabled until you resolve the problems or choose to proceed anyway.'}
                  </span>
                </div>
              </Alert>
            ) : (
              <Alert tone="success" title="No critical parsing problems">
                <p>
                  Every uploaded file was identified and parsed. Warnings below are listed for transparency and do not
                  block the audit.
                </p>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => navigate('/')}
                disabled={(validation?.totals.criticalProblems ?? 0) > 0 && !acknowledged}
              >
                <PlayCircle /> Proceed to Analyze
              </Button>
              <Button variant="outline" onClick={() => navigate('/administrative')}>
                <FileText /> Administrative summary
              </Button>
              <Button variant="outline" onClick={() => navigate('/audit')}>
                <FileSpreadsheet /> Daily audit
              </Button>
              <Button variant="outline" onClick={() => navigate('/review')}>
                <AlertTriangle /> Review Center ({result.reviewIssues.length})
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------ 6. parsing problems */}
      {result ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Parsing problems by category</CardTitle>
            <CardDescription>
              Categorised rather than lumped together, with the file, line, raw content and a suggested correction for
              each item.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {categoryCounts.map((category) => (
              <details key={category.label} open={category.criticalItems.length > 0}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
                  {category.label}
                  <Badge tone={category.criticalItems.length > 0 ? 'danger' : category.items.length > 0 ? 'warning' : 'success'}>
                    {category.items.length + category.criticalItems.length}
                  </Badge>
                  <span className="text-xs font-normal text-[var(--muted-foreground)]">{category.hint}</span>
                </summary>
                <div className="mt-2 space-y-2">
                  {category.criticalItems.length + category.items.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">
                      No problems in this category — the file(s) parsed cleanly here.
                    </p>
                  ) : (
                    [...category.criticalItems, ...category.items].slice(0, 25).map((issue) => (
                      <div key={issue.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge issue={issue} />
                          <span className="font-medium">{issue.title}</span>
                          {issue.sourceFile ? (
                            <span className="text-xs text-[var(--muted-foreground)]">
                              {issue.sourceFile}
                              {issue.sourceLocation ? ` · ${issue.sourceLocation}` : ''}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[var(--muted-foreground)]">{issue.detail}</p>
                        {issue.raw ? (
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-2 text-xs">
                            {issue.raw}
                          </pre>
                        ) : null}
                        {issue.suggestion ? (
                          <p className="mt-1 text-xs italic text-[var(--muted-foreground)]">
                            Suggested correction: {issue.suggestion}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                  {category.items.length + category.criticalItems.length > 25 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">
                      …and {category.items.length + category.criticalItems.length - 25} more — see the Review Center.
                    </p>
                  ) : null}
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {result?.validation.warnings.length ? (
        <Alert tone="info" title="Notes about the data" className="mb-5">
          <ul className="list-disc space-y-1 pl-5">
            {result.validation.warnings.slice(0, 12).map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Alert tone="info" title="Privacy reminder">
        <p className="flex items-start gap-2">
          <Lock className="mt-0.5 size-3.5" />
          <span>
            {settings.persistToBrowser
              ? 'Local persistence is enabled: the uploaded files are stored in this browser (localStorage) so you can continue later. Use “Delete all files” to remove them.'
              : 'Local persistence is disabled: the files exist only in this tab and disappear when you close it.'}{' '}
            Nothing is uploaded to any server, and exports are generated locally — treat them as confidential.
          </span>
        </p>
      </Alert>

      {/* ------------------------------------------- 7. raw / parsed preview */}
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        size="xl"
        title={preview ? `${preview.mode === 'raw' ? 'Raw file' : 'Parsed records'} — ${preview.file.fileName}` : ''}
        description={
          preview
            ? preview.mode === 'raw'
              ? 'First 20 lines exactly as they appear in the uploaded file.'
              : 'First 20 records the parser produced from this file.'
            : undefined
        }
        footer={
          <>
            <Button
              variant="outline"
              onClick={() =>
                setPreview((current) => (current ? { ...current, mode: current.mode === 'raw' ? 'parsed' : 'raw' } : null))
              }
            >
              <Info /> Show {preview?.mode === 'raw' ? 'parsed records' : 'raw lines'}
            </Button>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Close
            </Button>
          </>
        }
      >
        {preview ? (
          <div className="space-y-4">
            {preview.mode === 'raw' ? (
              <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-xs scrollbar-thin">
                {(preview.file.previewRaw ?? []).join('\n') || 'The file is empty.'}
              </pre>
            ) : (
              <div className="max-h-[55vh] space-y-3 overflow-auto scrollbar-thin">
                {(preview.file.previewParsed ?? []).length === 0 ? (
                  <Alert tone="warning" title="No parsed records">
                    <p>
                      The parser produced no records from this file. The diagnostics on the upload screen explain what
                      was detected and which formats are supported.
                    </p>
                  </Alert>
                ) : (
                  (preview.file.previewParsed ?? []).map((record, index) => (
                    <pre
                      key={index}
                      className="whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-xs"
                    >
                      {`#${index + 1}\n${record}`}
                    </pre>
                  ))
                )}
              </div>
            )}
            <p className="text-xs text-[var(--muted-foreground)]">
              Raw data is never modified: the file is shown exactly as uploaded, and the parsed view shows exactly what
              the audit will use.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
