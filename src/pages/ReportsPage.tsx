import { BarChart3, BookOpen, FileSpreadsheet, Printer, ShieldCheck } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/AppShell';
import { DatasetTable } from '@/components/DatasetTable';
import { ExportButtons } from '@/components/ExportButtons';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR, Tabs } from '@/components/ui';
import { downloadPdf, buildDataset, buildExecutiveSummary, REPORTS, type Dataset, type ReportId } from '@/lib/reports';
import { useStore } from '@/lib/store';
import { formatDisplayDate } from '@/lib/dates';

const GROUP_LABELS: Record<'attendance' | 'whatsapp' | 'review', string> = {
  attendance: 'Attendance',
  whatsapp: 'WhatsApp',
  review: 'Review & discrepancies',
};

export function ReportsPage() {
  const { result } = useStore();
  const [report, setReport] = React.useState<ReportId>('full-audit');
  const [busy, setBusy] = React.useState<string | null>(null);

  if (!result) {
    return (
      <>
        <PageHeader
          title="Reports"
          description="Nine reports for the school administration, exportable to Excel, CSV, PDF and JSON."
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

  const dataset = buildDataset(report, result);
  const summary = buildExecutiveSummary(result);
  const meta = REPORTS.find((entry) => entry.id === report)!;

  const summaryDataset: Dataset = {
    title: 'Executive summary',
    description: `${result.settings.schoolName} — staff attendance audit, ${formatDisplayDate(
      result.coverage.firstDate,
    )} to ${formatDisplayDate(result.coverage.lastDate)}.`,
    filters: `${result.coverage.workingDates.length} working days · ${result.auditRecords.length} audited rows`,
    columns: ['Section', 'Detail'],
    rows: summary.flatMap((section) => section.lines.map((line) => [section.title, line])),
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Every report is generated locally from the audited data. Period: ${formatDisplayDate(
          result.coverage.firstDate,
        )} – ${formatDisplayDate(result.coverage.lastDate)} · ${result.coverage.workingDates.length} working days.`}
        actions={
          <Button
            disabled={busy !== null}
            onClick={async () => {
              setBusy('executive');
              try {
                await downloadPdf(summaryDataset, 'mbk-executive-summary', result);
              } finally {
                setBusy(null);
              }
            }}
          >
            <BookOpen /> {busy === 'executive' ? 'Preparing…' : 'Download executive summary (PDF)'}
          </Button>
        }
      />

      <Alert tone="info" title="Nothing in these reports is recalculated" className="mb-5">
        <p>
          Each file is a projection of the audited rows — the same numbers you see on screen. The PDF header records the
          filters and the source files so a printed report can always be traced back to the uploads.
        </p>
      </Alert>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Executive summary</CardTitle>
          <CardDescription>
            The narrative report for the school administration — {summary.length} section(s), generated from the data
            above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">
              <ShieldCheck className="size-3.5" /> {summaryDataset.rows.length} statement(s)
            </Badge>
            <ExportButtons
              dataset={summaryDataset}
              baseName="mbk-executive-summary"
              result={result}
              summaryLines={summary.slice(0, 3).map((section) => `${section.title}: ${section.lines.length} line(s)`)}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {summary.map((section) => (
              <Card key={section.id} className="p-4">
                <h3 className="text-sm font-semibold">{section.title}</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
                  {section.lines.slice(0, 8).map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                  {section.lines.length > 8 ? <li>…and {section.lines.length - 8} more</li> : null}
                </ul>
                {section.table ? (
                  <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)]">
                    <Table>
                      <THead>
                        <TR>
                          {section.table.columns.map((column) => (
                            <TH key={column}>{column}</TH>
                          ))}
                        </TR>
                      </THead>
                      <TBody>
                        {section.table.rows.slice(0, 6).map((row, index) => (
                          <TR key={index}>
                            {row.map((cell, cellIndex) => (
                              <TD key={cellIndex} className="text-xs">
                                {String(cell)}
                              </TD>
                            ))}
                          </TR>
                        ))}
                        {section.table.rows.length > 6 ? (
                          <TR>
                            <TD colSpan={section.table.columns.length} className="text-xs text-[var(--muted-foreground)]">
                              …{section.table.rows.length - 6} more row(s) — download for the full table
                            </TD>
                          </TR>
                        ) : null}
                      </TBody>
                    </Table>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Report library</CardTitle>
          <CardDescription>
            {REPORTS.length} reports. Choose one to preview exactly what the exported file will contain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs<ReportId>
            value={report}
            onChange={setReport}
            tabs={REPORTS.map((entry) => ({
              value: entry.id,
              label: entry.title,
              count: buildDataset(entry.id, result).rows.length,
            }))}
          />
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border)] p-4">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <BarChart3 className="size-4" />
                <span className="font-medium">{meta.title}</span>
                <Badge tone="outline">{GROUP_LABELS[meta.group]}</Badge>
                <Badge tone={dataset.rows.length > 0 ? 'primary' : 'warning'}>{dataset.rows.length} row(s)</Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{dataset.description}</p>
            </div>
            <ExportButtons dataset={dataset} baseName={`mbk-${meta.id}`} result={result} />
          </div>
          <DatasetTable dataset={dataset} showHeader={false} pageSize={15} />
        </CardContent>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <FileSpreadsheet className="size-4" /> What each export contains
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
          <li>
            <span className="font-medium text-[var(--foreground)]">Excel (.xlsx)</span> — two sheets: “Report info”
            (title, description, generation time, row count, filters) and “Data” with the full table and sized columns.
          </li>
          <li>
            <span className="font-medium text-[var(--foreground)]">CSV</span> — UTF-8 with the title, description and
            filters as a header block followed by the table; opens cleanly in Excel and Google Sheets.
          </li>
          <li>
            <span className="font-medium text-[var(--foreground)]">PDF</span> — A4 landscape with the school name, the
            applied filters, the source files, page numbers and a confidentiality footer. Built for printing and for
            filing with the school administration.
          </li>
          <li>
            <span className="font-medium text-[var(--foreground)]">JSON</span> — the same rows with the analysis id,
            settings and filters, for archiving or further processing.
          </li>
        </ul>
        <p className="mt-3 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <Printer className="size-3.5" /> Tip: PDF export renders the current filter so you can print a single
          employee or a single week without editing the file afterwards.
        </p>
      </Card>
    </>
  );
}
