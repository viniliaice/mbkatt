import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  MessageSquare,
  PlayCircle,
  ShieldCheck,
  Trash2,
  Upload,
  X,
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
  Progress,
  Select,
  Spinner,
  StatCard,
} from '@/components/ui';
import { FILE_KIND_LABELS } from '@/lib/detect';
import { formatDisplayDate } from '@/lib/dates';
import { useStore } from '@/lib/store';
import type { FileKind } from '@/lib/types';

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
  } = useStore();
  const navigate = useNavigate();
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) await addFiles(event.dataTransfer.files);
  };

  const whatsappFiles = files.filter((file) => (file.kindOverride ?? file.kind) === 'whatsapp');
  const attendanceFiles = files.filter((file) => (file.kindOverride ?? file.kind) === 'attendance');
  const unknownFiles = files.filter((file) => (file.kindOverride ?? file.kind) === 'unknown');

  const canAnalyze = files.length > 0 && unknownFiles.length === 0 && !analyzing;

  return (
    <>
      <PageHeader
        title="Upload files"
        description="Add the WhatsApp chat export and the attendance file(s). Files are read locally in this browser tab — nothing is sent to a server."
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

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mb-5 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] bg-[var(--card)]'
        }`}
      >
        <Upload className="size-8 text-[var(--muted-foreground)]" />
        <div>
          <p className="font-medium">Drag &amp; drop your files here</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Supported: .md, .txt, .csv and Excel (.xlsx/.xls) · you can add several files at once
            (chat.md, attendence.csv, attendence11.csv.txt)
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
          }}
        />
        <Button onClick={() => inputRef.current?.click()}>
          <Upload /> Choose files
        </Button>
      </div>

      {files.length === 0 ? (
        <Alert tone="info" title="What happens next">
          <ol className="list-decimal space-y-1 pl-5">
            <li>The type of each file is detected from its content (not only its name).</li>
            <li>Each file is parsed and previewed, and parsing problems are listed.</li>
            <li>Names are matched between WhatsApp and the attendance files.</li>
            <li>Attendance rules are applied and both systems are cross-referenced.</li>
            <li>The dashboard, audit tables and reports become available.</li>
          </ol>
        </Alert>
      ) : null}

      {files.length > 0 ? (
        <section className="mt-5 space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Files detected ({files.length})</CardTitle>
                <CardDescription>
                  {whatsappFiles.length} WhatsApp export(s), {attendanceFiles.length} attendance file(s)
                  {unknownFiles.length > 0 ? `, ${unknownFiles.length} unrecognised` : ''}
                </CardDescription>
              </div>
              <Button onClick={runAnalysis} disabled={!canAnalyze}>
                {analyzing ? <Spinner /> : <PlayCircle />}
                {analyzing ? 'Analyzing…' : 'Analyze attendance'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {unknownFiles.length > 0 ? (
                <Alert tone="warning" title="Some files could not be identified">
                  <p>
                    Choose the correct type for each file below. The analysis will not run until every
                    file has a type, because guessing could distort the audit.
                  </p>
                </Alert>
              ) : null}

              {files.map((file) => (
                <div key={file.id} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {(file.kindOverride ?? file.kind) === 'whatsapp' ? (
                          <MessageSquare className="size-4" />
                        ) : (file.kindOverride ?? file.kind) === 'attendance' ? (
                          <FileSpreadsheet className="size-4" />
                        ) : (
                          <AlertTriangle className="size-4 text-amber-600" />
                        )}
                        <span className="font-medium">{file.name}</span>
                        <Badge
                          tone={
                            (file.kindOverride ?? file.kind) === 'whatsapp'
                              ? 'info'
                              : (file.kindOverride ?? file.kind) === 'attendance'
                                ? 'primary'
                                : 'warning'
                          }
                        >
                          {FILE_KIND_LABELS[file.kindOverride ?? file.kind]}
                        </Badge>
                        {file.kindOverride ? <Badge tone="warning">manually set</Badge> : null}
                        <Badge tone={file.detection.confidence > 0.6 ? 'success' : 'neutral'}>
                          detection {Math.round(file.detection.confidence * 100)}%
                        </Badge>
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <ul className="mt-2 space-y-0.5 text-xs text-[var(--muted-foreground)]">
                        {file.detection.reasons.slice(0, 4).map((reason, index) => (
                          <li key={index}>• {reason}</li>
                        ))}
                      </ul>
                      {file.detection.warnings.length > 0 ? (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                          {file.detection.warnings.join(' ')}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        aria-label={`Type of ${file.name}`}
                        value={file.kindOverride ?? file.kind}
                        onChange={(event) => setFileKind(file.id, event.target.value as FileKind)}
                        className="w-[190px]"
                      >
                        <option value="whatsapp">WhatsApp chat export</option>
                        <option value="attendance">Attendance file</option>
                        <option value="unknown">Unrecognised</option>
                      </Select>
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
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-[var(--muted-foreground)]">
                      Preview the parsed content
                    </summary>
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--muted)] p-3 text-xs scrollbar-thin">
                      {file.preview}
                      {file.preview.length >= 600 ? '\n…' : ''}
                    </pre>
                  </details>
                </div>
              ))}
            </CardContent>
          </Card>

          {analyzing && progress ? (
            <Card className="p-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Loader2 className="size-4 animate-spin" />
                {progress.step}…
              </div>
              <Progress value={progress.ratio * 100} />
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                Parsing files, classifying messages, matching names and cross-referencing attendance.
              </p>
            </Card>
          ) : null}

          {result ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-600" /> Validation before you rely on the audit
                </CardTitle>
                <CardDescription>
                  These are the real counts parsed from your files — nothing is estimated.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="WhatsApp messages" value={result.validation.totals.whatsappMessages} />
                  <StatCard
                    label="Staff messages"
                    value={result.validation.totals.staffMessages}
                    tone="primary"
                  />
                  <StatCard label="Student messages" value={result.validation.totals.studentMessages} tone="info" />
                  <StatCard
                    label="Uncertain messages"
                    value={result.validation.totals.uncertainMessages}
                    tone="warning"
                  />
                  <StatCard
                    label="Attendance employees"
                    value={result.validation.totals.attendanceEmployees}
                  />
                  <StatCard
                    label="Employees matched"
                    value={result.validation.totals.employeesMatched}
                    tone="success"
                  />
                  <StatCard
                    label="Requiring review"
                    value={result.validation.totals.employeesRequiringReview}
                    tone="warning"
                  />
                  <StatCard
                    label="Unmatched names"
                    value={result.validation.totals.unmatchedNames}
                    tone="danger"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="p-4">
                    <h3 className="mb-2 text-sm font-semibold">Files and records parsed</h3>
                    {result.validation.files.map((file) => (
                      <div key={file.fileId} className="border-b border-[var(--border)] py-2 last:border-0">
                        <p className="text-sm font-medium">{file.fileName}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {FILE_KIND_LABELS[file.kind]} · {file.recordsParsed} record(s) parsed · detection{' '}
                          {Math.round(file.confidence * 100)}%
                        </p>
                        {file.warnings.slice(0, 4).map((warning, index) => (
                          <p key={index} className="text-xs text-amber-700 dark:text-amber-300">
                            {warning}
                          </p>
                        ))}
                      </div>
                    ))}
                  </Card>
                  <Card className="p-4">
                    <h3 className="mb-2 text-sm font-semibold">Coverage</h3>
                    <KeyValue label="Dates found" value={result.validation.totals.datesFound} />
                    <KeyValue
                      label="Attendance data"
                      value={`${formatDisplayDate(result.coverage.attendanceFirstDate)} – ${formatDisplayDate(
                        result.coverage.attendanceLastDate,
                      )}`}
                    />
                    <KeyValue
                      label="WhatsApp chat"
                      value={`${formatDisplayDate(result.coverage.whatsappFirstDate)} – ${formatDisplayDate(
                        result.coverage.whatsappLastDate,
                      )}`}
                    />
                    <KeyValue label="Working days" value={result.coverage.workingDates.length} />
                    <KeyValue label="Attendance records" value={result.validation.totals.attendanceRecords} />
                    <KeyValue label="Punches read" value={result.validation.totals.punches} />
                    <KeyValue label="Parsing problems" value={result.validation.totals.parseProblems} />
                  </Card>
                </div>

                {result.validation.problems.length > 0 ? (
                  <Alert tone="warning" title={`Potential parsing problems (${result.validation.problems.length})`}>
                    <ul className="list-disc space-y-1 pl-5">
                      {result.validation.problems.slice(0, 8).map((problem) => (
                        <li key={problem.id}>
                          <span className="font-medium">{problem.title}:</span> {problem.detail}
                          {problem.sourceFile ? ` (${problem.sourceFile})` : ''}
                        </li>
                      ))}
                    </ul>
                    {result.validation.problems.length > 8 ? (
                      <p className="text-xs">
                        …and {result.validation.problems.length - 8} more — see the Review Center.
                      </p>
                    ) : null}
                  </Alert>
                ) : null}

                {result.validation.warnings.length > 0 ? (
                  <Alert tone="info" title="Notes about the data">
                    <ul className="list-disc space-y-1 pl-5">
                      {result.validation.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => navigate('/')}>
                    <CheckCircle2 /> Open the dashboard
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/audit')}>
                    <FileText /> Inspect the daily audit
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/review')}>
                    <AlertTriangle /> Resolve review items ({result.reviewIssues.length})
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Alert tone="info" title="Privacy reminder">
            <p>
              {settings.persistToBrowser
                ? 'Local persistence is enabled: the uploaded files are stored in this browser (localStorage) so you can continue later. Use “Delete all files” to remove them.'
                : 'Local persistence is disabled: the files exist only in this tab and disappear when you close it.'}{' '}
              Nothing is uploaded to any server, and exports are generated locally — treat them as confidential.
            </p>
          </Alert>
        </section>
      ) : null}
    </>
  );
}
