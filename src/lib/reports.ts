/**
 * Report generator and exporters.
 *
 * Nine reports are produced from the analysis result. Nothing is recomputed
 * here: each report is a projection of the audited rows, so an exported file can
 * always be traced back to the evidence shown in the UI.
 */

import * as XLSX from 'xlsx';
import { formatDisplayDate, formatShortDate, weekdayShort } from '@/lib/dates';
import { formatDuration, minutesToClock } from '@/lib/time';
import { BIOMETRIC_STATUS_SHORT, EVENT_LABELS, matchStatusMeta } from '@/lib/statuses';
import type { AnalysisResult, AuditRecord, EmployeeSummary } from '@/lib/types';

export interface Dataset {
  columns: string[];
  rows: (string | number)[][];
  title: string;
  description: string;
  /** applied filters, printed in the PDF header */
  filters?: string;
}

export type ReportId =
  | 'full-audit'
  | 'employee-summary'
  | 'late'
  | 'absence'
  | 'whatsapp'
  | 'unnotified-late'
  | 'unnotified-absence'
  | 'discrepancies'
  | 'name-matching';

export interface ReportMeta {
  id: ReportId;
  title: string;
  description: string;
  group: 'attendance' | 'whatsapp' | 'review';
}

export const REPORTS: ReportMeta[] = [
  {
    id: 'full-audit',
    title: 'Full attendance audit',
    description:
      'Every audited employee/day with the biometric punches, the WhatsApp notification and the cross-reference verdict.',
    group: 'attendance',
  },
  {
    id: 'employee-summary',
    title: 'Employee summary',
    description:
      'Per-employee totals: presence, lateness, absence, sickness, early departure and unnotified issues.',
    group: 'attendance',
  },
  {
    id: 'late',
    title: 'Late report',
    description: 'Every late arrival with the minutes late, the notification status and the rule that applied.',
    group: 'attendance',
  },
  {
    id: 'absence',
    title: 'Absence report',
    description: 'Every absent day with the evidence that led to the verdict and whether it was reported.',
    group: 'attendance',
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp notification report',
    description: 'Every staff notification with sender, event, original wording and how it matched attendance.',
    group: 'whatsapp',
  },
  {
    id: 'unnotified-late',
    title: 'Unnotified lateness report',
    description: 'Late arrivals with no matching WhatsApp notification (potential unnotified attendance issues).',
    group: 'review',
  },
  {
    id: 'unnotified-absence',
    title: 'Unnotified absence report',
    description: 'Absences with no matching WhatsApp notification.',
    group: 'review',
  },
  {
    id: 'discrepancies',
    title: 'Discrepancy report',
    description:
      'Conflicts between the biometric machine and the WhatsApp group (claims not confirmed, absences reported while present, …).',
    group: 'review',
  },
  {
    id: 'name-matching',
    title: 'Name matching report',
    description: 'Every WhatsApp name with its matched employee, confidence score and the alternatives considered.',
    group: 'review',
  },
];

function auditRow(record: AuditRecord): (string | number)[] {
  const meta = matchStatusMeta(record.matchStatus);
  return [
    record.date,
    weekdayShort(record.date),
    record.employeeCode ?? '',
    record.employeeName,
    record.department ?? '',
    record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : 'No punch',
    record.biometric.lastPunch !== null ? minutesToClock(record.biometric.lastPunch) : '—',
    record.biometric.punchCount,
    BIOMETRIC_STATUS_SHORT[record.biometric.status],
    record.whatsapp.statusLabel,
    record.whatsapp.senders.join(' / '),
    record.whatsapp.times[0] ?? '',
    record.whatsapp.originalMessages.join(' | '),
    record.whatsapp.hasNotification ? (meta.isUnnotified ? 'Not notified' : 'Notified') : 'No notification',
    meta.label,
    record.confidence === 'high' ? 'High' : record.confidence === 'medium' ? 'Medium' : 'Low',
    [...record.biometric.caveats, ...record.whatsapp.reasons].join(' '),
  ];
}

const AUDIT_COLUMNS = [
  'Date',
  'Day',
  'Employee ID',
  'Employee Name',
  'Department',
  'First punch',
  'Last punch',
  'Punch count',
  'Attendance status',
  'WhatsApp status',
  'WhatsApp sender',
  'WhatsApp time',
  'WhatsApp message',
  'Notification',
  'Match status',
  'Confidence',
  'Notes',
];

export function buildDataset(
  report: ReportId,
  result: AnalysisResult,
  records: AuditRecord[] = result.auditRecords,
): Dataset {
  const school = result.settings.schoolName || 'MBK School';

  switch (report) {
    case 'full-audit':
      return {
        title: 'Full attendance audit',
        description: `${school} — biometric attendance cross-referenced with WhatsApp notifications.`,
        columns: AUDIT_COLUMNS,
        rows: records.map(auditRow),
      };

    case 'employee-summary':
      return {
        title: 'Employee summary',
        description: `${school} — attendance totals per employee for the audited period.`,
        columns: [
          'Employee ID',
          'Employee Name',
          'Department',
          'Present days',
          'On-time days',
          'Late days',
          'Absent days',
          'Sick days',
          'Left early days',
          'Unnotified late days',
          'Unnotified absence days',
          'WhatsApp notifications',
          'Conflicts',
          'Attendance rate %',
          'WhatsApp names',
        ],
        rows: result.employeeSummaries.map((employee) => [
          employee.employeeCode ?? '',
          employee.name,
          employee.department ?? '',
          employee.presentDays,
          employee.onTimeDays,
          employee.lateDays,
          employee.absentDays,
          employee.sickDays,
          employee.leftEarlyDays,
          employee.unnotifiedLateDays,
          employee.unnotifiedAbsenceDays,
          employee.whatsappNotificationCount,
          employee.conflictDays,
          employee.attendanceRate ?? '',
          employee.whatsappNames.join(' | '),
        ]),
      };

    case 'late':
      return {
        title: 'Late report',
        description: `${school} — every late arrival found in the biometric attendance files.`,
        columns: [
          'Date',
          'Day',
          'Employee ID',
          'Employee Name',
          'Department',
          'First punch',
          'Late by',
          'Rule',
          'WhatsApp status',
          'WhatsApp message',
          'Notification',
          'Match status',
        ],
        rows: records
          .filter((record) => record.biometric.isLate === true)
          .map((record) => [
            record.date,
            weekdayShort(record.date),
            record.employeeCode ?? '',
            record.employeeName,
            record.department ?? '',
            record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : '',
            record.biometric.lateByMinutes !== null ? formatDuration(record.biometric.lateByMinutes) : '',
            record.biometric.lateCutoffLabel,
            record.whatsapp.statusLabel,
            record.whatsapp.originalMessages.join(' | '),
            record.whatsapp.hasNotification ? 'Notified' : 'Not notified',
            matchStatusMeta(record.matchStatus).label,
          ]),
      };

    case 'absence':
      return {
        title: 'Absence report',
        description: `${school} — days with no valid punch (or an absence marker in the attendance file).`,
        columns: [
          'Date',
          'Day',
          'Employee ID',
          'Employee Name',
          'Department',
          'Attendance evidence',
          'Reason recorded',
          'WhatsApp status',
          'WhatsApp message',
          'Notification',
          'Match status',
        ],
        rows: records
          .filter((record) => record.biometric.isAbsent === true)
          .map((record) => [
            record.date,
            weekdayShort(record.date),
            record.employeeCode ?? '',
            record.employeeName,
            record.department ?? '',
            record.biometric.hasRecord
              ? `Row present, cell: ${
                  record.biometric.evidence.find((item) => item.kind === 'attendance')?.raw ?? '—'
                }`
              : 'No row found in the attendance files',
            record.biometric.absentReason,
            record.whatsapp.statusLabel,
            record.whatsapp.originalMessages.join(' | '),
            record.whatsapp.hasNotification ? 'Notified' : 'Not notified',
            matchStatusMeta(record.matchStatus).label,
          ]),
      };

    case 'whatsapp':
      return {
        title: 'WhatsApp notification report',
        description: `${school} — every staff-related message in the chat export with its classification and match.`,
        columns: [
          'Date',
          'Time',
          'Sender',
          'Employee (WhatsApp name)',
          'Matched employee',
          'Event',
          'Original message',
          'Classification',
          'Classification reason',
          'Name confidence',
          'Match to attendance',
          'Biometric result',
        ],
        rows: result.whatsappEvents.map((event) => [
          event.date ?? '',
          event.timeText ?? '',
          event.sender ?? '',
          event.subjectText,
          event.employeeName ?? 'Not matched',
          EVENT_LABELS[event.event],
          event.originalMessage.replace(/\s+/g, ' '),
          event.audience === 'staff' ? 'Staff' : event.audience === 'student' ? 'Student' : 'Uncertain',
          event.classificationReason,
          event.nameConfidence,
          matchStatusMeta(event.matchStatus).label,
          event.biometricSummary,
        ]),
      };

    case 'unnotified-late':
      return {
        title: 'Unnotified lateness report',
        description: `${school} — late arrivals for which no WhatsApp notification could be found.`,
        columns: [
          'Date',
          'Day',
          'Employee ID',
          'Employee Name',
          'Department',
          'First Punch',
          'Late Cutoff',
          'Late Minutes',
          'WhatsApp Notification',
          'Reason',
          'Evidence',
        ],
        rows: unnotified(records, (record) => record.biometric.isLate === true).map((record) => [
          record.date,
          weekdayShort(record.date),
          record.employeeCode ?? record.employeeId,
          record.employeeName,
          record.department ?? '',
          record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : '—',
          record.biometric.lateCutoffMinutes !== null ? minutesToClock(record.biometric.lateCutoffMinutes) : '—',
          record.biometric.lateByMinutes !== null ? formatDuration(record.biometric.lateByMinutes) : '—',
          record.whatsapp.hasNotification ? 'Notified' : 'None found',
          record.biometric.lateCutoffLabel,
          record.evidence.map((e) => e.detail).join(' • ') || `${record.biometric.lateCutoffLabel}. ${record.biometric.caveats.join(' ')}`.trim(),
        ]),
      };

    case 'unnotified-absence':
      return {
        title: 'Unnotified absence report',
        description: `${school} — absences for which no WhatsApp notification could be found.`,
        columns: [
          'Date',
          'Day',
          'Employee ID',
          'Employee Name',
          'Department',
          'First Punch',
          'Attendance Status',
          'WhatsApp Notification',
          'Exception',
          'Evidence',
        ],
        rows: unnotified(records, (record) => record.biometric.status === 'ABSENT').map((record) => [
          record.date,
          weekdayShort(record.date),
          record.employeeCode ?? record.employeeId,
          record.employeeName,
          record.department ?? '',
          record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : '—',
          record.biometric.statusLabel,
          record.whatsapp.hasNotification ? 'Notified' : 'None found',
          record.biometric.hasRecord ? 'Cell without readable punch' : 'No biometric record found',
          record.biometric.absentReason || record.evidence.map((e) => e.detail).join(' • ') || 'No punch on working day',
        ]),
      };

    case 'discrepancies':
      return {
        title: 'Discrepancy report',
        description: `${school} — records where the biometric machine and the WhatsApp group do not agree.`,
        columns: [
          'Date',
          'Employee',
          'Department',
          'Discrepancy',
          'WhatsApp says',
          'Biometric says',
          'WhatsApp message',
          'Evidence',
        ],
        rows: records
          .filter((record) => matchStatusMeta(record.matchStatus).isConflict)
          .map((record) => [
            record.date,
            record.employeeName,
            record.department ?? '',
            matchStatusMeta(record.matchStatus).label,
            record.whatsapp.statusLabel,
            record.biometric.statusLabel,
            record.whatsapp.originalMessages.join(' | '),
            record.biometric.evidence
              .filter((item) => item.kind === 'attendance' || item.kind === 'calculation')
              .map((item) => item.detail)
              .join(' '),
          ]),
      };

    case 'name-matching':
      return {
        title: 'Name matching report',
        description: `${school} — how each WhatsApp name was matched to an attendance employee.`,
        columns: [
          'WhatsApp name',
          'Occurrences',
          'Matched employee',
          'Employee ID',
          'Department',
          'Confidence %',
          'Status',
          'Method',
          'Alternatives',
          'Reasoning',
        ],
        rows: result.nameMatches.map((match) => [
          match.whatsappName,
          match.occurrences,
          match.employeeName ?? '',
          match.employeeCode ?? '',
          match.department ?? '',
          match.confidence,
          match.tier === 'matched'
            ? 'Matched'
            : match.tier === 'manual'
              ? 'Matched (manual)'
              : match.tier === 'possible'
                ? 'Possible match'
                : match.tier === 'rejected'
                  ? 'Rejected'
                  : 'Unmatched',
          match.method,
          match.alternatives.map((alt) => `${alt.employeeName} (${alt.confidence}%)`).join('; '),
          match.reasons.join(' '),
        ]),
      };

    default:
      return { title: 'Report', description: '', columns: [], rows: [] };
  }
}

function unnotified(
  records: AuditRecord[],
  predicate: (record: AuditRecord) => boolean,
): AuditRecord[] {
  return records.filter((record) => {
    if (record.whatsappOnly) return false;
    if (!predicate(record)) return false;
    return !record.whatsapp.hasNotification || matchStatusMeta(record.matchStatus).isUnnotified;
  });
}

/* ------------------------------------------------------------------ *
 * Serialisers
 * ------------------------------------------------------------------ */

export function toCsv(dataset: Dataset): string {
  const escape = (cell: unknown): string => {
    const text = cell === null || cell === undefined ? '' : String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    escape(dataset.title),
    escape(dataset.description),
    dataset.filters ? escape(`Filters: ${dataset.filters}`) : '',
    '',
    dataset.columns.map(escape).join(','),
    ...dataset.rows.map((row) => row.map(escape).join(',')),
  ].join('\n');
}

export function download(filename: string, content: string | Blob, mime = 'text/plain'): void {
  const blob =
    typeof content === 'string' ? new Blob([content], { type: `${mime};charset=utf-8` }) : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadCsv(dataset: Dataset, baseName: string): void {
  download(`${baseName}.csv`, toCsv(dataset), 'text/csv');
}

export function downloadJson(dataset: Dataset, baseName: string, result: AnalysisResult): void {
  const payload = {
    report: dataset.title,
    description: dataset.description,
    generatedAt: new Date().toISOString(),
    filters: dataset.filters ?? null,
    analysisId: result.id,
    settings: result.settings,
    rows: dataset.rows.map((row) =>
      Object.fromEntries(dataset.columns.map((column, index) => [column, row[index] ?? ''])),
    ),
  };
  download(`${baseName}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

export function downloadExcel(dataset: Dataset, baseName: string): void {
  const sheet = XLSX.utils.aoa_to_sheet([dataset.columns, ...dataset.rows]);
  sheet['!cols'] = dataset.columns.map((column, index) => {
    const longest = Math.max(
      column.length,
      ...dataset.rows.slice(0, 200).map((row) => String(row[index] ?? '').length),
    );
    return { wch: Math.min(60, Math.max(12, longest + 2)) };
  });
  const infoRows: string[][] = [
    [dataset.title],
    [dataset.description],
    [`Generated: ${new Date().toLocaleString()}`],
    [`Rows: ${dataset.rows.length}`],
  ];
  if (dataset.filters) infoRows.push([`Filters: ${dataset.filters}`]);
  const info = XLSX.utils.aoa_to_sheet(infoRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, info, 'Report info');
  XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
  XLSX.writeFile(workbook, `${baseName}.xlsx`);
}

/**
 * Professional PDF layout: A4 landscape with a header block, a summary of the
 * applied filters, the table and page numbers.
 */
export async function downloadPdf(
  dataset: Dataset,
  baseName: string,
  result: AnalysisResult,
  options: { summaryLines?: string[] } = {},
): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = (autoTableModule.default ?? autoTableModule) as unknown as (
    doc: unknown,
    options: Record<string, unknown>,
  ) => void;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 32;

  doc.setFillColor(28, 40, 92);
  doc.rect(0, 0, pageWidth, 58, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(result.settings.schoolName || 'MBK School', margin, 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(dataset.title, margin, 43);
  doc.text(`Generated ${new Date().toLocaleString()}`, pageWidth - margin, 43, { align: 'right' });

  let cursor = 78;
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(9.5);
  const description = doc.splitTextToSize(dataset.description, pageWidth - margin * 2) as string[];
  doc.text(description, margin, cursor);
  cursor += description.length * 12 + 4;

  const lines = [
    dataset.filters ? `Filters: ${dataset.filters}` : 'Filters: none',
    `Rows: ${dataset.rows.length}`,
    `Source files: ${result.files.map((file) => file.file.name).join(', ') || '—'}`,
    `Audited period: ${formatDisplayDate(result.coverage.firstDate)} – ${formatDisplayDate(
      result.coverage.lastDate,
    )}`,
    ...(options.summaryLines ?? []),
  ];
  doc.setTextColor(90, 90, 90);
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, pageWidth - margin * 2) as string[];
    doc.text(wrapped, margin, cursor);
    cursor += wrapped.length * 11;
  }
  cursor += 6;
  if (cursor > pageHeight - 130) cursor = 78;

  autoTable(doc, {
    head: [dataset.columns],
    body: dataset.rows.map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
    ),
    startY: cursor,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', textColor: [30, 30, 30] },
    headStyles: {
      fillColor: [28, 40, 92],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    alternateRowStyles: { fillColor: [245, 246, 250] },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(
        `${dataset.title} — MBK Attendance Audit — confidential (staff attendance and WhatsApp data)`,
        margin,
        pageHeight - 16,
      );
    },
  });

  const pages = doc.getNumberOfPages();
  for (let index = 1; index <= pages; index += 1) {
    doc.setPage(index);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Page ${index} of ${pages}`, pageWidth - margin, pageHeight - 16, { align: 'right' });
  }

  doc.save(`${baseName}.pdf`);
}

/* ------------------------------------------------------------------ *
 * Executive summary (the A–N sections of the final analysis report)
 * ------------------------------------------------------------------ */

export interface SummarySection {
  id: string;
  title: string;
  lines: string[];
  table?: { columns: string[]; rows: (string | number)[][] };
}

export function buildExecutiveSummary(result: AnalysisResult): SummarySection[] {
  const summary = result.summary;
  const short = (record: AuditRecord) =>
    `${formatShortDate(record.date)} ${record.employeeName} — ${record.biometric.statusLabel}${
      record.biometric.firstPunch !== null
        ? ` (first punch ${minutesToClock(record.biometric.firstPunch)})`
        : ''
    }`;

  const lateRecords = result.auditRecords.filter((record) => record.biometric.isLate === true);
  const absentRecords = result.auditRecords.filter((record) => record.biometric.status === 'ABSENT');
  const sickRecords = result.auditRecords.filter(
    (record) =>
      record.biometric.status === 'SICK_LEAVE' ||
      record.whatsapp.events.includes('SICK') ||
      record.whatsapp.events.includes('HOSPITAL'),
  );
  const earlyRecords = result.auditRecords.filter((record) => record.biometric.leftEarly === true);
  const unnotifiedLate = result.auditRecords.filter(
    (record) => record.biometric.isLate === true && matchStatusMeta(record.matchStatus).isUnnotified,
  );
  const unnotifiedAbsent = result.auditRecords.filter(
    (record) =>
      record.biometric.status === 'ABSENT' && matchStatusMeta(record.matchStatus).isUnnotified,
  );
  const conflicts = result.auditRecords.filter(
    (record) => matchStatusMeta(record.matchStatus).isConflict,
  );
  const unmatched = result.nameMatches.filter(
    (match) => match.tier === 'unmatched' || match.tier === 'possible',
  );

  const dailyBreakdown: (string | number)[][] = [];
  const byDate = new Map<string, AuditRecord[]>();
  for (const record of result.auditRecords) {
    const list = byDate.get(record.date) ?? [];
    list.push(record);
    byDate.set(record.date, list);
  }
  for (const date of [...byDate.keys()].sort()) {
    const dayRecords = byDate.get(date) ?? [];
    dailyBreakdown.push([
      date,
      weekdayShort(date),
      dayRecords.filter((record) => record.biometric.status === 'PRESENT').length,
      dayRecords.filter((record) => record.biometric.isLate === true).length,
      dayRecords.filter((record) => record.biometric.status === 'ABSENT').length,
      dayRecords.filter((record) => record.whatsapp.hasNotification).length,
      dayRecords.filter((record) => matchStatusMeta(record.matchStatus).isUnnotified).length,
      dayRecords.filter((record) => matchStatusMeta(record.matchStatus).isConflict).length,
    ]);
  }

  const employeeLine = (employee: EmployeeSummary) =>
    `${employee.name}${employee.department ? ` (${employee.department})` : ''}: ${employee.presentDays} present, ${employee.lateDays} late, ${employee.absentDays} absent, ${employee.sickDays} sick, ${employee.leftEarlyDays} left early, ${employee.unnotifiedLateDays} unnotified lateness, ${employee.whatsappNotificationCount} notifications.`;

  return [
    {
      id: 'A',
      title: 'A. Executive summary',
      lines: [
        `${result.files.length} file(s) analysed: ${result.files.map((file) => file.file.name).join(', ')}.`,
        `Audited period: ${formatDisplayDate(result.coverage.firstDate)} to ${formatDisplayDate(
          result.coverage.lastDate,
        )} (${result.coverage.workingDates.length} working days after applying the configured rules).`,
        `${summary.totalStaff} employee(s), ${summary.auditRecords} audited employee/day row(s).`,
        `${summary.totalLateEvents} late arrivals, ${summary.totalAbsenceEvents} absences, ${summary.totalSickEvents} sick days, ${summary.totalEarlyDepartures} early departures.`,
        `${summary.whatsappNotifications} WhatsApp notification(s) found; ${summary.unnotifiedLateArrivals} late arrival(s) and ${summary.unnotifiedAbsences} absence(s) had no notification.`,
        `${summary.conflictingRecords} record(s) conflict between the two systems and ${summary.unmatchedNames} WhatsApp name(s) need review.`,
      ],
    },
    {
      id: 'B',
      title: 'B. Attendance statistics',
      lines: [
        `Attendance records parsed: ${result.validation.totals.attendanceRecords}; punches read: ${result.validation.totals.punches}.`,
        `WhatsApp messages parsed: ${result.validation.totals.whatsappMessages} (${summary.staffMessages} staff, ${summary.studentMessages} student, ${summary.uncertainMessages} uncertain).`,
        `Employees matched between the two systems: ${summary.employeesMatched} of ${result.nameMatches.length} WhatsApp name(s).`,
        `Dates found: ${result.validation.totals.datesFound} (attendance ${result.coverage.attendanceFirstDate ?? '—'} to ${result.coverage.attendanceLastDate ?? '—'}, chat ${result.coverage.whatsappFirstDate ?? '—'} to ${result.coverage.whatsappLastDate ?? '—'}).`,
      ],
    },
    {
      id: 'C',
      title: 'C. Late staff',
      lines:
        lateRecords.length === 0
          ? ['No late arrival was found in the uploaded attendance files.']
          : [
              `${lateRecords.length} late arrival(s) across ${new Set(lateRecords.map((record) => record.employeeId)).size} employee(s).`,
              ...lateRecords.slice(0, 40).map(
                (record) =>
                  `${short(record)} — ${formatDuration(record.biometric.lateByMinutes ?? 0)} late; ${
                    record.whatsapp.hasNotification ? 'notified' : 'NOT notified'
                  }.`,
              ),
            ],
      table: {
        columns: ['Date', 'Employee', 'First punch', 'Late by', 'Notification', 'Match'],
        rows: lateRecords.map((record) => [
          record.date,
          record.employeeName,
          record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : '',
          formatDuration(record.biometric.lateByMinutes ?? 0),
          record.whatsapp.hasNotification ? 'Notified' : 'Not notified',
          matchStatusMeta(record.matchStatus).shortLabel,
        ]),
      },
    },
    {
      id: 'D',
      title: 'D. Absent staff',
      lines:
        absentRecords.length === 0
          ? ['No absence was identified from the attendance files.']
          : absentRecords
              .slice(0, 40)
              .map(
                (record) =>
                  `${short(record)} — ${record.biometric.absentReason} ${
                    record.whatsapp.hasNotification ? '(reported on WhatsApp)' : '(NOT reported)'
                  }`,
              ),
    },
    {
      id: 'E',
      title: 'E. Sick staff',
      lines:
        sickRecords.length === 0
          ? ['No sickness was reported or recorded.']
          : sickRecords
              .slice(0, 40)
              .map(
                (record) =>
                  `${short(record)} — WhatsApp: ${record.whatsapp.statusLabel}${
                    record.whatsapp.senders.length
                      ? ` (reported by ${record.whatsapp.senders.join(', ')})`
                      : ''
                  }`,
              ),
    },
    {
      id: 'F',
      title: 'F. Early departures',
      lines:
        earlyRecords.length === 0
          ? ['No early departure was detected with the configured threshold.']
          : earlyRecords.map(
              (record) =>
                `${short(record)} — left ${formatDuration(
                  record.biometric.leftEarlyByMinutes ?? 0,
                )} before ${result.settings.earlyLeaveThreshold}${
                  record.whatsapp.hasNotification ? ' (reported)' : ' (not reported)'
                }`,
            ),
    },
    {
      id: 'G',
      title: 'G. WhatsApp notifications',
      lines: [
        `${summary.whatsappNotifications} distinct notification message(s) were linked to staff.`,
        ...result.whatsappEvents
          .slice(0, 60)
          .map(
            (event) =>
              `${event.date ?? '?'} ${event.timeText ?? ''} — ${event.sender ?? 'unknown sender'}: "${event.originalMessage.replace(
                /\s+/g,
                ' ',
              )}" → ${EVENT_LABELS[event.event]} for ${
                event.employeeName ?? (event.subjectText || 'an unmatched name')
              }.`,
          ),
      ],
    },
    {
      id: 'H',
      title: 'H. Unnotified late arrivals',
      lines:
        unnotifiedLate.length === 0
          ? ['Every late arrival had a matching WhatsApp notification.']
          : unnotifiedLate.map(
              (record) =>
                `${short(record)} — late by ${formatDuration(
                  record.biometric.lateByMinutes ?? 0,
                )}; no notification found.`,
            ),
    },
    {
      id: 'I',
      title: 'I. Unnotified absences',
      lines:
        unnotifiedAbsent.length === 0
          ? ['Every absence had a matching WhatsApp notification.']
          : unnotifiedAbsent.map(
              (record) => `${short(record)} — ${record.biometric.absentReason}; no notification found.`,
            ),
    },
    {
      id: 'J',
      title: 'J. Conflicting records',
      lines:
        conflicts.length === 0
          ? ['No conflict was found between the biometric records and the WhatsApp reports.']
          : conflicts.map(
              (record) =>
                `${short(record)} — WhatsApp: ${record.whatsapp.statusLabel}; Biometric: ${
                  record.biometric.statusLabel
                }${
                  record.biometric.firstPunch !== null
                    ? ` at ${minutesToClock(record.biometric.firstPunch)}`
                    : ''
                }. ${matchStatusMeta(record.matchStatus).label}.`,
            ),
    },
    {
      id: 'K',
      title: 'K. Unmatched staff',
      lines:
        unmatched.length === 0
          ? ['Every WhatsApp name was matched confidently.']
          : unmatched.map(
              (match) =>
                `"${match.whatsappName}" (${match.occurrences} message(s)) — ${match.confidence}% confidence${
                  match.employeeName ? ` with "${match.employeeName}"` : ''
                }. ${match.reasons.slice(-2).join(' ')}`,
            ),
    },
    {
      id: 'L',
      title: 'L. Name matching issues',
      lines: result.nameMatches
        .filter((match) => match.occurrences > 0)
        .slice(0, 40)
        .map(
          (match) =>
            `${match.whatsappName} → ${match.employeeName ?? 'no match'} (${match.confidence}%, ${match.method})`,
        ),
    },
    {
      id: 'M',
      title: 'M. Daily breakdown',
      lines: ['Per-day totals; unnotified and conflicting counts are shown for each day.'],
      table: {
        columns: ['Date', 'Day', 'Present', 'Late', 'Absent', 'Notifications', 'Unnotified', 'Conflicts'],
        rows: dailyBreakdown,
      },
    },
    {
      id: 'N',
      title: 'N. Employee-by-employee breakdown',
      lines: result.employeeSummaries.map(employeeLine),
      table: {
        columns: [
          'Employee',
          'Department',
          'Present',
          'Late',
          'Absent',
          'Sick',
          'Left early',
          'Unnotified late',
          'Notifications',
        ],
        rows: result.employeeSummaries.map((employee) => [
          employee.name,
          employee.department ?? '',
          employee.presentDays,
          employee.lateDays,
          employee.absentDays,
          employee.sickDays,
          employee.leftEarlyDays,
          employee.unnotifiedLateDays,
          employee.whatsappNotificationCount,
        ]),
      },
    },
  ];
}
