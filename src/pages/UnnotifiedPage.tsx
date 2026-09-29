import { BellOff, Clock, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/AppShell';
import { DatasetTable } from '@/components/DatasetTable';
import { ExportButtons } from '@/components/ExportButtons';
import { Alert, Card, CardContent, StatCard } from '@/components/ui';
import { buildDataset } from '@/lib/reports';
import { useStore } from '@/lib/store';

export function UnnotifiedPage() {
  const { result, searchQuery } = useStore();

  if (!result) {
    return (
      <>
        <PageHeader
          title="Potential unnotified issues"
          description="Biometric lateness or absence with no matching WhatsApp notification."
        />
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

  const late = buildDataset('unnotified-late', result);
  const absence = buildDataset('unnotified-absence', result);

  return (
    <>
      <PageHeader
        title="Potential unnotified issues"
        description="These lists are a starting point for a conversation, not a verdict: a notification may exist outside the WhatsApp export, and a missing punch can also be a machine or export problem."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Unnotified late arrivals"
          value={result.summary.unnotifiedLateArrivals}
          hint="Late per the biometric record, with no matching message on that day"
          tone="warning"
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="Unnotified absences"
          value={result.summary.unnotifiedAbsences}
          hint="No valid punch and no message for that employee that day"
          tone="danger"
          icon={<UserX className="size-4" />}
        />
        <StatCard
          label="Rows in this report"
          value={late.rows.length + absence.rows.length}
          hint="Every row carries its evidence"
          icon={<BellOff className="size-4" />}
        />
        <StatCard
          label="Employees affected"
          value={
            new Set(
              [...late.rows, ...absence.rows].map((row) => String(row[3] ?? '')).filter((name) => name !== ''),
            ).size
          }
          hint="Distinct names across both lists"
        />
      </div>

      <Alert tone="warning" title="How to read this page" className="mb-5">
        <ul className="list-disc space-y-1 pl-5">
          <li>“Unnotified” means: nothing in the uploaded WhatsApp export mentions this employee for that date.</li>
          <li>
            A day with no readable punch is only reported as unnotified <em>absence</em> when the attendance file
            clearly marks it as absent or provides a complete record for that day — parsing problems are flagged
            separately and never turned into an absence.
          </li>
          <li>Talk to the employee or check another channel before treating a row as a disciplinary finding.</li>
        </ul>
      </Alert>

      <div className="space-y-5">
        <section>
          <Card className="mb-3 p-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-0">
              <div>
                <h2 className="text-base font-semibold">Potential unnotified late arrivals</h2>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Late per the configured cut-off, with no message for that person on that date.
                </p>
              </div>
              <ExportButtons
                dataset={late}
                baseName="mbk-unnotified-lateness"
                result={result}
                summaryLines={[`Unnotified late arrivals: ${late.rows.length}`]}
              />
            </CardContent>
          </Card>
          <DatasetTable dataset={late} externalSearch={searchQuery} showHeader={false} />
        </section>

        <section>
          <Card className="mb-3 p-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-0">
              <div>
                <h2 className="text-base font-semibold">Potential unnotified absences</h2>
                <p className="text-sm text-[var(--muted-foreground)]">
                  No valid punch on a working day and no message for that person on that date.
                </p>
              </div>
              <ExportButtons
                dataset={absence}
                baseName="mbk-unnotified-absences"
                result={result}
                summaryLines={[`Unnotified absences: ${absence.rows.length}`]}
              />
            </CardContent>
          </Card>
          <DatasetTable dataset={absence} externalSearch={searchQuery} showHeader={false} />
        </section>
      </div>
    </>
  );
}
