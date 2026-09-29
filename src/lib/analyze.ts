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
import { parseWhatsAppExport } from './parsers/whatsapp';
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
  }[] = [];

  for (const file of options.files) {
    const kind = file.meta.kindOverride ?? file.meta.kind;
    if (kind === 'attendance') {
      const result = parseAttendanceFile(file.text, {
        fileId: file.meta.id,
        fileName: file.meta.name,
        dateOrder: settings.attendanceDateOrder,
        fallbackYear: settings.fallbackYear,
        rows: file.rows,
      });
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
  const { employees, records, attendanceFiles } = mergeAttendance(attendanceResults);

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
): {
  employees: AttendanceEmployee[];
  records: AttendanceRecord[];
  attendanceFiles: AttendanceFileSummary[];
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
        };
        canonical.push(target);
      } else {
        target.sourceFileIds = [
          ...new Set([...target.sourceFileIds, ...employee.sourceFileIds]),
        ];
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

  const recordByKey = new Map<string, AttendanceRecord>();
  for (const { result } of results) {
    for (const record of result.records) {
      const employeeId = idMap.get(record.employeeId) ?? record.employeeId;
      const key = `${employeeId}__${record.date}`;
      const existing = recordByKey.get(key);
      if (!existing) {
        recordByKey.set(key, {
          ...record,
          key,
          employeeId,
          punches: [...record.punches],
          cells: [...record.cells],
          markers: [...record.markers],
          parseWarnings: [...record.parseWarnings],
          sourceFileIds: [...record.sourceFileIds],
        });
        continue;
      }
      existing.cells.push(...record.cells);
      existing.punches.push(...record.punches);
      existing.markers = [...new Set([...existing.markers, ...record.markers])];
      existing.parseWarnings = [...new Set([...existing.parseWarnings, ...record.parseWarnings])];
      existing.sourceFileIds = [...new Set([...existing.sourceFileIds, ...record.sourceFileIds])];
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
  };
}

/* ------------------------------------------------------------------ *
 * Validation & review centre
 * ------------------------------------------------------------------ */

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

  /* --- files --- */
  const fileReports = files.map((file) => {
    const kind = file.meta.kindOverride ?? file.meta.kind;
    const whatsapp = whatsappResults.find((result) => result.file.meta.id === file.meta.id);
    const attendance = attendanceResults.find((result) => result.file.meta.id === file.meta.id);
    const recordsParsed = whatsapp
      ? whatsapp.messages.filter((message) => !message.isSystem).length
      : (attendance?.result.summary.recordCount ?? 0);
    const fileWarnings: string[] = [];
    if (whatsapp) {
      fileWarnings.push(...whatsapp.messages.flatMap((message) => message.parseWarnings));
    }
    if (attendance) {
      fileWarnings.push(...attendance.result.warnings);
    }
    return {
      fileId: file.meta.id,
      fileName: file.meta.name,
      kind,
      confidence: file.meta.detection.confidence,
      reasons: file.meta.detection.reasons,
      warnings: [...new Set(fileWarnings)].slice(0, 25),
      recordsParsed,
    };
  });

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
