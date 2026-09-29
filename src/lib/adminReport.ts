/**
 * MBK Attendance Administrative Report (specification item 36).
 *
 * One professional PDF containing, in order:
 *   1. Teacher Summary Table
 *   2. Itemized Absence and Late Log
 *   3. Unnotified Attendance
 *   4. Conflicting Records
 *   5. Pending Administrative Review
 *   6. Administrative Review Notes — only what an administrator typed.
 *
 * The document is built from the same audited rows the UI shows, so a printed
 * report can always be traced back through "View original evidence".
 */

import { formatDisplayDate, weekdayShort } from './dates';
import { minutesToClock } from './time';
import { matchStatusMeta } from './statuses';
import {
  ADMIN_EXCUSE_LABELS,
  type AdminLogRow,
  type AdminReviewEntry,
  type AdminTeacherStats,
  type AnalysisResult,
  type AuditRecord,
  type Settings,
} from './types';

export interface AdminReportOptions {
  /** description of the filters that were applied in the UI */
  filters?: string;
  /** administrative review notes typed by the administrator (never generated) */
  notes?: { date: string; employeeName: string; reviewer: string; note: string }[];
}

type Row = (string | number)[];

function teacherTable(stats: AdminTeacherStats[], codes: Map<string, string | null>): Row[] {
  return stats.map((teacher) => [
    teacher.employeeName,
    teacher.department ?? '—',
    codes.get(teacher.employeeId) ?? teacher.grade ?? '—',
    teacher.fullAbsencesExcused,
    teacher.fullAbsencesUnexcused,
    teacher.fullAbsencesPending,
    teacher.lateOccurrences,
    teacher.totalLateMinutes,
    teacher.attendanceRate === null ? 'n/a' : `${teacher.attendanceRate.toFixed(1)}%`,
    teacher.statusLabel,
  ]);
}

const TEACHER_COLUMNS = [
  'Teacher Name',
  'Department',
  'Grade',
  'Full Absences (Excused)',
  'Full Absences (Unexcused)',
  'Absences Pending Review',
  'Late Occurrences',
  'Total Late Time (Mins)',
  'Attendance Rate (%)',
  'Administrative Status',
];

function logTable(rows: AdminLogRow[]): Row[] {
  return rows.map((row) => [
    formatDisplayDate(row.date),
    row.employeeName,
    row.typeLabel,
    row.recordedTimeIn ?? 'N/A',
    row.reasonProvided,
    ADMIN_EXCUSE_LABELS[row.excuseStatus],
    `${row.documentation} / ${row.administrativeAction}`,
  ]);
}

const LOG_COLUMNS = [
  'Date',
  'Teacher Name',
  'Type',
  'Recorded Time In',
  'Reason Provided',
  'Status',
  'Documentation / Action Taken',
];

function unnotifiedTable(records: AuditRecord[]): Row[] {
  return records.map((record) => [
    formatDisplayDate(record.date),
    weekdayShort(record.date),
    record.employeeName,
    record.employeeCode ?? '',
    record.department ?? '',
    record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : 'No punch',
    record.biometric.statusLabel,
    matchStatusMeta(record.matchStatus).label,
  ]);
}

const UNNOTIFIED_COLUMNS = [
  'Date',
  'Day',
  'Teacher Name',
  'Employee ID',
  'Department',
  'First Punch',
  'Attendance Status',
  'Finding',
];

function conflictTable(records: AuditRecord[]): Row[] {
  return records.map((record) => [
    formatDisplayDate(record.date),
    record.employeeName,
    record.whatsapp.hasNotification ? record.whatsapp.statusLabel : 'No message',
    record.whatsapp.originalMessages.join(' | ').slice(0, 180) || '—',
    record.biometric.statusLabel,
    record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : 'No punch',
    matchStatusMeta(record.matchStatus).label,
  ]);
}

const CONFLICT_COLUMNS = [
  'Date',
  'Teacher Name',
  'WhatsApp Says',
  'WhatsApp Message',
  'Biometric Says',
  'First Punch',
  'Discrepancy',
];

function pendingTable(records: AuditRecord[], reviews: Record<string, AdminReviewEntry>): Row[] {
  return records.map((record) => [
    formatDisplayDate(record.date),
    record.employeeName,
    record.biometric.statusLabel,
    record.whatsapp.hasNotification ? 'Yes' : 'No',
    matchStatusMeta(record.matchStatus).label,
    record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : 'No punch',
    reviews[record.id] ? 'Decision recorded' : 'Pending administrative review',
  ]);
}

const PENDING_COLUMNS = [
  'Date',
  'Teacher Name',
  'Attendance Status',
  'WhatsApp Notified',
  'Cross-reference Verdict',
  'First Punch',
  'Administrative Status',
];

/** Rows that still have no administrative decision. */
export function pendingReviewRecords(result: AnalysisResult): AuditRecord[] {
  const reviews = result.admin.reviews ?? {};
  const pendingIds = new Set(
    result.admin.log.filter((row) => !reviews[row.auditId] && row.excuseStatus === 'pending').map((row) => row.auditId),
  );
  return result.auditRecords.filter((record) => pendingIds.has(record.id));
}

export function unnotifiedRecords(result: AnalysisResult): AuditRecord[] {
  return result.auditRecords.filter((record) => {
    const meta = matchStatusMeta(record.matchStatus);
    return meta.isUnnotified || record.matchStatus === 'BIOMETRIC_LATE_NO_REPORT';
  });
}

export function conflictingRecords(result: AnalysisResult): AuditRecord[] {
  return result.auditRecords.filter((record) => matchStatusMeta(record.matchStatus).isConflict);
}

/**
 * Renders the administrative report. Returns when the PDF has been saved.
 */
export async function downloadAdminReportPdf(
  result: AnalysisResult,
  options: AdminReportOptions = {},
): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = (autoTableModule.default ?? autoTableModule) as unknown as (
    doc: unknown,
    options: Record<string, unknown>,
  ) => void;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 32;
  const school = result.settings.schoolName || 'MBK School';
  const period = `${formatDisplayDate(result.coverage.firstDate)} – ${formatDisplayDate(result.coverage.lastDate)}`;

  /* ---------- cover header ---------- */
  doc.setFillColor(28, 40, 92);
  doc.rect(0, 0, pageWidth, 92, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(`${school} — Attendance Administrative Report`, margin, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.text(`Reporting period: ${period}`, margin, 54);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 69);
  doc.text(
    `Audited rows: ${result.auditRecords.length} · Working days: ${result.coverage.workingDates.length} · Employees: ${result.admin.teacherStats.length}`,
    margin,
    84,
  );
  doc.setFontSize(9);
  doc.text(`Source files: ${result.files.map((file) => file.file.name).join(', ') || '—'}`, pageWidth - margin, 84, {
    align: 'right',
  });

  let cursor = 116;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9.5);
  const intro = doc.splitTextToSize(
    [
      'This report summarises attendance administration for the period above. WhatsApp notifications and administrative excuses are recorded as separate fields: a notification never implies that an absence was excused. ' +
        'Late durations are calculated from the biometric machine record only (first valid punch minus the applicable cut-off) unless the administrator explicitly enabled estimation for days without biometric evidence. ' +
        'Values that the source data does not contain are printed as "Not provided" or "Pending administrative review" — nothing is assumed.',
      options.filters ? `Filters applied: ${options.filters}` : 'Filters applied: none',
    ].join('\n\n'),
    pageWidth - margin * 2,
  ) as string[];
  doc.text(intro, margin, cursor);
  cursor += intro.length * 11 + 10;

  const codes = new Map(result.attendanceEmployees.map((employee) => [employee.id, employee.employeeCode]));

  const section = (title: string, description: string, columns: string[], rows: Row[]) => {
    if (cursor > pageHeight - 140) {
      doc.addPage();
      cursor = 60;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(28, 40, 92);
    doc.text(title, margin, cursor);
    cursor += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    const lines = doc.splitTextToSize(description, pageWidth - margin * 2) as string[];
    doc.text(lines, margin, cursor);
    cursor += lines.length * 11 + 4;

    if (rows.length === 0) {
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(9);
      doc.text('No records in this section.', margin, cursor + 4);
      cursor += 22;
      return;
    }

    autoTable(doc, {
      head: [columns],
      body: rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)))),
      startY: cursor,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', textColor: [30, 30, 30] },
      headStyles: { fillColor: [28, 40, 92], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: [245, 246, 250] },
      theme: 'grid',
    });
    const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
    cursor = (finalY ?? cursor) + 34;
  };

  section(
    '1. Teacher Summary Table',
    'One row per teacher. "Full Absences (Excused)" contains only days an administrator recorded as excused or approved leave; every other absence is unexcused or still pending review.',
    TEACHER_COLUMNS,
    teacherTable(result.admin.teacherStats, codes),
  );

  section(
    '2. Itemized Absence and Late Arrival Log',
    'Every questionable day, with the recorded time in, the reason actually found in the data, the administrative status and the documentation/action recorded by the administrator.',
    LOG_COLUMNS,
    logTable(result.admin.log),
  );

  section(
    '3. Unnotified Attendance',
    'Late arrivals, absences and unconfirmed claims for which no WhatsApp notification and no report of any kind was found in the uploaded export.',
    UNNOTIFIED_COLUMNS,
    unnotifiedTable(unnotifiedRecords(result)),
  );

  section(
    '4. Conflicting Records',
    'Days where the WhatsApp group and the biometric machine do not agree. A message claiming lateness with an on-time punch is listed here as a claim the biometric record does not confirm.',
    CONFLICT_COLUMNS,
    conflictTable(conflictingRecords(result)),
  );

  section(
    '5. Pending Administrative Review',
    'Days that still need a decision. Choose "Confirm Excused", "Confirm Unexcused", "Mark as Leave", "Correct Attendance", "Add Documentation" or "Add Administrative Action" in the Review dialog.',
    PENDING_COLUMNS,
    pendingTable(pendingReviewRecords(result), result.admin.reviews ?? {}),
  );

  /* ---------- 6. administrative review notes (only what the admin typed) ---------- */
  if (cursor > pageHeight - 160) {
    doc.addPage();
    cursor = 60;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(28, 40, 92);
  doc.text('6. Administrative Review Notes', margin, cursor);
  cursor += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  const noteIntro = doc.splitTextToSize(
    'This section contains only notes entered by an administrator. The application never writes a review note itself.',
    pageWidth - margin * 2,
  ) as string[];
  doc.text(noteIntro, margin, cursor);
  cursor += noteIntro.length * 11 + 4;

  const notes = options.notes ?? [];
  if (notes.length === 0) {
    doc.setTextColor(120, 120, 120);
    doc.text('No administrative review notes were entered for this report.', margin, cursor + 4);
  } else {
    autoTable(doc, {
      head: [['Date', 'Teacher', 'Reviewer', 'Note']],
      body: notes.map((note) => [formatDisplayDate(note.date), note.employeeName, note.reviewer, note.note]),
      startY: cursor,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak', textColor: [30, 30, 30] },
      headStyles: { fillColor: [28, 40, 92], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      theme: 'grid',
    });
  }

  /* ---------- footers ---------- */
  const pages = doc.getNumberOfPages();
  for (let index = 1; index <= pages; index += 1) {
    doc.setPage(index);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `${school} — Attendance Administrative Report — confidential (staff attendance and WhatsApp data)`,
      margin,
      pageHeight - 16,
    );
    doc.text(`Page ${index} of ${pages}`, pageWidth - margin, pageHeight - 16, { align: 'right' });
  }

  doc.save(`mbk-attendance-administrative-report-${result.coverage.firstDate}-to-${result.coverage.lastDate}.pdf`);
}

/** Short rules summary printed under the teacher table in exports. */
export function describeAdminRules(settings: Settings): string[] {
  const rules = settings.adminRules;
  return [
    `Perfect Attendance: absences ≤ ${rules.perfectMaxAbsences}, late occurrences ≤ ${rules.perfectMaxLate}`,
    `Satisfactory: attendance rate ≥ ${rules.satisfactoryMinRate}%, late occurrences ≤ ${rules.satisfactoryMaxLate}`,
    `Verbal Notice: late occurrences ≥ ${rules.verbalNoticeMinLate}`,
    `Review Required: attendance rate < ${rules.reviewMaxRate}%, unexcused absences ≥ ${rules.reviewMaxUnexcused}, late occurrences ≥ ${rules.reviewMaxLate}${
      rules.reviewMaxLateMinutes > 0 ? `, total late time ≥ ${rules.reviewMaxLateMinutes} min` : ''
    }`,
    `Critical Review: attendance rate < ${rules.criticalMaxRate}%, unexcused absences ≥ ${rules.criticalMaxUnexcused}`,
  ];
}

/**
 * Excel export of the administrative report (spec 36): one workbook, one sheet
 * per section, so the administration can filter and annotate the data.
 */
export async function downloadAdminReportExcel(
  result: AnalysisResult,
  options: AdminReportOptions = {},
): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const codes = new Map(result.attendanceEmployees.map((employee) => [employee.id, employee.employeeCode]));
  const notes = options.notes ?? [];

  const addSheet = (name: string, columns: string[], rows: Row[]) => {
    const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows]);
    sheet['!cols'] = columns.map((column, index) => ({
      wch: Math.min(60, Math.max(12, column.length, ...rows.slice(0, 200).map((row) => String(row[index] ?? '').length))),
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
  };

  const info = XLSX.utils.aoa_to_sheet([
    [`${result.settings.schoolName || 'MBK School'} — Attendance Administrative Report`],
    [`Reporting period: ${formatDisplayDate(result.coverage.firstDate)} – ${formatDisplayDate(result.coverage.lastDate)}`],
    [`Generated: ${new Date().toLocaleString()}`],
    [`Filters: ${options.filters ?? 'none'}`],
    [`Source files: ${result.files.map((file) => file.file.name).join(', ') || '—'}`],
    [],
    ['Administrative rules in force:'],
    ...describeAdminRules(result.settings).map((rule) => [rule]),
    [],
    ['WhatsApp notification and administrative excuse are separate fields — a notification never implies an excuse.'],
    ['Late minutes are calculated from the biometric record only.'],
  ]);
  info['!cols'] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, info, 'Report info');

  addSheet('1 Teacher Summary', TEACHER_COLUMNS, teacherTable(result.admin.teacherStats, codes));
  addSheet('2 Itemized Log', LOG_COLUMNS, logTable(result.admin.log));
  addSheet('3 Unnotified', UNNOTIFIED_COLUMNS, unnotifiedTable(unnotifiedRecords(result)));
  addSheet('4 Conflicts', CONFLICT_COLUMNS, conflictTable(conflictingRecords(result)));
  addSheet('5 Pending Review', PENDING_COLUMNS, pendingTable(pendingReviewRecords(result), result.admin.reviews ?? {}));
  addSheet(
    '6 Review Notes',
    ['Date', 'Teacher', 'Reviewer', 'Note'],
    notes.map((note) => [note.date, note.employeeName, note.reviewer, note.note]),
  );

  XLSX.writeFile(
    workbook,
    `mbk-attendance-administrative-report-${result.coverage.firstDate}-to-${result.coverage.lastDate}.xlsx`,
  );
}
