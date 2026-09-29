import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CalendarX,
  Clock,
  FileSpreadsheet,
  Hospital,
  LogOut,
  ShieldAlert,
  Upload,
  UserX,
  Users,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/AppShell';
import {
  AttendanceTrendChart,
  DiscrepancyPieChart,
  EmployeeBarChart,
  MessageClassificationChart,
  NotificationsByDateChart,
  NotifiedVsUnnotifiedChart,
} from '@/components/Charts';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, StatCard } from '@/components/ui';
import { formatDisplayDate } from '@/lib/dates';
import { matchStatusMeta } from '@/lib/statuses';
import { useStore } from '@/lib/store';

export function DashboardPage() {
  const { result, files } = useStore();
  const navigate = useNavigate();

  if (!result) {
    return (
      <>
        <PageHeader
          title="Dashboard"
          description="A complete staff attendance audit built by cross-referencing your biometric attendance files with the WhatsApp group notifications."
        />
        <EmptyState
          icon={<Upload className="size-8" />}
          title={files.length > 0 ? 'Files are loaded — run the analysis' : 'Start by uploading your files'}
          description={
            files.length > 0
              ? `${files.length} file(s) are loaded and waiting. Open the Upload page, check the detected file types and press “Analyze attendance”.`
              : 'Upload a WhatsApp chat export (chat.md) together with the attendance files (attendence.csv, attendence11.csv.txt). Everything is parsed locally in your browser.'
          }
          action={
            <Button onClick={() => navigate('/upload')}>
              <Upload /> Go to Upload Files
            </Button>
          }
        />
      </>
    );
  }

  const summary = result.summary;
  const warnings = result.warnings.slice(0, 6);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${result.settings.schoolName} — audit of ${formatDisplayDate(
          result.coverage.firstDate,
        )} to ${formatDisplayDate(result.coverage.lastDate)} (${result.coverage.workingDates.length} working days).`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/reports')}>
              <FileSpreadsheet /> Open reports
            </Button>
            <Button onClick={() => navigate('/upload')}>
              <Upload /> Upload more files
            </Button>
          </>
        }
      />

      {warnings.length > 0 ? (
        <Alert tone="warning" title="Parsing notes from the uploaded files" className="mb-5">
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total staff"
          value={summary.totalStaff}
          hint={`${summary.employeesInAttendance} in attendance files · ${summary.employeesInWhatsapp} in the chat`}
          icon={<Users className="size-4" />}
          onClick={() => navigate('/employees')}
        />
        <StatCard
          label="Working days"
          value={summary.workingDays}
          hint="After applying the configured weekend/holiday rules"
          icon={<CalendarClock className="size-4" />}
          onClick={() => navigate('/settings')}
        />
        <StatCard
          label="Late events"
          value={summary.totalLateEvents}
          hint={`${summary.unnotifiedLateArrivals} without a notification`}
          tone="warning"
          icon={<Clock className="size-4" />}
          onClick={() => navigate('/audit?quick=late')}
        />
        <StatCard
          label="Absence events"
          value={summary.totalAbsenceEvents}
          hint={`${summary.unnotifiedAbsences} without a notification`}
          tone="danger"
          icon={<CalendarX className="size-4" />}
          onClick={() => navigate('/audit?quick=absent')}
        />
        <StatCard
          label="Sick events"
          value={summary.totalSickEvents}
          hint="Reported on WhatsApp and/or marked in the attendance file"
          tone="info"
          icon={<Hospital className="size-4" />}
          onClick={() => navigate('/audit?quick=sick')}
        />
        <StatCard
          label="Early departures"
          value={summary.totalEarlyDepartures}
          hint={`Threshold ${result.settings.earlyLeaveThreshold}${result.settings.earlyLeaveEnabled ? '' : ' (disabled)'}`}
          tone="warning"
          icon={<LogOut className="size-4" />}
          onClick={() => navigate('/audit?quick=leftEarly')}
        />
        <StatCard
          label="WhatsApp notifications"
          value={summary.whatsappNotifications}
          hint={`${summary.staffMessages} staff messages of ${summary.totalMessages}`}
          tone="primary"
          icon={<BellRing className="size-4" />}
          onClick={() => navigate('/whatsapp')}
        />
        <StatCard
          label="Unnotified late arrivals"
          value={summary.unnotifiedLateArrivals}
          hint="Biometric lateness with no matching message"
          tone="danger"
          icon={<UserX className="size-4" />}
          onClick={() => navigate('/unnotified')}
        />
        <StatCard
          label="Unnotified absences"
          value={summary.unnotifiedAbsences}
          hint="Biometric absence with no matching message"
          tone="danger"
          icon={<UserX className="size-4" />}
          onClick={() => navigate('/unnotified')}
        />
        <StatCard
          label="Conflicting records"
          value={summary.conflictingRecords}
          hint="WhatsApp and biometric disagree"
          tone="danger"
          icon={<ShieldAlert className="size-4" />}
          onClick={() => navigate('/discrepancies')}
        />
        <StatCard
          label="Unmatched / possible names"
          value={summary.unmatchedNames}
          hint="Needs a decision in the Review Center"
          tone="warning"
          icon={<AlertTriangle className="size-4" />}
          onClick={() => navigate('/review')}
        />
        <StatCard
          label="Audited rows"
          value={summary.auditRecords}
          hint={`${result.validation.totals.punches} punches · ${result.reviewIssues.length} review item(s)`}
          icon={<FileSpreadsheet className="size-4" />}
          onClick={() => navigate('/audit')}
        />
      </section>

      <section className="mt-5 grid gap-4 xl:grid-cols-2">
        <EmployeeBarChart
          title="Late arrivals by employee"
          description="Number of days each employee arrived after the configured cut-off."
          data={summary.lateByEmployee.map((entry) => ({ name: entry.name, count: entry.count }))}
          color="#d97706"
        />
        <EmployeeBarChart
          title="Absence days by employee"
          description="Days with no valid punch in the attendance files."
          data={summary.absenceByEmployee.map((entry) => ({ name: entry.name, count: entry.count }))}
          color="#dc2626"
        />
        <NotificationsByDateChart data={summary.notificationsByDate} />
        <NotifiedVsUnnotifiedChart data={summary.unnotifiedByDate} />
        <AttendanceTrendChart data={summary.attendanceTrend} />
        <DiscrepancyPieChart data={summary.matchStatusCounts} />
        <MessageClassificationChart
          staff={summary.staffMessages}
          student={summary.studentMessages}
          uncertain={summary.uncertainMessages}
        />
        <EmployeeBarChart
          title="Early departures by employee"
          description={`Leaving before ${result.settings.earlyLeaveThreshold} where the machine recorded a last punch.`}
          data={summary.earlyByEmployee.map((entry) => ({ name: entry.name, count: entry.count }))}
          color="#7c3aed"
        />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cross-reference verdicts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {result.summary.matchStatusCounts.map((entry) => {
                const meta = matchStatusMeta(entry.code);
                return (
                  <li key={entry.code} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      {meta.index !== null ? (
                        <Badge tone="outline">#{meta.index}</Badge>
                      ) : (
                        <Badge tone="neutral">extra</Badge>
                      )}
                      <span>{entry.label}</span>
                    </span>
                    <span className="font-medium tabular-nums">{entry.count}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Files used for this analysis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {result.files.map((file) => (
              <div key={file.file.id} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{file.file.name}</span>
                  <Badge tone={file.kind === 'whatsapp' ? 'info' : file.kind === 'attendance' ? 'primary' : 'warning'}>
                    {file.kind === 'whatsapp'
                      ? 'WhatsApp export'
                      : file.kind === 'attendance'
                        ? 'Attendance file'
                        : 'Unrecognised'}
                  </Badge>
                </div>
                <p className="mt-1 text-[var(--muted-foreground)]">{file.summary}</p>
                {file.whatsapp ? (
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    Senders: {file.whatsapp.senders.join(', ') || '—'} · dates read as{' '}
                    {file.whatsapp.detectedDateOrder === 'MDY' ? 'month/day/year' : 'day/month/year'}
                  </p>
                ) : null}
              </div>
            ))}
            <p className="text-xs text-[var(--muted-foreground)]">
              Analysis completed {new Date(result.createdAt).toLocaleString()} in {result.durationMs} ms. Confidence
              is derived from the name-match score and the completeness of the attendance record.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate('/upload')}>
              Manage uploaded files
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5">
        <Card>
          <CardHeader>
            <CardTitle>Where to look next</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-3">
            <Link to="/unnotified" className="rounded-lg border border-[var(--border)] p-3 hover:bg-[var(--accent)]">
              <p className="font-medium">Potential unnotified issues</p>
              <p className="text-[var(--muted-foreground)]">
                {summary.unnotifiedLateArrivals} late arrival(s) and {summary.unnotifiedAbsences} absence(s) without a
                WhatsApp notification.
              </p>
            </Link>
            <Link to="/discrepancies" className="rounded-lg border border-[var(--border)] p-3 hover:bg-[var(--accent)]">
              <p className="font-medium">Discrepancies</p>
              <p className="text-[var(--muted-foreground)]">
                {summary.conflictingRecords} record(s) where the two systems disagree — including messages that the
                biometric record does not confirm.
              </p>
            </Link>
            <Link to="/review" className="rounded-lg border border-[var(--border)] p-3 hover:bg-[var(--accent)]">
              <p className="font-medium">Review Center</p>
              <p className="text-[var(--muted-foreground)]">
                {result.reviewIssues.length} item(s) need a decision (name mappings, uncertain classifications,
                parsing problems).
              </p>
            </Link>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
