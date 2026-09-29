/**
 * Legacy (.xls) and Modern (.xlsx) Excel Attendance Workbook Parser.
 *
 * Supports multi-sheet attendance workbooks exported by biometric attendance
 * systems (such as ZKTeco / StandardReport.xls).
 *
 * Features:
 *  1. Byte-level format detection (OLE/BIFF vs ZIP/OOXML) without relying on extension.
 *  2. Multi-sheet discovery and automatic classification (SCHEDULE, ATTENDANCE_STATISTICS,
 *     ATTENDANCE_LOG, EXCEPTION_REPORT, ATTENDANCE_SUMMARY, UNKNOWN) with confidence score.
 *  3. Specialized parsers for all 5 standard sheets.
 *  4. Compound day parsing (e.g. "23/19" -> normal 23, real 19, raw "23/19").
 *  5. Duration parsing (e.g. "143:45" -> 143h 45m / 8625 mins, "0:10" -> 10 mins).
 *  6. Daily date columns mapping (1..29 -> ISO dates using Stat.Date range).
 *  7. Multiple punches in a cell ("06:26 06:27 13:11 14:01" -> all punches, first, last, count).
 *  8. Special shift codes (25 = Ask for leave, 26 = Out, Null = Holiday).
 *  9. Canonical employee table with strong Employee ID matching.
 * 10. Cell-level diagnostics preserving raw values, coordinates (e.g. G25) and parsed results.
 * 11. Robust error handling: partial sheet failure never returns 0 records.
 */

import * as XLSX from 'xlsx';
import { extractClockTokens } from '../time';
import { normalizeName } from '../normalize';
import { enumerateDates, parseLooseDate, weekdayIndex } from '../dates';
import type {
  AttendanceDay,
  AttendanceEmployee,
  AttendanceFileSummary,
  AttendanceRecord,
  CanonicalEmployee,
  CellDiagnostic,
  CompoundDaysValue,
  DateOrder,
  DurationValue,
  ExcelSheetClassification,
  ExcelSheetMeta,
  ExcelWorkbookMeta,
  ExcelWorkbookParseResult,
  Punch,
} from '../types';

/* ------------------------------------------------------------------ *
 * Binary format detection
 * ------------------------------------------------------------------ */

export function isOleBinaryXls(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, 0, Math.min(buffer.byteLength, 16));
  if (bytes.length < 8) return false;
  // OLE2 CFB magic: D0 CF 11 E0 A1 B1 1A E1
  return (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  );
}

export function isZipOoxml(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, 0, Math.min(buffer.byteLength, 16));
  if (bytes.length < 4) return false;
  // PK\x03\x04
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function isExcelWorkbook(data: ArrayBuffer | Uint8Array | string, fileName?: string): boolean {
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    if (isOleBinaryXls(data) || isZipOoxml(data)) return true;
  }
  const lower = (fileName ?? '').toLowerCase();
  return lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.xlsm');
}

export function sniffExcelFormat(
  buffer: ArrayBuffer | Uint8Array,
  fileName?: string,
): { isLegacy: boolean; isExcel: boolean; formatDescription: string } {
  const isOle = isOleBinaryXls(buffer);
  const isZip = isZipOoxml(buffer);
  const lower = (fileName ?? '').toLowerCase();

  if (isOle || lower.endsWith('.xls')) {
    return {
      isLegacy: true,
      isExcel: true,
      formatDescription: 'Microsoft Excel 97-2003 Workbook (.xls)',
    };
  }
  if (isZip || lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    return {
      isLegacy: false,
      isExcel: true,
      formatDescription: 'Microsoft Excel Workbook (.xlsx)',
    };
  }
  return {
    isLegacy: false,
    isExcel: false,
    formatDescription: 'Unknown file format',
  };
}

/* ------------------------------------------------------------------ *
 * Duration and compound field parsers
 * ------------------------------------------------------------------ */

/**
 * Parses duration values such as "143:45", "93:14", "81:15", "90:51", "97:00",
 * "0:00", "0:01", "0:04", "0:10", or decimal hours.
 * Durations represent elapsed time, NOT time of day.
 */
export function parseDuration(value: string | number | null | undefined): DurationValue | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || raw === '-' || raw === '--') return null;

  // Pattern: HHH:MM or HHH:MM:SS
  const colonMatch = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(raw);
  if (colonMatch) {
    const hours = Number(colonMatch[1]);
    const minutes = Number(colonMatch[2]);
    const seconds = colonMatch[3] ? Number(colonMatch[3]) : 0;
    const totalMinutes = hours * 60 + minutes + (seconds >= 30 ? 1 : 0);
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    return {
      hours,
      minutes,
      totalMinutes,
      totalHours,
      display: `${hours}:${String(minutes).padStart(2, '0')}`,
      raw,
    };
  }

  // Decimal hours (e.g. 8.5)
  const num = Number(raw);
  if (!Number.isNaN(num) && /^\d+(?:\.\d+)?$/.test(raw)) {
    const totalMinutes = Math.round(num * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return {
      hours,
      minutes,
      totalMinutes,
      totalHours: num,
      display: `${hours}:${String(minutes).padStart(2, '0')}`,
      raw,
    };
  }

  return null;
}

/**
 * Parses compound ratio fields such as "23/19", "23/1", "23/15", "23/18", "23/0", "23/11".
 * Represents Normal Attendance Days / Real Attendance Days.
 */
export function parseCompoundDays(value: string | number | null | undefined): CompoundDaysValue | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const slashMatch = /^(\d+)\s*[/\\|]\s*(\d+)$/.exec(raw);
  if (slashMatch) {
    return {
      normalDays: Number(slashMatch[1]),
      realDays: Number(slashMatch[2]),
      raw,
    };
  }

  const singleNum = Number(raw);
  if (!Number.isNaN(singleNum) && /^\d+$/.test(raw)) {
    return {
      normalDays: singleNum,
      realDays: singleNum,
      raw,
    };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Worksheet classification
 * ------------------------------------------------------------------ */

export const SHEET_CLASSIFICATION_LABELS: Record<ExcelSheetClassification, string> = {
  SCHEDULE: 'Schedule',
  ATTENDANCE_STATISTICS: 'Attendance Statistics',
  ATTENDANCE_LOG: 'Attendance Log',
  EXCEPTION_REPORT: 'Exception Report',
  ATTENDANCE_SUMMARY: 'Attendance Summary',
  UNKNOWN: 'Unknown',
};

export function classifyWorksheet(
  sheetName: string,
  rows: string[][],
): { type: ExcelSheetClassification; typeLabel: string; confidence: number; reasons: string[] } {
  const normSheet = sheetName.toLowerCase().trim();
  const reasons: string[] = [];

  const topText = rows
    .slice(0, 10)
    .map((r) => r.join(' '))
    .join(' ')
    .toLowerCase();

  // 1. SCHEDULE
  if (normSheet.includes('schedule') || topText.includes('schedule information') || topText.includes('special shifts')) {
    reasons.push('Contains schedule information and shift assignment headers');
    return {
      type: 'SCHEDULE',
      typeLabel: SHEET_CLASSIFICATION_LABELS.SCHEDULE,
      confidence: 98,
      reasons,
    };
  }

  // 2. STATISTICAL REPORT OF ATTENDANCE (ATTENDANCE_SUMMARY)
  if (
    normSheet.includes('statistical report') ||
    normSheet.includes('statistical') ||
    topText.includes('statistical report of attendance') ||
    (topText.includes('additem payment') && topText.includes('deduction payment'))
  ) {
    reasons.push('Title or headers match "Statistical Report of Attendance"');
    return {
      type: 'ATTENDANCE_SUMMARY',
      typeLabel: SHEET_CLASSIFICATION_LABELS.ATTENDANCE_SUMMARY,
      confidence: 98,
      reasons,
    };
  }

  // 3. ATTENDANCE LOG (ATTENDANCE_LOG)
  if (
    normSheet.includes('att.log') ||
    normSheet.includes('att log') ||
    normSheet.includes('log report') ||
    topText.includes('att.log report') ||
    topText.includes('att. time')
  ) {
    reasons.push('Contains daily biometric punch logs and timestamps');
    return {
      type: 'ATTENDANCE_LOG',
      typeLabel: SHEET_CLASSIFICATION_LABELS.ATTENDANCE_LOG,
      confidence: 99,
      reasons,
    };
  }

  // 4. EXCEPTION REPORT (EXCEPTION_REPORT)
  if (
    normSheet.includes('exception') ||
    topText.includes('exception stat') ||
    topText.includes('exception report')
  ) {
    reasons.push('Identifies attendance exceptions (late, absent, leave early, overtime)');
    return {
      type: 'EXCEPTION_REPORT',
      typeLabel: SHEET_CLASSIFICATION_LABELS.EXCEPTION_REPORT,
      confidence: 96,
      reasons,
    };
  }

  // 5. ATTENDANCE STATISTICS (ATTENDANCE_STATISTICS)
  if (
    normSheet.includes('att. stat') ||
    normSheet.includes('att stat') ||
    normSheet.includes('attendance stat') ||
    (topText.includes('work hour') && topText.includes('att. days'))
  ) {
    reasons.push('Contains aggregate attendance statistics table');
    return {
      type: 'ATTENDANCE_STATISTICS',
      typeLabel: SHEET_CLASSIFICATION_LABELS.ATTENDANCE_STATISTICS,
      confidence: 98,
      reasons,
    };
  }

  return {
    type: 'UNKNOWN',
    typeLabel: SHEET_CLASSIFICATION_LABELS.UNKNOWN,
    confidence: 25,
    reasons: ['No recognized attendance pattern detected'],
  };
}

/* ------------------------------------------------------------------ *
 * Helper: Date range from header
 * ------------------------------------------------------------------ */

export function extractDateRangeFromRows(rows: string[][]): { first: string | null; last: string | null } {
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const text = rows[r].join(' ');
    const rangeMatch = /(?:stat\.?\s*date|att\.?\s*time|date\s*range|date)\s*[:：]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*~?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i.exec(text);
    if (rangeMatch) {
      const p1 = parseLooseDate(rangeMatch[1], { order: 'auto', defaultOrder: 'MDY', fallbackYear: 2026 });
      const p2 = parseLooseDate(rangeMatch[2], { order: 'auto', defaultOrder: 'MDY', fallbackYear: 2026 });
      if (p1 && p2) {
        return { first: p1.iso, last: p2.iso };
      }
    }
  }
  return { first: null, last: null };
}

/* ------------------------------------------------------------------ *
 * Helper: Special shifts dictionary
 * ------------------------------------------------------------------ */

export function extractSpecialShiftsLegend(rows: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  // Defaults
  map.set('25', 'Ask for leave');
  map.set('26', 'Out');
  map.set('null', 'Holiday');

  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const text = rows[r].join(' ');
    if (/special\s*shifts?/i.test(text)) {
      const pairs = text.match(/([A-Za-z0-9]+)\s*=\s*([^,;~]+)/g);
      if (pairs) {
        for (const pair of pairs) {
          const parts = pair.split('=');
          if (parts.length === 2) {
            const code = parts[0].trim().toLowerCase();
            const desc = parts[1].trim();
            map.set(code, desc);
          }
        }
      }
    }
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * Main Excel Workbook Parser
 * ------------------------------------------------------------------ */

export interface ExcelParseOptions {
  fileId: string;
  fileName: string;
  dateOrder: DateOrder;
  fallbackYear: number | null;
}

export function parseExcelWorkbook(
  buffer: ArrayBuffer | Uint8Array,
  options: ExcelParseOptions,
): ExcelWorkbookParseResult {
  const warnings: string[] = [];
  const problems: ExcelWorkbookParseResult['problems'] = [];
  const diagnostics: CellDiagnostic[] = [];

  const format = sniffExcelFormat(buffer, options.fileName);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  } catch (err) {
    warnings.push(`Could not read Excel workbook: ${err instanceof Error ? err.message : String(err)}`);
    return emptyWorkbookResult(options, format, warnings, problems);
  }

  const sheetNames = workbook.SheetNames ?? [];
  if (sheetNames.length === 0) {
    warnings.push(`"${options.fileName}" contains no sheets.`);
    return emptyWorkbookResult(options, format, warnings, problems);
  }

  const sheetMetas: ExcelSheetMeta[] = [];
  const sheetTables: ExcelWorkbookParseResult['sheetTables'] = {};
  const rawGrids: Record<string, string[][]> = {};

  const allEmployeesMap = new Map<string, { id: string; name: string; dept: string | null; sources: Set<string> }>();
  const nameDiscrepancies: { id: string; name1: string; name2: string; sheet: string }[] = [];

  const punchesList: Punch[] = [];
  const attendanceDayRecords: AttendanceDay[] = [];
  const attendanceRecordsMap = new Map<string, AttendanceRecord>();

  let overallFirstDate: string | null = null;
  let overallLastDate: string | null = null;
  let exceptionCount = 0;
  let statisticalRecordCount = 0;

  // Process EVERY worksheet
  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    // Convert to 2D array of strings
    const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: '',
    }) as unknown as string[][];

    const cleanRows = (rows ?? []).map((r) =>
      (r ?? []).map((c) => (c === null || c === undefined ? '' : String(c).trim())),
    );

    rawGrids[sheetName] = cleanRows;

    const classification = classifyWorksheet(sheetName, cleanRows);
    const dateRange = extractDateRangeFromRows(cleanRows);
    if (dateRange.first && (!overallFirstDate || dateRange.first < overallFirstDate)) {
      overallFirstDate = dateRange.first;
    }
    if (dateRange.last && (!overallLastDate || dateRange.last > overallLastDate)) {
      overallLastDate = dateRange.last;
    }

    let recordsInSheet = 0;
    let sheetStatus: ExcelSheetMeta['status'] = 'Parsed';
    let sheetStatusReason: string | undefined;

    try {
      if (classification.type === 'SCHEDULE') {
        recordsInSheet = parseScheduleSheet({
          worksheet,
          cleanRows,
          sheetName,
          options,
          dateRange,
          allEmployeesMap,
          nameDiscrepancies,
          diagnostics,
          attendanceRecordsMap,
        });
      } else if (classification.type === 'ATTENDANCE_LOG') {
        recordsInSheet = parseAttendanceLogSheet({
          worksheet,
          cleanRows,
          sheetName,
          options,
          dateRange,
          allEmployeesMap,
          nameDiscrepancies,
          diagnostics,
          punchesList,
          attendanceRecordsMap,
          attendanceDayRecords,
        });
      } else if (classification.type === 'ATTENDANCE_STATISTICS') {
        recordsInSheet = parseAttendanceStatSheet({
          worksheet,
          cleanRows,
          sheetName,
          options,
          allEmployeesMap,
          nameDiscrepancies,
          diagnostics,
        });
        statisticalRecordCount += recordsInSheet;
      } else if (classification.type === 'EXCEPTION_REPORT') {
        recordsInSheet = parseExceptionSheet({
          worksheet,
          cleanRows,
          sheetName,
          options,
          allEmployeesMap,
          nameDiscrepancies,
          diagnostics,
          attendanceRecordsMap,
        });
        exceptionCount += recordsInSheet;
      } else if (classification.type === 'ATTENDANCE_SUMMARY') {
        recordsInSheet = parseStatisticalSummarySheet({
          worksheet,
          cleanRows,
          sheetName,
          options,
          allEmployeesMap,
          nameDiscrepancies,
          diagnostics,
        });
        statisticalRecordCount += recordsInSheet;
      } else {
        // Generic fallback sheet parsing
        recordsInSheet = parseGenericSheet({
          cleanRows,
          sheetName,
          allEmployeesMap,
          diagnostics,
        });
      }
    } catch (sheetErr) {
      sheetStatus = 'Needs review';
      sheetStatusReason = sheetErr instanceof Error ? sheetErr.message : String(sheetErr);
      warnings.push(`Sheet "${sheetName}": ${sheetStatusReason}`);
    }

    // Build friendly sheet table preview
    const headerRowIdx = findHeaderRowIndex(cleanRows);
    const tableHeaders = headerRowIdx >= 0 ? cleanRows[headerRowIdx] : (cleanRows[0] ?? []);
    const tableDataRows = headerRowIdx >= 0 ? cleanRows.slice(headerRowIdx + 1, headerRowIdx + 15) : cleanRows.slice(1, 15);

    sheetTables[sheetName] = {
      headers: tableHeaders,
      rows: tableDataRows,
      detectedType: classification.type,
      typeLabel: classification.typeLabel,
    };

    const maxCols = cleanRows.reduce((max, r) => Math.max(max, r.length), 0);

    sheetMetas.push({
      sheetName,
      detectedType: classification.type,
      typeLabel: classification.typeLabel,
      confidence: classification.confidence,
      rowCount: cleanRows.length,
      columnCount: maxCols,
      recordCount: recordsInSheet,
      status: sheetStatus,
      statusReason: sheetStatusReason,
      diagnosticsCount: diagnostics.filter((d) => d.sheet === sheetName).length,
    });
  }

  // Report name discrepancies with high confidence match
  for (const disc of nameDiscrepancies) {
    warnings.push(
      `Employee ID ${disc.id}: name discrepancy detected between "${disc.name1}" and "${disc.name2}" in sheet "${disc.sheet}". Matched as the same employee (high confidence ID match).`,
    );
  }

  // Build canonical employees
  const canonicalEmployees: CanonicalEmployee[] = [];
  const attendanceEmployees: AttendanceEmployee[] = [];

  for (const [, emp] of allEmployeesMap.entries()) {
    canonicalEmployees.push({
      id: emp.id,
      name: emp.name,
      department: emp.dept,
      sourceWorkbook: options.fileName,
      sourceSheet: Array.from(emp.sources).join(', '),
    });

    attendanceEmployees.push({
      id: emp.id,
      employeeCode: emp.id,
      name: emp.name,
      nameNormalized: normalizeName(emp.name),
      department: emp.dept,
      sourceFileIds: [options.fileId],
      rawRow: { 'AC-No.': emp.id, Name: emp.name, Department: emp.dept ?? '' },
      rowNumbers: { [options.fileId]: 1 },
      sourceSheets: Array.from(emp.sources),
    });
  }

  const records = Array.from(attendanceRecordsMap.values());

  const dateColumns: AttendanceFileSummary['dateColumns'] = [];
  if (overallFirstDate && overallLastDate) {
    const dates = enumerateDates(overallFirstDate, overallLastDate);
    for (let i = 0; i < dates.length; i++) {
      dateColumns.push({
        column: String(i + 1),
        raw: String(i + 1),
        date: dates[i],
      });
    }
  }

  const summary: AttendanceFileSummary = {
    fileId: options.fileId,
    fileName: options.fileName,
    format: 'matrix',
    headerRowIndex: 3,
    headers: ['AC-No.', 'Name', 'Department', 'Dates...'],
    employeeColumn: 'Name',
    idColumn: 'AC-No.',
    departmentColumn: 'Department',
    dateColumns,
    rowCount: sheetMetas.reduce((sum, s) => sum + s.rowCount, 0),
    employeeCount: canonicalEmployees.length,
    recordCount: records.length,
    punchCount: punchesList.length,
    markersFound: ['LEAVE', 'OUT', 'HOLIDAY'],
    warnings,
    detectedDateFormat: 'YMD',
  };

  const meta: ExcelWorkbookMeta = {
    isLegacyXls: format.isLegacy,
    formatDescription: format.formatDescription,
    sheetCount: sheetNames.length,
    sheets: sheetMetas,
    employeeCount: canonicalEmployees.length,
    recordCount: records.length,
    punchCount: punchesList.length,
    exceptionCount,
    statisticalRecordCount,
    dateRange: { first: overallFirstDate, last: overallLastDate },
    errorCount: sheetMetas.filter((s) => s.status === 'Error').length,
    warningCount: warnings.length,
  };

  return {
    meta,
    summary,
    employees: attendanceEmployees,
    canonicalEmployees,
    records,
    canonicalDays: attendanceDayRecords,
    punches: punchesList,
    diagnostics,
    warnings,
    problems,
    sheetTables,
    rawGrids,
  };
}

function emptyWorkbookResult(
  options: ExcelParseOptions,
  format: { isLegacy: boolean; isExcel: boolean; formatDescription: string },
  warnings: string[],
  problems: ExcelWorkbookParseResult['problems'],
): ExcelWorkbookParseResult {
  const summary: AttendanceFileSummary = {
    fileId: options.fileId,
    fileName: options.fileName,
    format: 'unknown',
    headerRowIndex: 0,
    headers: [],
    employeeColumn: null,
    idColumn: null,
    departmentColumn: null,
    dateColumns: [],
    rowCount: 0,
    employeeCount: 0,
    recordCount: 0,
    punchCount: 0,
    markersFound: [],
    warnings,
    detectedDateFormat: 'auto',
  };
  return {
    meta: {
      isLegacyXls: format.isLegacy,
      formatDescription: format.formatDescription,
      sheetCount: 0,
      sheets: [],
      employeeCount: 0,
      recordCount: 0,
      punchCount: 0,
      exceptionCount: 0,
      statisticalRecordCount: 0,
      dateRange: { first: null, last: null },
      errorCount: 1,
      warningCount: warnings.length,
    },
    summary,
    employees: [],
    canonicalEmployees: [],
    records: [],
    canonicalDays: [],
    punches: [],
    diagnostics: [],
    warnings,
    problems,
    sheetTables: {},
    rawGrids: {},
  };
}

const ID_COL_RE = /^(ac-?no\.?|id|emp\s*(id|no|code|number)?|employee\s*(id|no|code|number)?|user\s*(id|no|code)?|enroll\s*(id|no|code|number)?|staff\s*(id|no|code)?|badge(\s*no)?|card(\s*no)?|s\.?no\.?|serial|pin|no\.?)$/i;
const NAME_COL_RE = /^(name|employee\s*name|emp\s*name|full\s*name|staff\s*name|teacher\s*name|user\s*name|worker\s*name|person)$/i;
const DEPT_COL_RE = /^(dept\.?|department|section|division|group|role|position|job(\s*title)?)$/i;

function findCol(header: string[], pattern: RegExp): number {
  const exact = header.findIndex((h) => pattern.test(String(h ?? '').trim()));
  if (exact >= 0) return exact;
  const norm = header.findIndex((h) => {
    const s = String(h ?? '').trim().replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, ' ');
    return pattern.test(s);
  });
  return norm;
}

/* ------------------------------------------------------------------ *
 * Helper: Find Header Row
 * ------------------------------------------------------------------ */

function findHeaderRowIndex(rows: string[][]): number {
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const row = rows[r];
    const joined = row.join(' ').toLowerCase();
    if (
      (joined.includes('name') && (joined.includes('dept') || joined.includes('department') || joined.includes('ac-no') || joined.includes('ac no') || joined.includes('id') || joined.includes('no.'))) ||
      joined.includes('work hour') ||
      joined.includes('att. days')
    ) {
      return r;
    }
  }
  return -1;
}

/* ------------------------------------------------------------------ *
 * Helper: Employee Tracking
 * ------------------------------------------------------------------ */

function trackEmployee(
  id: string | null,
  name: string,
  dept: string | null,
  sheetName: string,
  allEmployeesMap: Map<string, { id: string; name: string; dept: string | null; sources: Set<string> }>,
  nameDiscrepancies: { id: string; name1: string; name2: string; sheet: string }[],
): string {
  const cleanId = id ? id.trim() : '';
  const cleanName = name ? name.trim() : '';
  const cleanDept = dept ? dept.trim() : null;

  if (cleanId) {
    // 1. Direct ID match
    let existing = allEmployeesMap.get(cleanId);

    // 2. Numeric ID match (e.g. "01171" vs "1171")
    if (!existing && /^\d+$/.test(cleanId)) {
      const numStr = String(Number(cleanId));
      for (const [k, v] of allEmployeesMap.entries()) {
        if (/^\d+$/.test(k) && String(Number(k)) === numStr) {
          existing = v;
          break;
        }
      }
    }

    // 3. Name fallback: if ID is new but name matches an existing employee
    if (!existing && cleanName) {
      const norm = normalizeName(cleanName);
      for (const [, v] of allEmployeesMap.entries()) {
        if (normalizeName(v.name) === norm) {
          existing = v;
          break;
        }
      }
    }

    if (existing) {
      existing.sources.add(sheetName);
      if (cleanDept && !existing.dept) existing.dept = cleanDept;
      if (cleanName && existing.name.toLowerCase() !== cleanName.toLowerCase()) {
        nameDiscrepancies.push({
          id: existing.id,
          name1: existing.name,
          name2: cleanName,
          sheet: sheetName,
        });
      }
      return existing.id;
    }

    allEmployeesMap.set(cleanId, {
      id: cleanId,
      name: cleanName || cleanId,
      dept: cleanDept,
      sources: new Set([sheetName]),
    });
    return cleanId;
  }

  // Fallback: match by normalized name when ID is absent
  const norm = normalizeName(cleanName);
  for (const [empId, emp] of allEmployeesMap.entries()) {
    if (normalizeName(emp.name) === norm) {
      emp.sources.add(sheetName);
      if (cleanDept && !emp.dept) emp.dept = cleanDept;
      return empId;
    }
  }

  // Create temporary ID
  const newId = `EMP-${norm.slice(0, 10)}-${allEmployeesMap.size + 1}`;
  allEmployeesMap.set(newId, {
    id: newId,
    name: cleanName,
    dept: cleanDept,
    sources: new Set([sheetName]),
  });
  return newId;
}

/* ------------------------------------------------------------------ *
 * 1. Schedule Information Report Parser
 * ------------------------------------------------------------------ */

function parseScheduleSheet(ctx: {
  worksheet: XLSX.WorkSheet;
  cleanRows: string[][];
  sheetName: string;
  options: ExcelParseOptions;
  dateRange: { first: string | null; last: string | null };
  allEmployeesMap: Map<string, { id: string; name: string; dept: string | null; sources: Set<string> }>;
  nameDiscrepancies: { id: string; name1: string; name2: string; sheet: string }[];
  diagnostics: CellDiagnostic[];
  attendanceRecordsMap: Map<string, AttendanceRecord>;
}): number {
  const { cleanRows, sheetName, options, dateRange, allEmployeesMap, nameDiscrepancies, diagnostics, attendanceRecordsMap } = ctx;
  const specialShifts = extractSpecialShiftsLegend(cleanRows);
  const headerIdx = findHeaderRowIndex(cleanRows);
  if (headerIdx < 0) return 0;

  const header = cleanRows[headerIdx];
  const idCol = findCol(header, ID_COL_RE);
  const nameCol = findCol(header, NAME_COL_RE);
  const deptCol = findCol(header, DEPT_COL_RE);

  const baseYear = dateRange.first ? dateRange.first.slice(0, 4) : '2026';
  const baseMonth = dateRange.first ? dateRange.first.slice(5, 7) : '09';

  const findDayCols = (rowToCheck: string[]) => {
    const cols: { colIndex: number; dayNum: number; isoDate: string }[] = [];
    for (let c = 0; c < (rowToCheck ?? []).length; c++) {
      const colVal = String(rowToCheck[c] ?? '').trim();
      const match = /^(\d{1,2})(?:st|nd|rd|th)?(?:\s*\(?[A-Za-z]+\)?)?$/.exec(colVal);
      if (match) {
        const dayNum = Number(match[1]);
        if (dayNum >= 1 && dayNum <= 31) {
          const isoDate = `${baseYear}-${baseMonth}-${String(dayNum).padStart(2, '0')}`;
          cols.push({ colIndex: c, dayNum, isoDate });
        }
      }
    }
    return cols;
  };

  let dayColumns = findDayCols(header);
  let effectiveHeaderIdx = headerIdx;
  if (dayColumns.length === 0 && cleanRows[headerIdx + 1]) {
    const nextCols = findDayCols(cleanRows[headerIdx + 1]);
    if (nextCols.length >= 3) {
      dayColumns = nextCols;
      effectiveHeaderIdx = headerIdx + 1;
    }
  }

  let count = 0;
  let currentEmpId: string | null = null;
  for (let r = effectiveHeaderIdx + 1; r < cleanRows.length; r++) {
    const row = cleanRows[r];
    const rawId = idCol >= 0 ? row[idCol] : null;
    const rawName = nameCol >= 0 ? row[nameCol] : '';
    const rawDept = deptCol >= 0 ? row[deptCol] : null;

    let empId: string | null = null;
    if (rawId || rawName) {
      empId = trackEmployee(rawId, rawName, rawDept, sheetName, allEmployeesMap, nameDiscrepancies);
      currentEmpId = empId;
      count++;
    } else if (currentEmpId) {
      empId = currentEmpId;
    } else {
      continue;
    }

    for (const dc of dayColumns) {
      const rawVal = row[dc.colIndex] ?? '';
      const cellRef = XLSX.utils.encode_cell({ r, c: dc.colIndex });
      const colLetter = XLSX.utils.encode_col(dc.colIndex);

      let shiftCode: string | null = null;
      let shiftDesc = 'Working Shift';
      let isHoliday = false;

      if (rawVal === '25') {
        shiftCode = '25';
        shiftDesc = specialShifts.get('25') ?? 'Ask for leave';
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: cellRef,
          row: r + 1,
          column: colLetter,
          rawValue: rawVal,
          detectedType: 'Special shift (Leave)',
          parsedValue: `Code 25 → ${shiftDesc}`,
          status: 'SUCCESS',
        });
      } else if (rawVal === '26') {
        shiftCode = '26';
        shiftDesc = specialShifts.get('26') ?? 'Out';
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: cellRef,
          row: r + 1,
          column: colLetter,
          rawValue: rawVal,
          detectedType: 'Special shift (Out)',
          parsedValue: `Code 26 → ${shiftDesc}`,
          status: 'SUCCESS',
        });
      } else if (rawVal === '' || rawVal.toLowerCase() === 'null' || rawVal.toLowerCase() === 'holiday') {
        shiftCode = null;
        shiftDesc = 'Holiday';
        isHoliday = true;
      } else {
        shiftCode = rawVal;
        shiftDesc = `Shift ${rawVal}`;
      }

      // Record schedule day
      const key = `${empId}__${dc.isoDate}`;
      let attRecord = attendanceRecordsMap.get(key);
      if (!attRecord) {
        attRecord = {
          key,
          employeeId: empId,
          date: dc.isoDate,
          cells: [],
          punches: [],
          firstPunch: null,
          lastPunch: null,
          punchCount: 0,
          markers: [],
          parseWarnings: [],
          sourceFileIds: [options.fileId],
          sourceSheets: [sheetName],
        };
        attendanceRecordsMap.set(key, attRecord);
      }

      if (shiftCode === '25') {
        attRecord.specialShift = { code: 25, description: shiftDesc };
        if (!attRecord.markers.includes('LEAVE')) attRecord.markers.push('LEAVE');
      } else if (shiftCode === '26') {
        attRecord.specialShift = { code: 26, description: shiftDesc };
        if (!attRecord.markers.includes('OUT')) attRecord.markers.push('OUT');
        if (!attRecord.markers.includes('LEAVE')) attRecord.markers.push('LEAVE');
      } else if (isHoliday) {
        attRecord.specialShift = { code: null, description: 'Holiday' };
        if (!attRecord.markers.includes('HOLIDAY')) attRecord.markers.push('HOLIDAY');
      }
    }
  }

  return count;
}

/* ------------------------------------------------------------------ *
 * 2. Daily Attendance Log Report Parser
 * ------------------------------------------------------------------ */

function parseAttendanceLogSheet(ctx: {
  worksheet: XLSX.WorkSheet;
  cleanRows: string[][];
  sheetName: string;
  options: ExcelParseOptions;
  dateRange: { first: string | null; last: string | null };
  allEmployeesMap: Map<string, { id: string; name: string; dept: string | null; sources: Set<string> }>;
  nameDiscrepancies: { id: string; name1: string; name2: string; sheet: string }[];
  diagnostics: CellDiagnostic[];
  punchesList: Punch[];
  attendanceRecordsMap: Map<string, AttendanceRecord>;
  attendanceDayRecords: AttendanceDay[];
}): number {
  const { cleanRows, sheetName, options, dateRange, allEmployeesMap, nameDiscrepancies, diagnostics, punchesList, attendanceRecordsMap, attendanceDayRecords } = ctx;
  const headerIdx = findHeaderRowIndex(cleanRows);
  if (headerIdx < 0) return 0;

  const header = cleanRows[headerIdx];
  const idCol = findCol(header, ID_COL_RE);
  const nameCol = findCol(header, NAME_COL_RE);
  const deptCol = findCol(header, DEPT_COL_RE);

  const baseYear = dateRange.first ? dateRange.first.slice(0, 4) : '2026';
  const baseMonth = dateRange.first ? dateRange.first.slice(5, 7) : '09';

  const findDayCols = (rowToCheck: string[]) => {
    const cols: { colIndex: number; dayNum: number; isoDate: string }[] = [];
    for (let c = 0; c < (rowToCheck ?? []).length; c++) {
      const colVal = String(rowToCheck[c] ?? '').trim();
      const match = /^(\d{1,2})(?:st|nd|rd|th)?(?:\s*\(?[A-Za-z]+\)?)?$/.exec(colVal);
      if (match) {
        const dayNum = Number(match[1]);
        if (dayNum >= 1 && dayNum <= 31) {
          const isoDate = `${baseYear}-${baseMonth}-${String(dayNum).padStart(2, '0')}`;
          cols.push({ colIndex: c, dayNum, isoDate });
        }
      }
    }
    return cols;
  };

  let dayColumns = findDayCols(header);
  let effectiveHeaderIdx = headerIdx;
  if (dayColumns.length === 0 && cleanRows[headerIdx + 1]) {
    const nextCols = findDayCols(cleanRows[headerIdx + 1]);
    if (nextCols.length >= 3) {
      dayColumns = nextCols;
      effectiveHeaderIdx = headerIdx + 1;
    }
  }

  let count = 0;
  let currentEmpId: string | null = null;
  for (let r = effectiveHeaderIdx + 1; r < cleanRows.length; r++) {
    const row = cleanRows[r];
    const rawId = idCol >= 0 ? row[idCol] : null;
    const rawName = nameCol >= 0 ? row[nameCol] : '';
    const rawDept = deptCol >= 0 ? row[deptCol] : null;

    let empId: string | null = null;
    if (rawId || rawName) {
      empId = trackEmployee(rawId, rawName, rawDept, sheetName, allEmployeesMap, nameDiscrepancies);
      currentEmpId = empId;
      count++;
    } else if (currentEmpId) {
      empId = currentEmpId;
    } else {
      continue;
    }

    for (const dc of dayColumns) {
      const rawVal = row[dc.colIndex] ?? '';
      const cellRef = XLSX.utils.encode_cell({ r, c: dc.colIndex });
      const colLetter = XLSX.utils.encode_col(dc.colIndex);

      if (!rawVal) continue;

      // Check if it's a compound ratio (e.g. cell G25 with "23/19")
      const comp = parseCompoundDays(rawVal);
      if (comp && rawVal.includes('/')) {
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: cellRef,
          row: r + 1,
          column: colLetter,
          rawValue: rawVal,
          detectedType: 'Attendance ratio',
          parsedValue: `${comp.normalDays} normal / ${comp.realDays} real`,
          status: 'SUCCESS',
        });
        continue;
      }

      // Extract all punch clock tokens (handling "06:26 06:27 13:11 14:01", "06:27 13:15", etc.)
      const tokens = extractClockTokens(rawVal);
      if (tokens.length === 0) {
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: cellRef,
          row: r + 1,
          column: colLetter,
          rawValue: rawVal,
          detectedType: 'Unknown token',
          parsedValue: rawVal,
          status: 'UNRECOGNIZED',
          problem: 'Not a recognized clock time format',
          action: 'Review',
        });
        continue;
      }

      const cellPunches: Punch[] = [];
      tokens.forEach((token, idx) => {
        const p: Punch = {
          minutesOfDay: token.minutes,
          text: token.text,
          rawCell: rawVal,
          order: idx,
          fileId: options.fileId,
          fileName: options.fileName,
          sheetName,
          rowNumber: r + 1,
          columnLabel: String(dc.dayNum),
        };
        cellPunches.push(p);
        punchesList.push(p);
      });

      diagnostics.push({
        file: options.fileName,
        sheet: sheetName,
        cell: cellRef,
        row: r + 1,
        column: colLetter,
        rawValue: rawVal,
        detectedType: `Punches (${tokens.length})`,
        parsedValue: tokens.map((t) => t.text).join(' • '),
        status: 'SUCCESS',
      });

      const firstPunchMin = cellPunches[0].minutesOfDay;
      const lastPunchMin = cellPunches[cellPunches.length - 1].minutesOfDay;
      const workDurationMinutes = lastPunchMin > firstPunchMin ? lastPunchMin - firstPunchMin : 0;

      // Late duration calculation (Saturday–Wednesday cutoff 06:45 = 405 mins; Thursday cutoff 08:00 = 480 mins)
      const dayOfWeek = weekdayIndex(dc.isoDate); // 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat
      const isThursday = dayOfWeek === 4;
      const cutoff = isThursday ? 480 : 405;
      const lateDuration = firstPunchMin > cutoff ? firstPunchMin - cutoff : 0;
      const leaveEarly = lastPunchMin < 780 ? 780 - lastPunchMin : 0; // 13:00 threshold

      let attendanceStatus = 'PRESENT';
      if (lateDuration > 0) attendanceStatus = 'LATE';
      else if (leaveEarly > 0) attendanceStatus = 'PRESENT_LEFT_EARLY';

      // Update AttendanceDay
      attendanceDayRecords.push({
        employeeId: empId,
        date: dc.isoDate,
        firstPunch: firstPunchMin,
        lastPunch: lastPunchMin,
        allPunches: tokens.map((t) => t.text),
        workDuration: {
          hours: Math.floor(workDurationMinutes / 60),
          minutes: workDurationMinutes % 60,
          totalMinutes: workDurationMinutes,
        },
        lateDuration,
        leaveEarlyDuration: leaveEarly,
        overtimeDuration: 0,
        attendanceStatus,
        sourceFile: options.fileName,
        sourceSheet: sheetName,
        sourceRow: r + 1,
      });

      // Update AttendanceRecord
      const key = `${empId}__${dc.isoDate}`;
      let attRecord = attendanceRecordsMap.get(key);
      if (!attRecord) {
        attRecord = {
          key,
          employeeId: empId,
          date: dc.isoDate,
          cells: [],
          punches: [],
          firstPunch: null,
          lastPunch: null,
          punchCount: 0,
          markers: [],
          parseWarnings: [],
          sourceFileIds: [options.fileId],
          sourceSheets: [sheetName],
        };
        attendanceRecordsMap.set(key, attRecord);
      }

      attRecord.cells.push({
        raw: rawVal,
        punches: cellPunches,
        markers: [],
        parseWarnings: [],
      });
      attRecord.punches.push(...cellPunches);
      attRecord.punches.sort((a, b) => a.minutesOfDay - b.minutesOfDay);
      attRecord.punchCount = attRecord.punches.length;
      attRecord.firstPunch = attRecord.punches[0]?.minutesOfDay ?? null;
      attRecord.lastPunch = attRecord.punches[attRecord.punches.length - 1]?.minutesOfDay ?? null;
      attRecord.workDurationMinutes = workDurationMinutes;
      attRecord.lateDurationMinutes = lateDuration;
      attRecord.leaveEarlyDurationMinutes = leaveEarly;
    }
  }

  return count;
}

/* ------------------------------------------------------------------ *
 * 3. Attendance Statistics Report Parser
 * ------------------------------------------------------------------ */

function parseAttendanceStatSheet(ctx: {
  worksheet: XLSX.WorkSheet;
  cleanRows: string[][];
  sheetName: string;
  options: ExcelParseOptions;
  allEmployeesMap: Map<string, { id: string; name: string; dept: string | null; sources: Set<string> }>;
  nameDiscrepancies: { id: string; name1: string; name2: string; sheet: string }[];
  diagnostics: CellDiagnostic[];
}): number {
  const { cleanRows, sheetName, options, allEmployeesMap, nameDiscrepancies, diagnostics } = ctx;
  const headerIdx = findHeaderRowIndex(cleanRows);
  if (headerIdx < 0) return 0;

  const header = cleanRows[headerIdx];
  const idCol = findCol(header, ID_COL_RE);
  const nameCol = findCol(header, NAME_COL_RE);
  const deptCol = findCol(header, DEPT_COL_RE);
  const workCol = header.findIndex((h) => /work\s*hour/i.test(h));
  const lateCol = findCol(header, /^late/i);
  const attDaysCol = header.findIndex((h) => /att\.?\s*days/i.test(h));

  let count = 0;
  for (let r = headerIdx + 1; r < cleanRows.length; r++) {
    const row = cleanRows[r];
    const rawId = idCol >= 0 ? row[idCol] : null;
    const rawName = nameCol >= 0 ? row[nameCol] : '';
    const rawDept = deptCol >= 0 ? row[deptCol] : null;

    if (!rawId && !rawName) continue;
    trackEmployee(rawId, rawName, rawDept, sheetName, allEmployeesMap, nameDiscrepancies);
    count++;

    if (workCol >= 0 && row[workCol]) {
      const dur = parseDuration(row[workCol]);
      if (dur) {
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: XLSX.utils.encode_cell({ r, c: workCol }),
          row: r + 1,
          column: XLSX.utils.encode_col(workCol),
          rawValue: row[workCol],
          detectedType: 'Duration (Work Hour)',
          parsedValue: `${dur.hours}h ${dur.minutes}m (${dur.totalMinutes} mins)`,
          status: 'SUCCESS',
        });
      }
    }

    if (lateCol >= 0 && row[lateCol]) {
      const dur = parseDuration(row[lateCol]);
      if (dur) {
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: XLSX.utils.encode_cell({ r, c: lateCol }),
          row: r + 1,
          column: XLSX.utils.encode_col(lateCol),
          rawValue: row[lateCol],
          detectedType: 'Duration (Late)',
          parsedValue: `${dur.totalMinutes} mins (${dur.display})`,
          status: 'SUCCESS',
        });
      }
    }

    if (attDaysCol >= 0 && row[attDaysCol]) {
      const comp = parseCompoundDays(row[attDaysCol]);
      if (comp) {
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: XLSX.utils.encode_cell({ r, c: attDaysCol }),
          row: r + 1,
          column: XLSX.utils.encode_col(attDaysCol),
          rawValue: row[attDaysCol],
          detectedType: 'Attendance ratio',
          parsedValue: `${comp.normalDays} normal / ${comp.realDays} real`,
          status: 'SUCCESS',
        });
      }
    }
  }

  return count;
}

/* ------------------------------------------------------------------ *
 * 4. Exception Report Parser
 * ------------------------------------------------------------------ */

function parseExceptionSheet(ctx: {
  worksheet: XLSX.WorkSheet;
  cleanRows: string[][];
  sheetName: string;
  options: ExcelParseOptions;
  allEmployeesMap: Map<string, { id: string; name: string; dept: string | null; sources: Set<string> }>;
  nameDiscrepancies: { id: string; name1: string; name2: string; sheet: string }[];
  diagnostics: CellDiagnostic[];
  attendanceRecordsMap: Map<string, AttendanceRecord>;
}): number {
  const { cleanRows, sheetName, options, allEmployeesMap, nameDiscrepancies, diagnostics, attendanceRecordsMap } = ctx;
  const headerIdx = findHeaderRowIndex(cleanRows);
  if (headerIdx < 0) return 0;

  const header = cleanRows[headerIdx];
  const idCol = findCol(header, ID_COL_RE);
  const nameCol = findCol(header, NAME_COL_RE);
  const deptCol = findCol(header, DEPT_COL_RE);
  const dateCol = header.findIndex((h) => /^date$/i.test(h));
  const excCol = findCol(header, /exception/i);
  const timeCol = header.findIndex((h) => /^(time|duration)$/i.test(h));

  let count = 0;
  for (let r = headerIdx + 1; r < cleanRows.length; r++) {
    const row = cleanRows[r];
    const rawId = idCol >= 0 ? row[idCol] : null;
    const rawName = nameCol >= 0 ? row[nameCol] : '';
    const rawDept = deptCol >= 0 ? row[deptCol] : null;
    const rawDate = dateCol >= 0 ? row[dateCol] : '';
    const rawExc = excCol >= 0 ? row[excCol] : '';
    const rawTime = timeCol >= 0 ? row[timeCol] : '';

    if (!rawId && !rawName) continue;
    const empId = trackEmployee(rawId, rawName, rawDept, sheetName, allEmployeesMap, nameDiscrepancies);
    count++;

    const parsedDate = parseLooseDate(rawDate, { order: 'auto', defaultOrder: 'MDY', fallbackYear: 2026 });
    const isoDate = parsedDate ? parsedDate.iso : rawDate;

    if (excCol >= 0 && rawExc) {
      diagnostics.push({
        file: options.fileName,
        sheet: sheetName,
        cell: XLSX.utils.encode_cell({ r, c: excCol }),
        row: r + 1,
        column: XLSX.utils.encode_col(excCol),
        rawValue: rawExc,
        detectedType: 'Attendance Exception',
        parsedValue: `${rawExc}${rawTime ? ` (${rawTime})` : ''}`,
        status: 'SUCCESS',
      });
    }

    if (isoDate) {
      const key = `${empId}__${isoDate}`;
      let attRecord = attendanceRecordsMap.get(key);
      if (!attRecord) {
        attRecord = {
          key,
          employeeId: empId,
          date: isoDate,
          cells: [],
          punches: [],
          firstPunch: null,
          lastPunch: null,
          punchCount: 0,
          markers: [],
          parseWarnings: [],
          sourceFileIds: [options.fileId],
          sourceSheets: [sheetName],
        };
        attendanceRecordsMap.set(key, attRecord);
      }

      const normExc = rawExc.toLowerCase();
      if (normExc.includes('late')) {
        if (!attRecord.markers.includes('LATE')) attRecord.markers.push('LATE');
      } else if (normExc.includes('leave early')) {
        if (!attRecord.markers.includes('LEFT EARLY')) attRecord.markers.push('LEFT EARLY');
      } else if (normExc.includes('absent')) {
        if (!attRecord.markers.includes('ABSENT')) attRecord.markers.push('ABSENT');
      } else if (normExc.includes('leave') || normExc.includes('ask for leave')) {
        if (!attRecord.markers.includes('LEAVE')) attRecord.markers.push('LEAVE');
      } else if (normExc.includes('out')) {
        if (!attRecord.markers.includes('OUT')) attRecord.markers.push('OUT');
        if (!attRecord.markers.includes('LEAVE')) attRecord.markers.push('LEAVE');
      } else if (normExc.includes('holiday')) {
        if (!attRecord.markers.includes('HOLIDAY')) attRecord.markers.push('HOLIDAY');
      }
    }
  }

  return count;
}

/* ------------------------------------------------------------------ *
 * 5. Statistical Report of Attendance Parser
 * ------------------------------------------------------------------ */

function parseStatisticalSummarySheet(ctx: {
  worksheet: XLSX.WorkSheet;
  cleanRows: string[][];
  sheetName: string;
  options: ExcelParseOptions;
  allEmployeesMap: Map<string, { id: string; name: string; dept: string | null; sources: Set<string> }>;
  nameDiscrepancies: { id: string; name1: string; name2: string; sheet: string }[];
  diagnostics: CellDiagnostic[];
}): number {
  const { cleanRows, sheetName, options, allEmployeesMap, nameDiscrepancies, diagnostics } = ctx;
  const headerIdx = findHeaderRowIndex(cleanRows);
  if (headerIdx < 0) return 0;

  const header = cleanRows[headerIdx];
  const idCol = findCol(header, ID_COL_RE);
  const nameCol = findCol(header, NAME_COL_RE);
  const deptCol = findCol(header, DEPT_COL_RE);
  const workCol = header.findIndex((h) => /work\s*hour/i.test(h));
  const lateCol = findCol(header, /^late/i);
  const attDaysCol = header.findIndex((h) => /att\.?\s*days/i.test(h));

  let count = 0;
  for (let r = headerIdx + 1; r < cleanRows.length; r++) {
    const row = cleanRows[r];
    const rawId = idCol >= 0 ? row[idCol] : null;
    const rawName = nameCol >= 0 ? row[nameCol] : '';
    const rawDept = deptCol >= 0 ? row[deptCol] : null;

    if (!rawId && !rawName) continue;
    trackEmployee(rawId, rawName, rawDept, sheetName, allEmployeesMap, nameDiscrepancies);
    count++;

    if (workCol >= 0 && row[workCol]) {
      const dur = parseDuration(row[workCol]);
      if (dur) {
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: XLSX.utils.encode_cell({ r, c: workCol }),
          row: r + 1,
          column: XLSX.utils.encode_col(workCol),
          rawValue: row[workCol],
          detectedType: 'Duration (Work Hour)',
          parsedValue: `${dur.hours}h ${dur.minutes}m (${dur.totalMinutes} mins)`,
          status: 'SUCCESS',
        });
      }
    }

    if (lateCol >= 0 && row[lateCol]) {
      const dur = parseDuration(row[lateCol]);
      if (dur) {
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: XLSX.utils.encode_cell({ r, c: lateCol }),
          row: r + 1,
          column: XLSX.utils.encode_col(lateCol),
          rawValue: row[lateCol],
          detectedType: 'Duration (Late)',
          parsedValue: `${dur.totalMinutes} mins (${dur.display})`,
          status: 'SUCCESS',
        });
      }
    }

    if (attDaysCol >= 0 && row[attDaysCol]) {
      const comp = parseCompoundDays(row[attDaysCol]);
      if (comp) {
        diagnostics.push({
          file: options.fileName,
          sheet: sheetName,
          cell: XLSX.utils.encode_cell({ r, c: attDaysCol }),
          row: r + 1,
          column: XLSX.utils.encode_col(attDaysCol),
          rawValue: row[attDaysCol],
          detectedType: 'Attendance ratio',
          parsedValue: `${comp.normalDays} normal / ${comp.realDays} real`,
          status: 'SUCCESS',
        });
      }
    }
  }

  return count;
}

/* ------------------------------------------------------------------ *
 * 6. Generic Fallback Sheet Parser
 * ------------------------------------------------------------------ */

function parseGenericSheet(ctx: {
  cleanRows: string[][];
  sheetName: string;
  allEmployeesMap: Map<string, { id: string; name: string; dept: string | null; sources: Set<string> }>;
  diagnostics: CellDiagnostic[];
}): number {
  const { cleanRows, sheetName, allEmployeesMap } = ctx;
  const headerIdx = findHeaderRowIndex(cleanRows);
  if (headerIdx < 0) return 0;

  const header = cleanRows[headerIdx];
  const idCol = findCol(header, ID_COL_RE);
  const nameCol = findCol(header, NAME_COL_RE);
  const deptCol = findCol(header, DEPT_COL_RE);

  let count = 0;
  for (let r = headerIdx + 1; r < cleanRows.length; r++) {
    const row = cleanRows[r];
    const rawId = idCol >= 0 ? row[idCol] : null;
    const rawName = nameCol >= 0 ? row[nameCol] : '';
    const rawDept = deptCol >= 0 ? row[deptCol] : null;

    if (!rawId && !rawName) continue;
    trackEmployee(rawId, rawName, rawDept, sheetName, allEmployeesMap, []);
    count++;
  }
  return count;
}
