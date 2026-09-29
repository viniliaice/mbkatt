/**
 * Analysis pipeline.
 *
 *   files → parser → classifier → name matcher → cross-reference → summaries
 *
 * The whole pipeline is a pure function of (files, settings, aliases,
 * corrections): re-running it after a manual correction produces exactly the
 * same result every time, which is what makes the audit reviewable.
 */

import {
  addDaysIso,
  compareIso,
  enumerateDates,
  isIsoDate,
  parseLooseDate,
  weekdayIndex,
} from './dates';
import { parseAttendanceFile, type AttendanceParseResult } from './parsers/attendance';
import { parseExcelWorkbook } from './parsers/excelWorkbook';
import { parseWhatsAppExport, type WhatsAppParseDiagnostics } from './parsers/whatsapp';
import { buildAudit, isAuditableMessage, UNMATCHED_PREFIX } from './audit';
import { reclassifyMessage, type ClassifyContext } from './classify';
import { normalizeName, nameTokens } from './normalize';
import { resolveNameMatches } from './matcher';
import { DEFAULT_SETTINGS, resolveWorkingDay, settingsWithDefaults } from './rules';
import { buildAnalysisSummary, buildEmployeeSummaries } from './summary';
import { matchStatusMeta } from './statuses';
import type {
  AliasRule,
  AnalysisFileReport,
  AnalysisInputFile,
  AnalysisResult,
  AttendanceEmployee,
  AttendanceFileSummary,
  AttendanceRecord,
  AuditRecord,
  Corrections,
  NameMatch,
  Punch,
  ReviewIssue,
  Settings,
  ValidationReport,
  WhatsAppMessage,
} from './types';
import {
  chooseRecord,
  compareAttendanceSources,
  describeSourceNotes,
  type MergeDecision,
  type MergePreference,
} from './sources';
import { buildAdminLog, buildAdminTeacherStats } from './admin';
import { emptyCorrections } from './types';

export interface AnalyzeOptions {
  files: AnalysisInputFile[];
  settings: Partial<Settings> | null;
  aliases: AliasRule[];
  corrections?: Corrections;
  onProgress?: (step: string, ratio: number) => void;
}

let analysisCounter = 0;

export function analyze(options: AnalyzeOptions): AnalysisResult {
  const started = Date.now();
  const settings = settingsWithDefaults(options.settings);
  const corrections = options.corrections ?? emptyCorrections();
  const progress = options.onProgress ?? (() => {});
  const warnings: string[] = [];

  /* ---------------------------------------------------------------- 1. parse */
  progress('Reading files', 0.05);

  const attendanceResults: {
    file: AnalysisInputFile;
    result: AttendanceParseResult;
  }[] = [];
  const whatsappResults: {
    file: AnalysisInputFile;
    messages: WhatsAppMessage[];
    warnings: string[];
    senders: string[];
    parsedDates: number;
    unparsed: { lineNumber: number; raw: string; reason: string }[];
    detectedDateOrder: 'MDY' | 'DMY';
    orderAmbiguous: boolean;
    diagnostics: WhatsAppParseDiagnostics;
  }[] = [];

  for (const file of options.files) {
    const kind = file.meta.kindOverride ?? file.meta.kind;
    if (kind === 'attendance') {
      let result: AttendanceParseResult;
      if (file.workbookData) {
        result = {
          employees: file.workbookData.employees,
          records: file.workbookData.records,
          summary: file.workbookData.summary,
          punches: file.workbookData.punches,
          warnings: file.workbookData.warnings,
          problems: file.workbookData.problems,
        };
      } else if (file.buffer) {
        const wbResult = parseExcelWorkbook(file.buffer, {
          fileId: file.meta.id,
          fileName: file.meta.name,
          dateOrder: settings.attendanceDateOrder,
          fallbackYear: settings.fallbackYear,
        });
        file.workbookData = wbResult;
        file.meta.excelWorkbookMeta = wbResult.meta;
        result = {
          employees: wbResult.employees,
          records: wbResult.records,
          summary: wbResult.summary,
          punches: wbResult.punches,
          warnings: wbResult.warnings,
          problems: wbResult.problems,
        };
      } else {
        result = parseAttendanceFile(file.text, {
          fileId: file.meta.id,
          fileName: file.meta.name,
          dateOrder: settings.attendanceDateOrder,
          fallbackYear: settings.fallbackYear,
          rows: file.rows,
        });
      }
      attendanceResults.push({ file, result });
      warnings.push(...result.warnings.map((warning) => `${file.meta.name}: ${warning}`));
    } else if (kind === 'whatsapp') {
      const result = parseWhatsAppExport(file.text, {
        fileId: file.meta.id,
        fileName: file.meta.name,
        dateOrder: settings.whatsappDateOrder,
        fallbackYear: settings.fallbackYear,
      });
      whatsappResults.push({
        file,
        messages: result.messages,
        warnings: result.warnings,
        senders: result.senders,
        parsedDates: result.parsedDates,
        unparsed: result.unparsed,
        detectedDateOrder: result.detectedDateOrder,
        orderAmbiguous: result.orderAmbiguous,
        diagnostics: result.diagnostics,
      });
      warnings.push(...result.warnings.map((warning) => `${file.meta.name}: ${warning}`));
    } else {
      warnings.push(
        `${file.meta.name}: the file type could not be determined, so it was not analysed. Set its type on the Upload page and re-run the analysis.`,
      );
    }
  }

  progress('Merging attendance records', 0.25);

  /* ------------------------------------------------- 2. merge attendance data */
  const merged = mergeAttendance(attendanceResults, {
    primaryAttendanceSource: settings.primaryAttendanceSource,
  });
  const { employees, records, attendanceFiles } = merged;
  const sourceComparison = compareAttendanceSources({
    summaries: attendanceFiles,
    perFileRecords: merged.perFileRecords,
  });
  const sourceNotes = describeSourceNotes(merged.mergeDecisions);

  /* ---------------------------------------------------- 3. classifier context */
  const aliases = options.aliases ?? [];
  const classifierContext: ClassifyContext = {
    staffNames: new Set(employees.map((employee) => normalizeName(employee.name))),
    staffTokens: new Set(
      employees.flatMap((employee) =>
        nameTokens(employee.name).filter((token) => token.length >= 4),
      ),
    ),
    aliases: new Set(aliases.flatMap((alias) => [normalizeName(alias.whatsappName), normalizeName(alias.employeeName)])),
    senders: new Set(whatsappResults.flatMap((result) => result.senders)),
    customStaffWords: [],
    customStudentWords: [],
  };

  progress('Classifying WhatsApp messages', 0.4);

  /* ------------------------------------------------- 4. classify every message */
  const messages: WhatsAppMessage[] = [];
  for (const result of whatsappResults) {
    for (const message of result.messages) {
      if (message.isSystem) {
        messages.push(message);
        continue;
      }
      const classified = reclassifyMessage(message.raw, message.sender, classifierContext);
      messages.push({
        ...message,
        classification: {
          ...classified,
          manual: false,
        },
      });
    }
  }

  /* ------------------------------------------- 5. apply manual corrections (1) */
  applyMessageCorrections(messages, corrections);

  /* ------------------------------------------------------- 6. name matching */
  progress('Matching names', 0.55);

  const nameCounts = collectSubjectNames(messages, settings);
  let nameMatches = resolveNameMatches(nameCounts, employees, aliases, settings);

  // Manual overrides from the Review Center win over automatic matching.
  nameMatches = nameMatches.map((match) => {
    const override = corrections.nameOverrides[normalizeName(match.whatsappName)];
    if (!override) return match;
    if (override === 'reject') {
      return {
        ...match,
        employeeId: null,
        employeeName: null,
        confidence: 0,
        tier: 'rejected' as const,
        method: 'manual rejection',
        reasons: ['An administrator rejected the suggested match for this name.'],
        manual: true,
      };
    }
    const employee = employees.find((candidate) => candidate.id === override);
    if (!employee) return match;
    return {
      ...match,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeCode: employee.employeeCode,
      department: employee.department,
      confidence: 100,
      tier: 'manual' as const,
      method: 'manual mapping',
      reasons: [`An administrator mapped this WhatsApp name to "${employee.name}".`],
      manual: true,
    };
  });

  /* --------------------------------------------------------- 7. coverage */
  progress('Cross-referencing attendance and WhatsApp', 0.7);

  const attendanceDates = new Set<string>();
  for (const summary of attendanceFiles) {
    for (const column of summary.dateColumns) {
      if (column.date) attendanceDates.add(column.date);
    }
  }
  for (const record of records) {
    if (record.cells.length > 0) attendanceDates.add(record.date);
  }

  const whatsappDates = new Set(
    messages.filter((message) => message.date).map((message) => message.date as string),
  );
  const staffReportDates = new Set(
    messages
      .filter((message) => message.date && isAuditableMessage(message, settings))
      .map((message) => message.date as string),
  );

  const allDates = [...new Set([...attendanceDates, ...whatsappDates])].sort(compareIso);
  const firstDate = allDates[0] ?? null;
  const lastDate = allDates[allDates.length - 1] ?? null;
  const dates = firstDate && lastDate ? enumerateDates(firstDate, lastDate) : [];
  const workingDates = dates.filter((date) => resolveWorkingDay(date, settings).isWorkingDay);

  const attendanceDateList = [...attendanceDates].sort(compareIso);

  /* ------------------------------------------------------ 8. cross reference */
  const auditOutput = buildAudit({
    employees,
    records,
    messages,
    nameMatches,
    settings,
    attendanceDates,
    staffReportDates,
    dates,
    /* Employees an administrator attached to a message by hand (spec 34/44) */
    subjectAdditions: corrections.addedSubjects,
  });

  let auditRecords = auditOutput.auditRecords;
  if (corrections.dismissedRecords.length > 0) {
    const dismissed = new Set(corrections.dismissedRecords);
    auditRecords = auditRecords.filter((record) => !dismissed.has(record.id));
  }

  progress('Building summaries', 0.85);

  /* ------------------------------------------------------- 9. summaries */
  const employeeSummaries = buildEmployeeSummaries(auditRecords, nameMatches);

  const summary = buildAnalysisSummary({
    records: auditRecords,
    employeeSummaries,
    nameMatches,
    // replaced with the real count once the review centre has run (below)

    messagesTotal: messages.filter((message) => !message.isSystem).length,
    staffMessages: messages.filter((message) => !message.isSystem && message.classification.audience === 'staff').length,
    studentMessages: messages.filter((message) => !message.isSystem && message.classification.audience === 'student').length,
    uncertainMessages: messages.filter((message) => !message.isSystem && message.classification.audience === 'uncertain').length,
    unmatchedMessages: auditOutput.whatsappEvents.filter((row) => row.nameTier === 'unmatched').length,
    workingDates,
    employeesInAttendance: employees.length,
    reviewItems: 0,
  });

  /* --------------------------------------------------- 10. validation + review */
  const { validation, reviewIssues } = buildValidation({
    files: options.files,
    attendanceResults,
    attendanceFiles,
    whatsappResults,
    messages,
    employees,
    records,
    nameMatches,
    attendanceDates,
    whatsappDates,
    summary,
    auditRecords,
  });

  /* ---------------------------------------------------- 11. administrative layer */
  progress('Building administrative summary', 0.95);

  const adminReviews = corrections.adminReviews ?? {};
  const adminTeacherStats = buildAdminTeacherStats({
    records: auditRecords,
    workingDates,
    settings,
    reviews: adminReviews,
  });
  const adminLog = buildAdminLog(auditRecords, adminReviews);

  summary.reviewItems = reviewIssues.length;

  progress('Done', 1);

  const fileReports: AnalysisFileReport[] = options.files.map((file) => {
    const kind = file.meta.kindOverride ?? file.meta.kind;
    const whatsapp = whatsappResults.find((result) => result.file.meta.id === file.meta.id);
    const attendance = attendanceResults.find((result) => result.file.meta.id === file.meta.id);
    let text = 'File type could not be determined — it was not analysed.';
    if (whatsapp) {
      text = `${whatsapp.messages.filter((message) => !message.isSystem).length} message(s) parsed, ${whatsapp.parsedDates} with a readable date.`;
    } else if (attendance) {
      text = `${attendance.result.summary.employeeCount} employee(s), ${attendance.result.summary.recordCount} record(s), ${attendance.result.summary.punchCount} punch(es).`;
    }
    return {
      file: { ...file.meta, kind },
      kind,
      summary: text,
      whatsapp: whatsapp
        ? {
            messages: whatsapp.messages.filter((message) => !message.isSystem).length,
            parsedDates: whatsapp.parsedDates,
            unparsed: whatsapp.unparsed.length,
            senders: whatsapp.senders,
            firstDate:
              whatsapp.messages
                .map((message) => message.date)
                .filter((date): date is string => Boolean(date))
                .sort(compareIso)[0] ?? null,
            lastDate:
              whatsapp.messages
                .map((message) => message.date)
                .filter((date): date is string => Boolean(date))
                .sort(compareIso)
                .slice(-1)[0] ?? null,
            detectedDateOrder: whatsapp.detectedDateOrder,
          }
        : undefined,
      attendance: attendance?.result.summary,
    };
  });

  analysisCounter += 1;

  return {
    id: `analysis-${analysisCounter}-${started}`,
    createdAt: new Date().toISOString(),
    settings,
    aliases,
    files: fileReports,
    messages,
    attendanceEmployees: employees,
    attendanceRecords: records,
    attendanceFiles,
    nameMatches,
    auditRecords,
    whatsappEvents: auditOutput.whatsappEvents,
    employeeSummaries,
    summary,
    validation,
    reviewIssues,
    sourceComparison,
    sourceNotes,
    admin: {
      teacherStats: adminTeacherStats,
      log: adminLog,
      reviews: adminReviews,
    },
    coverage: {
      dates,
      workingDates,
      firstDate,
      lastDate,
      attendanceFirstDate: attendanceDateList[0] ?? null,
      attendanceLastDate: attendanceDateList[attendanceDateList.length - 1] ?? null,
      whatsappFirstDate: [...whatsappDates].sort(compareIso)[0] ?? null,
      whatsappLastDate: [...whatsappDates].sort(compareIso).slice(-1)[0] ?? null,
      datesWithoutAttendanceData: [...whatsappDates]
        .filter((date) => !attendanceDates.has(date))
        .sort(compareIso),
    },
    warnings,
    durationMs: Date.now() - started,
  };
}

/* ------------------------------------------------------------------ *
 * Message corrections
 * ------------------------------------------------------------------ */

function applyMessageCorrections(messages: WhatsAppMessage[], corrections: Corrections): void {
  for (const message of messages) {
    const audience = corrections.audience[message.id];
    if (audience) {
      message.classification = {
        ...message.classification,
        audience,
        audienceConfidence: 1,
        manual: true,
        audienceReasons: [
          `Manual correction: an administrator classified this message as ${audience.toUpperCase()}.`,
          ...message.classification.audienceReasons,
        ],
      };
    }

    const events = corrections.events[message.id];
    if (events) {
      message.classification = {
        ...message.classification,
        manual: true,
        events: events.map((type) => {
          const existing = message.classification.events.find((event) => event.type === type);
          return (
            existing ?? {
              type,
              phrase: '',
              negated: false,
              confidence: 1,
              offset: 0,
            }
          );
        }),
        notes: [...message.classification.notes, 'Event list corrected manually in the Review Center.'],
      };
    }

    const removed = corrections.removedMentions[message.id];
    if (removed && removed.length > 0) {
      const removedKeys = new Set(removed.map((text) => normalizeName(text)));
      message.classification = {
        ...message.classification,
        manual: true,
        mentions: message.classification.mentions.filter(
          (mention) => !removedKeys.has(normalizeName(mention.text)),
        ),
      };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Subject name collection
 * ------------------------------------------------------------------ */

export function collectSubjectNames(
  messages: WhatsAppMessage[],
  settings: Settings,
): { name: string; occurrences: number }[] {
  const counts = new Map<string, { name: string; occurrences: number }>();

  for (const message of messages) {
    if (!isAuditableMessage(message, settings)) continue;
    for (const mention of message.classification.mentions) {
      const normalized = normalizeName(mention.text);
      if (!normalized) continue;
      const existing = counts.get(normalized) ?? { name: mention.text, occurrences: 0 };
      existing.occurrences += 1;
      counts.set(normalized, existing);
    }
  }

  return [...counts.values()].sort((a, b) => b.occurrences - a.occurrences);
}

/* ------------------------------------------------------------------ *
 * Attendance merging
 * ------------------------------------------------------------------ */

export function mergeAttendance(
  results: { file: AnalysisInputFile; result: AttendanceParseResult }[],
  preferenceInput: { primaryAttendanceSource?: string } = {},
): {
  employees: AttendanceEmployee[];
  records: AttendanceRecord[];
  attendanceFiles: AttendanceFileSummary[];
  /** raw, per-file records with canonical employee ids (spec 48 comparison) */
  perFileRecords: Map<string, AttendanceRecord[]>;
  /** which source was used for every employee-day present in several files */
  mergeDecisions: MergeDecision[];
} {
  const canonical: AttendanceEmployee[] = [];
  const byCode = new Map<string, AttendanceEmployee>();
  const byName = new Map<string, AttendanceEmployee>();
  /** any source employee id → canonical employee id */
  const idMap = new Map<string, string>();

  for (const { result } of results) {
    for (const employee of result.employees) {
      const codeKey = employee.employeeCode ? employee.employeeCode.toLowerCase().trim() : null;
      const nameKey = normalizeName(employee.name);

      // An employee code is the strongest identity; the normalised name is the
      // fallback when a file has no ID column (which is the normal case for the
      // second attendance report).
      let target = codeKey ? byCode.get(codeKey) : undefined;
      if (!target && nameKey) target = byName.get(nameKey);

      if (!target) {
        target = {
          ...employee,
          rawRow: { ...employee.rawRow },
          rowNumbers: { ...employee.rowNumbers },
          sourceFileIds: [...employee.sourceFileIds],
          sourceSheets: employee.sourceSheets ? [...employee.sourceSheets] : [],
        };
        canonical.push(target);
      } else {
        target.sourceFileIds = [
          ...new Set([...target.sourceFileIds, ...employee.sourceFileIds]),
        ];
        if (employee.sourceSheets) {
          target.sourceSheets = [
            ...new Set([...(target.sourceSheets ?? []), ...employee.sourceSheets]),
          ];
        }
        target.department = target.department ?? employee.department;
        target.employeeCode = target.employeeCode ?? employee.employeeCode;
        target.rowNumbers = { ...target.rowNumbers, ...employee.rowNumbers };
        target.rawRow = { ...target.rawRow, ...employee.rawRow };
      }

      if (codeKey) {
        byCode.set(codeKey, target);
        if (!target.employeeCode) target.employeeCode = employee.employeeCode;
      }
      if (nameKey) byName.set(nameKey, target);
      idMap.set(employee.id, target.id);
    }
  }

  const preference: MergePreference = {
    primaryAttendanceSource: preferenceInput.primaryAttendanceSource ?? 'auto',
  };

  /** canonical records grouped per file — used for the source comparison */
  const perFileRecords = new Map<string, AttendanceRecord[]>();
  /** every candidate record for one employee-day, with its provenance */
  const grouped = new Map<
    string,
    { record: AttendanceRecord; fileId: string; fileName: string; fileIndex: number }[]
  >();

  results.forEach((entry, fileIndex) => {
    const list = perFileRecords.get(entry.file.meta.id) ?? [];
    for (const record of entry.result.records) {
      const employeeId = idMap.get(record.employeeId) ?? record.employeeId;
      const canonicalRecord: AttendanceRecord = { ...record, employeeId };
      list.push(canonicalRecord);
      const key = `${employeeId}__${record.date}`;
      const candidates = grouped.get(key) ?? [];
      candidates.push({ record: canonicalRecord, fileId: entry.file.meta.id, fileName: entry.file.meta.name, fileIndex });
      grouped.set(key, candidates);
    }
    perFileRecords.set(entry.file.meta.id, list);
  });

  /** one merged record per employee-day; nothing is double-counted */
  const recordByKey = new Map<string, AttendanceRecord>();
  const mergeDecisions: MergeDecision[] = [];

  for (const [key, candidates] of grouped) {
    const decision = candidates.length > 1 ? chooseRecord(candidates, preference) : null;
    const winner = decision ? candidates.find((entry) => entry.fileId === decision.usedFileId)! : candidates[0];
    const sources =
      decision && decision.usedFileId === preference.primaryAttendanceSource
        ? [winner] // an explicit primary source is authoritative for this day
        : candidates;

    const merged: AttendanceRecord = {
      ...winner.record,
      key,
      employeeId: winner.record.employeeId,
      cells: sources.flatMap((entry) => entry.record.cells),
      punches: sources.flatMap((entry) => entry.record.punches),
      markers: [...new Set(sources.flatMap((entry) => entry.record.markers))],
      parseWarnings: [...new Set(sources.flatMap((entry) => entry.record.parseWarnings))],
      sourceFileIds: [...new Set(candidates.flatMap((entry) => entry.record.sourceFileIds))],
    };
    recordByKey.set(key, merged);

    if (decision && candidates.length > 1) {
      const conflictNote =
        candidates.length > 1 && sources.length === 1
          ? `The other file(s) also contain this day: ${candidates
              .filter((entry) => entry.fileId !== decision.usedFileId)
              .map((entry) => entry.fileName)
              .join(', ')} — their values were not used because you selected a primary source.`
          : 'Both files contain this day; the punches were merged and de-duplicated by time.';
      mergeDecisions.push({ ...decision, reason: `${decision.reason} ${conflictNote}` });
    }
  }

  // Merge duplicate punch times that come from more than one file
  const records = [...recordByKey.values()].map((record) => {
    const seen = new Set<number>();
    const punches: Punch[] = [];
    for (const punch of record.punches) {
      if (seen.has(punch.minutesOfDay)) continue;
      seen.add(punch.minutesOfDay);
      punches.push(punch);
    }
    punches.sort((a, b) => a.minutesOfDay - b.minutesOfDay);
    return {
      ...record,
      punches,
      punchCount: punches.length,
      firstPunch: punches.length > 0 ? punches[0].minutesOfDay : null,
      lastPunch: punches.length > 0 ? punches[punches.length - 1].minutesOfDay : null,
    };
  });

  return {
    employees: canonical,
    records,
    attendanceFiles: results.map((entry) => entry.result.summary),
    perFileRecords,
    mergeDecisions,
  };
}

/* ------------------------------------------------------------------ *
 * Validation & review centre
 * ------------------------------------------------------------------ */

/** One parsed WhatsApp message, rendered as readable key/value lines (spec 46). */
function describeParsedMessage(message: WhatsAppMessage): string {
  const lines = [
    `Date: ${message.date ?? 'not recognised'}${message.dateText ? ` (as written: "${message.dateText}")` : ''}`,
    `Time: ${message.timeText ?? 'not recognised'}`,
    `Sender: ${message.sender ?? '— none (system line)'}`,
    `Message: ${message.raw.replace(/\n/g, ' ⏎ ')}`,
  ];
  if (message.classification.audience !== 'uncertain') {
    lines.push(`Classified as: ${message.classification.audience}`);
  }
  if (message.parseWarnings.length > 0) lines.push(`Parsing notes: ${message.parseWarnings.join(' ')}`);
  return lines.join('\n');
}

/** One parsed attendance record, rendered as readable key/value lines (spec 46). */
function describeParsedRecord(record: AttendanceRecord): string {
  const cells = record.cells
    .map((cell) => `"${cell.raw}"${cell.punches.length > 0 ? ` → ${cell.punches.map((punch) => punch.text).join(', ')}` : ''}`)
    .join(' | ');
  const lines = [
    `Date: ${record.date}`,
    `Punches read: ${record.punches.map((punch) => punch.text).join(', ') || 'none'}`,
    `First / last: ${record.firstPunch ?? '—'} / ${record.lastPunch ?? '—'} (minutes of day)`,
    `Cells: ${cells || '—'}`,
  ];
  if (record.markers.length > 0) lines.push(`Markers: ${record.markers.join(', ')}`);
  if (record.parseWarnings.length > 0) lines.push(`Parsing notes: ${record.parseWarnings.join(' ')}`);
  return lines.join('\n');
}

function buildValidation(params: {
  files: AnalysisInputFile[];
  attendanceResults: { file: AnalysisInputFile; result: AttendanceParseResult }[];
  attendanceFiles: AttendanceFileSummary[];
  whatsappResults: {
    file: AnalysisInputFile;
    messages: WhatsAppMessage[];
    senders: string[];
    unparsed: { lineNumber: number; raw: string; reason: string }[];
    detectedDateOrder: 'MDY' | 'DMY';
    orderAmbiguous: boolean;
    warnings: string[];
    diagnostics: WhatsAppParseDiagnostics;
  }[];
  messages: WhatsAppMessage[];
  employees: AttendanceEmployee[];
  records: AttendanceRecord[];
  nameMatches: NameMatch[];
  attendanceDates: Set<string>;
  whatsappDates: Set<string>;
  summary: ReturnType<typeof buildAnalysisSummary>;
  auditRecords: AuditRecord[];
}): { validation: ValidationReport; reviewIssues: ReviewIssue[] } {
  const {
    files,
    attendanceResults,
    whatsappResults,
    messages,
    employees,
    records,
    nameMatches,
    attendanceDates,
    whatsappDates,
    summary,
    auditRecords,
  } = params;

  const problems: ReviewIssue[] = [];
  const validationWarnings: string[] = [];
  const pushIssue = (issue: Omit<ReviewIssue, 'resolved'>) =>
    problems.push({ ...issue, resolved: false });

  let issueCounter = 0;
  const issueId = (prefix: string) => `${prefix}-${(issueCounter += 1)}`;

  /* --- files: detection AND parsing are reported separately (spec 38/45/46/49) --- */
  const fileReports = files.map((file) => {
    const kind = file.meta.kindOverride ?? file.meta.kind;
    const whatsapp = whatsappResults.find((result) => result.file.meta.id === file.meta.id);
    const attendance = attendanceResults.find((result) => result.file.meta.id === file.meta.id);
    const previewRaw = String(file.text ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .slice(0, 20)
      .map((line) => line.slice(0, 200));

    if (whatsapp) {
      const messagesForFile = whatsapp.messages.filter((message) => !message.isSystem);
      const staff = messagesForFile.filter((message) => message.classification.audience === 'staff').length;
      const student = messagesForFile.filter((message) => message.classification.audience === 'student').length;
      const uncertain = messagesForFile.filter((message) => message.classification.audience === 'uncertain').length;
      const dates = messagesForFile
        .map((message) => message.date)
        .filter((date): date is string => Boolean(date))
        .sort(compareIso);
      const fileWarnings: string[] = [];
      fileWarnings.push(...whatsapp.messages.flatMap((message) => message.parseWarnings));
      fileWarnings.push(...whatsapp.warnings);
      return {
        fileId: file.meta.id,
        fileName: file.meta.name,
        kind,
        confidence: file.meta.detection.confidence,
        reasons: file.meta.detection.reasons,
        warnings: [...new Set(fileWarnings)].slice(0, 25),
        recordsParsed: messagesForFile.length,
        staffMessages: staff,
        studentMessages: student,
        uncertainMessages: uncertain,
        dateRange: { first: dates[0] ?? null, last: dates.slice(-1)[0] ?? null },
        previewRaw,
        previewParsed: whatsapp.messages.slice(0, 20).map(describeParsedMessage),
        diagnostics: whatsapp.diagnostics,
        critical: whatsapp.diagnostics.formatMismatch,
      };
    }

    if (attendance) {
      const summaryFile = attendance.result.summary;
      const dates = attendance.result.records
        .map((record) => record.date)
        .sort(compareIso);
      const fileWarnings = [...attendance.result.warnings];
      for (const problem of attendance.result.problems) {
        fileWarnings.push(`${problem.message}${problem.rowNumber ? ` (row ${problem.rowNumber})` : ''}`);
      }
      const wbMeta = file.workbookData?.meta ?? file.meta.excelWorkbookMeta;
      const attendanceLogs = wbMeta?.punchCount ?? summaryFile.punchCount;
      const exceptions = wbMeta?.exceptionCount ?? 0;
      const statisticalRecords = wbMeta?.statisticalRecordCount ?? 0;
      return {
        fileId: file.meta.id,
        fileName: file.meta.name,
        kind,
        confidence: file.meta.detection.confidence,
        reasons: file.meta.detection.reasons,
        warnings: [...new Set(fileWarnings)].slice(0, 25),
        recordsParsed: summaryFile.recordCount,
        employees: summaryFile.employeeCount,
        records: summaryFile.recordCount,
        punches: summaryFile.punchCount,
        dateRange: { first: dates[0] ?? null, last: dates.slice(-1)[0] ?? null },
        previewRaw,
        previewParsed: attendance.result.records.slice(0, 20).map(describeParsedRecord),
        critical: false,
        excelWorkbookMeta: wbMeta,
        excelWorkbookResult: file.workbookData,
        attendanceLogs,
        exceptions,
        statisticalRecords,
      };
    }

    return {
      fileId: file.meta.id,
      fileName: file.meta.name,
      kind,
      confidence: file.meta.detection.confidence,
      reasons: file.meta.detection.reasons,
      warnings: ['The file was identified but could not be parsed and was not used in the analysis.'],
      recordsParsed: 0,
      previewRaw,
      previewParsed: [],
      critical: true,
    };
  });

  /* --- WhatsApp files that produced no messages (spec 45) --- */
  for (const result of whatsappResults) {
    const parsedMessages = result.messages.filter((message) => !message.isSystem).length;
    if (parsedMessages === 0) {
      const sample = result.diagnostics.sampleLines.slice(0, 3).join('\n');
      pushIssue({
        id: issueId('waparse'),
        type: 'unparsed_message',
        severity: 'high',
        critical: true,
        title: 'WhatsApp parsing failed or no messages were recognized',
        detail:
          `${result.file.meta.name}: ${result.diagnostics.timestamps} timestamp-like line(s) and ${result.diagnostics.messageBlocks} message block(s) were detected, but no message could be built. ` +
          (result.diagnostics.formatMismatch
            ? 'PARSER FORMAT MISMATCH — the file uses a chat structure this parser does not recognise. Supported: [9/1/26, 5:17:33 AM] Name: text · [5:17] **Name:** text · [2026-09-01 05:17] Name: text · 01/09/2026, 05:17 - Name: text · markdown date headings with [time] **Name:** lines.'
            : 'No timestamp-like lines were found at all — this may not be a chat export.'),
        sourceFile: result.file.meta.name,
        raw: sample || undefined,
        suggestion:
          result.diagnostics.unrecognisedSamples.length > 0
            ? `Recognised sample lines: ${sample || 'none'}. First unrecognised line: ${result.diagnostics.unrecognisedSamples[0]}`
            : 'Re-export the chat, or set the file type manually if it is not a WhatsApp export.',
      });
    }
    for (const entry of result.unparsed.slice(0, 100)) {
      if (result.diagnostics.formatMismatch) break;
      pushIssue({
        id: issueId('unparsed'),
        type: 'unparsed_message',
        severity: 'medium',
        title: 'WhatsApp line could not be parsed',
        detail: entry.reason,
        sourceFile: result.file.meta.name,
        sourceLocation: `line ${entry.lineNumber}`,
        raw: entry.raw,
        suggestion: 'Check that this line uses one of the supported export formats, or correct the source file.',
      });
    }
  }

  /* --- malformed times --- */
  for (const { file, result } of attendanceResults) {
    for (const problem of result.problems) {
      if (problem.type === 'malformed_time') {
        pushIssue({
          id: issueId('malformed'),
          type: 'malformed_time',
          severity: 'medium',
          title: 'Time value could not be read',
          detail: problem.message,
          sourceFile: file.meta.name,
          sourceLocation: problem.rowNumber
            ? `row ${problem.rowNumber}${problem.column ? `, column "${problem.column}"` : ''}`
            : undefined,
          raw: problem.raw,
        });
      }
      if (problem.type === 'employee_without_punches') {
        pushIssue({
          id: issueId('nopunch'),
          type: 'employee_without_punches',
          severity: 'low',
          title: 'Employee has no readable punch',
          detail: problem.message,
          sourceFile: file.meta.name,
          raw: problem.raw,
        });
      }
    }
  }

  /* --- unparsable WhatsApp lines --- */
  for (const result of whatsappResults) {
    for (const entry of result.unparsed.slice(0, 100)) {
      pushIssue({
        id: issueId('unparsed'),
        type: 'unparsed_message',
        severity: 'medium',
        title: 'WhatsApp line could not be parsed',
        detail: entry.reason,
        sourceFile: result.file.meta.name,
        sourceLocation: `line ${entry.lineNumber}`,
        raw: entry.raw,
      });
    }
  }

  /* --- uncertain classification --- */
  const uncertainMessages = messages.filter(
    (message) => !message.isSystem && message.classification.audience === 'uncertain',
  );
  for (const message of uncertainMessages.slice(0, 200)) {
    const mentions = message.classification.mentions.map((mention) => mention.text).join(', ');
    pushIssue({
      id: issueId('uncertain'),
      type: 'uncertain_classification',
      severity: 'medium',
      title: 'Message could not be classified as staff or student',
      detail: `"${truncate(message.raw)}"${mentions ? ` — mentions: ${mentions}` : ''}`,
      sourceFile: message.fileName,
      sourceLocation: `line ${message.lineNumber}`,
      raw: message.rawLines.join('\n'),
      messageId: message.id,
      date: message.date ?? undefined,
    });
  }

  /* --- unknown event --- */
  const unknownEvents = messages.filter(
    (message) =>
      !message.isSystem &&
      message.classification.audience !== 'student' &&
      message.classification.events.some((event) => event.type === 'UNKNOWN'),
  );
  for (const message of unknownEvents.slice(0, 200)) {
    pushIssue({
      id: issueId('unknownevent'),
      type: 'unknown_event',
      severity: 'low',
      title: 'Staff message with no recognised attendance event',
      detail: `"${truncate(message.raw)}"`,
      sourceFile: message.fileName,
      sourceLocation: `line ${message.lineNumber}`,
      raw: message.rawLines.join('\n'),
      messageId: message.id,
      date: message.date ?? undefined,
    });
  }

  /* --- name matching --- */
  for (const match of nameMatches) {
    if (match.manual) continue;
    if (match.tier === 'possible') {
      pushIssue({
        id: issueId('namemaybe'),
        type: 'uncertain_name_match',
        severity: 'high',
        title: 'Possible (unconfirmed) name match',
        detail: `"${match.whatsappName}" was matched to "${match.employeeName}" with ${match.confidence}% confidence. Alternatives: ${
          match.alternatives.length > 0
            ? match.alternatives.map((alt) => `${alt.employeeName} (${alt.confidence}%)`).join(', ')
            : 'none'
        }`,
        whatsappName: match.whatsappName,
        employeeId: match.employeeId ?? undefined,
      });
    } else if (match.tier === 'unmatched') {
      pushIssue({
        id: issueId('nameunmatched'),
        type: 'uncertain_name_match',
        severity: 'high',
        title: 'WhatsApp name could not be matched to an employee',
        detail: `"${match.whatsappName}" appears ${match.occurrences} time(s) in the chat but does not correspond to an attendance employee. Suggested candidates: ${
          match.alternatives.length > 0
            ? match.alternatives.map((alt) => `${alt.employeeName} (${alt.confidence}%)`).join(', ')
            : 'none — no similar name was found at all'
        }`,
        whatsappName: match.whatsappName,
        employeeId: match.employeeId ?? undefined,
      });
    }
  }

  /* --- conflicting attendance --- */
  const conflicts = auditRecords.filter((record) => matchStatusMeta(record.matchStatus).isConflict);
  for (const record of conflicts) {
    pushIssue({
      id: issueId('conflict'),
      type: 'conflicting_attendance',
      severity: 'high',
      title: 'Conflicting records between biometric and WhatsApp',
      detail: `${record.employeeName} on ${record.date}: ${matchStatusMeta(record.matchStatus).label}`,
      employeeId: record.employeeId,
      date: record.date,
      auditId: record.id,
      raw: record.evidence.find((item) => item.kind === 'whatsapp')?.raw,
    });
  }

  /* --- missing dates (WhatsApp days without attendance data) --- */
  const datesWithoutAttendanceData = [...whatsappDates].filter(
    (date) => !attendanceDates.has(date),
  );
  if (datesWithoutAttendanceData.length > 0) {
    pushIssue({
      id: issueId('missingdates'),
      type: 'missing_dates',
      severity: 'medium',
      title: 'WhatsApp activity on dates with no attendance data',
      detail: `${datesWithoutAttendanceData.length} date(s) appear in the chat but in none of the attendance files: ${datesWithoutAttendanceData
        .slice(0, 12)
        .join(', ')}${datesWithoutAttendanceData.length > 12 ? '…' : ''}`,
      raw: datesWithoutAttendanceData.join(', '),
    });
  }

  const orphanDates = [...attendanceDates].filter((date) => !whatsappDates.has(date));
  if (orphanDates.length > 0 && whatsappDates.size > 0) {
    validationWarnings.push(
      `${orphanDates.length} date(s) exist in the attendance files but not in the chat. On those days there is nothing to compare against, so "not notified" simply means "no chat data".`,
    );
  }

  /* --- duplicate records --- */
  const recordKeyCounts = new Map<string, number>();
  for (const record of records) {
    recordKeyCounts.set(record.key, (recordKeyCounts.get(record.key) ?? 0) + 1);
  }
  const duplicates = [...recordKeyCounts.entries()].filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    pushIssue({
      id: issueId('duplicate'),
      type: 'duplicate_record',
      severity: 'low',
      title: 'Employee/day appears more than once',
      detail: `${duplicates.length} employee/day combination(s) appear in more than one attendance file. Punches were merged; verify in the attendance audit if that is unexpected.`,
    });
  }

  /* --- employees listed but never punched --- */
  const employeesWithPunches = new Set(
    records.filter((record) => record.punchCount > 0).map((record) => record.employeeId),
  );
  const neverPunched = employees.filter((employee) => !employeesWithPunches.has(employee.id));
  if (neverPunched.length > 0) {
    pushIssue({
      id: issueId('neverpunched'),
      type: 'employee_without_punches',
      severity: 'low',
      title: 'Employees with no readable punch at all',
      detail: `${neverPunched.length} employee(s) appear in the attendance files but never produced a readable punch: ${neverPunched
        .slice(0, 15)
        .map((employee) => employee.name)
        .join(', ')}${neverPunched.length > 15 ? '…' : ''}`,
    });
  }

  /* --- date range sanity --- */
  const attendanceDateList = [...attendanceDates].sort(compareIso);
  const whatsappDateList = [...whatsappDates].sort(compareIso);
  if (attendanceDateList.length > 0 && whatsappDateList.length > 0) {
    const overlap = attendanceDateList.filter((date) => whatsappDates.has(date));
    if (overlap.length === 0) {
      validationWarnings.push(
        'The attendance files and the WhatsApp chat have no dates in common — the cross-reference will report everything as unmatched. Check the date formats and the day/month order in Settings.',
      );
    }
  }

  const criticalProblems = problems.filter((issue) => issue.critical);
  const warningProblems = problems.filter((issue) => !issue.critical);

  const validation: ValidationReport = {
    files: fileReports,
    totals: {
      files: files.length,
      whatsappMessages: messages.filter((message) => !message.isSystem).length,
      staffMessages: messages.filter(
        (message) => !message.isSystem && message.classification.audience === 'staff',
      ).length,
      studentMessages: messages.filter(
        (message) => !message.isSystem && message.classification.audience === 'student',
      ).length,
      uncertainMessages: uncertainMessages.length,
      attendanceEmployees: employees.length,
      attendanceRecords: records.length,
      punches: records.reduce((sum, record) => sum + record.punchCount, 0),
      datesFound: new Set([...attendanceDates, ...whatsappDates]).size,
      employeesMatched: nameMatches.filter(
        (match) => match.employeeId && (match.tier === 'matched' || match.tier === 'manual'),
      ).length,
      employeesRequiringReview: nameMatches.filter(
        (match) => !match.manual && (match.tier === 'possible' || match.tier === 'unmatched'),
      ).length,
      unmatchedNames: nameMatches.filter((match) => match.tier === 'unmatched').length,
      parseProblems: problems.filter((problem) =>
        ['malformed_time', 'unparsed_message', 'duplicate_record'].includes(problem.type),
      ).length,
      criticalProblems: criticalProblems.length,
      warningProblems: warningProblems.length,
    },
    dateRange: { first: summary.attendanceTrend[0]?.date ?? null, last: summary.attendanceTrend.slice(-1)[0]?.date ?? null },
    problems,
    warnings: [
      ...validationWarnings,
      ...whatsappResults.flatMap((result) =>
        result.orderAmbiguous
          ? [`"${result.file.meta.name}": all chat dates are ambiguous — month-first (M/D/Y) was assumed. Verify in Settings.`]
          : [],
      ),
      ...whatsappResults.flatMap((result) =>
        result.detectedDateOrder === 'DMY'
          ? [`"${result.file.meta.name}": chat dates were read as day/month/year based on unambiguous values in the file.`]
          : [],
      ),
      ...attendanceResults.flatMap((entry) =>
        entry.result.summary.detectedDateFormat === 'day/month/year'
          ? [`"${entry.file.meta.name}": attendance dates were read as day/month/year based on unambiguous values in the file.`]
          : [],
      ),
    ],
  };

  // Keep the review centre focused: conflicts and name problems first.
  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  problems.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] || a.type.localeCompare(b.type),
  );

  return { validation, reviewIssues: problems };
}

function truncate(value: string, max = 160): string {
  const single = String(value).replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

/* ------------------------------------------------------------------ *
 * Small helpers reused by the UI
 * ------------------------------------------------------------------ */

export function isWorkingDate(date: string, settings: Settings): boolean {
  return resolveWorkingDay(date, settings).isWorkingDay;
}

export function weekdayIndexOf(date: string): number {
  return weekdayIndex(date);
}

export { DEFAULT_SETTINGS, addDaysIso, isIsoDate, parseLooseDate, UNMATCHED_PREFIX };
