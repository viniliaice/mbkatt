/**
 * Attendance file parser.
 *
 * Two layouts are supported and auto-detected:
 *
 *  A. Matrix (most biometric exports)
 *     | ID | Name         | Department | 2026-09-01 | 2026-09-02 | …
 *     | 12 | Ikram Axmed  | Teaching   | 06:38,16:45| ABSENT     | …
 *
 *  B. Long / transactional
 *     | Employee | Date       | Clock In | Clock Out |
 *     | Ikram    | 2026-09-01 | 06:38    | 16:45    |
 *
 * Anything that cannot be read confidently is reported as a parsing problem
 * instead of being guessed — the audit must never invent attendance.
 */

import Papa from 'papaparse';
import { detectDateOrder, parseLooseDate, weekdayIndex } from '../dates';
import { extractClockTokens, minutesToClock } from '../time';
import { normalizeName } from '../normalize';
import type {
  AttendanceCell,
  AttendanceEmployee,
  AttendanceFileSummary,
  AttendanceRecord,
  DateOrder,
  Punch,
} from '../types';

export interface AttendanceParseOptions {
  fileId: string;
  fileName: string;
  /** resolved day/month order for date columns */
  dateOrder: DateOrder;
  fallbackYear: number | null;
  /** rows supplied directly (xlsx) instead of raw text */
  rows?: string[][];
}

export interface AttendanceParseResult {
  employees: AttendanceEmployee[];
  records: AttendanceRecord[];
  summary: AttendanceFileSummary;
  punches: Punch[];
  warnings: string[];
  problems: {
    type: 'malformed_time' | 'duplicate_record' | 'missing_dates' | 'employee_without_punches';
    message: string;
    rowNumber?: number;
    column?: string;
    raw?: string;
  }[];
}

/* ------------------------------------------------------------------ *
 * Text helpers
 * ------------------------------------------------------------------ */

const MARKER_WORDS: { token: string; label: string }[] = [
  { token: 'absent', label: 'ABSENT' },
  { token: 'absence', label: 'ABSENT' },
  { token: 'no record', label: 'NO RECORD' },
  { token: 'norecord', label: 'NO RECORD' },
  { token: 'no data', label: 'NO RECORD' },
  { token: 'leave', label: 'LEAVE' },
  { token: 'vacation', label: 'LEAVE' },
  { token: 'holiday', label: 'HOLIDAY' },
  { token: 'public holiday', label: 'HOLIDAY' },
  { token: 'off', label: 'OFF' },
  { token: 'rest', label: 'OFF' },
  { token: 'weekend', label: 'WEEKEND' },
  { token: 'sick', label: 'SICK' },
  { token: 'sick leave', label: 'SICK' },
  { token: 'late', label: 'LATE' },
  { token: 'early', label: 'LEFT EARLY' },
  { token: 'missing', label: 'MISSING' },
  { token: 'nil', label: 'EMPTY' },
  { token: 'n/a', label: 'EMPTY' },
];

const EMPTY_CELL_VALUES = new Set(['', '-', '--', '—', 'nil', 'n/a', 'na', 'null', 'none', '0']);

export function extractMarkers(raw: string): string[] {
  const lowered = String(raw ?? '').toLowerCase();
  if (!lowered.trim()) return [];
  const found: string[] = [];
  for (const marker of MARKER_WORDS) {
    if (lowered.includes(marker.token)) {
      if (!found.includes(marker.label)) found.push(marker.label);
    }
  }
  return found;
}

export function parseAttendanceCell(
  raw: string,
  meta: {
    fileId: string;
    fileName: string;
    rowNumber: number;
    columnLabel: string;
    earliestPlausiblePunch?: number;
    latestPlausiblePunch?: number;
  },
): AttendanceCell {
  const text = String(raw ?? '').replace(/\u00a0/g, ' ').trim();
  const punches: Punch[] = [];
  const warnings: string[] = [];
  const markers = extractMarkers(text);

  if (EMPTY_CELL_VALUES.has(text.toLowerCase())) {
    return { raw: text, punches, markers, parseWarnings: warnings };
  }

  const tokens = extractClockTokens(text);
  tokens.forEach((token, index) => {
    const plausibleFrom = meta.earliestPlausiblePunch ?? 0;
    const plausibleTo = meta.latestPlausiblePunch ?? 24 * 60 - 1;
    const outsideWindow = token.minutes < plausibleFrom || token.minutes > plausibleTo;
    if (outsideWindow) {
      warnings.push(
        `"${token.text}" (${minutesToClock(token.minutes)}) lies outside the plausible punch window ${minutesToClock(
          plausibleFrom,
        )}–${minutesToClock(plausibleTo)} and was ignored.`,
      );
      return;
    }
    punches.push({
      minutesOfDay: token.minutes,
      text: token.text,
      rawCell: text,
      order: index,
      fileId: meta.fileId,
      fileName: meta.fileName,
      rowNumber: meta.rowNumber,
      columnLabel: meta.columnLabel,
    });
  });

  if (punches.length === 0 && !markers.length && text && !/^[\d\s.,:/-]+$/.test(text)) {
    const digits = /\d/.test(text);
    if (!digits) {
      // Text without numbers and without a known marker — probably a note.
      warnings.push(`The cell value "${text}" is not a recognised time and is not a known status code.`);
    }
  }

  return { raw: text, punches, markers, parseWarnings: warnings };
}

/* ------------------------------------------------------------------ *
 * CSV reading
 * ------------------------------------------------------------------ */

function csvRows(text: string): { rows: string[][]; delimiter: string } {
  const cleaned = String(text).replace(/^\uFEFF/, '');
  const result = Papa.parse<string[]>(cleaned, {
    skipEmptyLines: 'greedy',
    header: false,
    dynamicTyping: false,
  });
  const delimiter = (result.meta as { delimiter?: string }).delimiter ?? ',';
  const rows = (result.data as unknown as string[][]).map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
  );
  return { rows: rows.filter((row) => row.some((cell) => String(cell).trim() !== '')), delimiter };
}

/* ------------------------------------------------------------------ *
 * Header detection
 * ------------------------------------------------------------------ */

const NAME_COLUMN_PATTERN =
  /^(employee\s*name|emp\s*name|name|full\s*name|staff\s*name|worker|person|employee|staff|magaca|shaqaalaha|sh\u0430qaale)$/i;
const ID_COLUMN_PATTERN = /^(id|no|s\.?\s*no|serial|emp\s*(id|no|code|number)|employee\s*(id|code|no|number)|code|badge|staff\s*id|pin|user\s*id|aqoonsi)$/i;
const DEPT_COLUMN_PATTERN = /^(department|dept|debt|section|division|position|job|role|title|designation|waax|job\s*title)$/i;
const DATE_COLUMN_PATTERN = /^(date|day|tarikh|taariikh|date\s*of\s*attendance)$/i;
const TIME_COLUMN_PATTERN =
  /(clock\s*(in|out)|check\s*(in|out)|time\s*(in|out)|punch\s*(in|out)?|sign\s*(in|out)|in\s*time|out\s*time|entry|exit|arrival|departure|in|out|time|hours?)/i;

function headerScore(row: string[]): number {
  let score = 0;
  for (const cell of row) {
    const value = String(cell ?? '').trim();
    if (!value) continue;
    if (NAME_COLUMN_PATTERN.test(value)) score += 4;
    else if (ID_COLUMN_PATTERN.test(value)) score += 2;
    else if (DEPT_COLUMN_PATTERN.test(value)) score += 2;
    else if (DATE_COLUMN_PATTERN.test(value)) score += 3;
    else if (TIME_COLUMN_PATTERN.test(value)) score += 1;
    const trimmed = value.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*/i, '');
    if (/\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}/.test(trimmed) || /\d{1,2}[-/.][A-Za-z]{3,}/.test(trimmed)) {
      score += 3;
    }
  }
  return score;
}

export interface AttendanceLayout {
  format: 'matrix' | 'long';
  headerRowIndex: number;
  headers: string[];
  nameColumn: number;
  idColumn: number | null;
  departmentColumn: number | null;
  dateColumns: { index: number; label: string; date: string | null; raw: string }[];
  longDateColumn: number | null;
  longTimeColumns: number[];
  longDateTimeColumn: number | null;
}

function emptySummary(options: AttendanceParseOptions, warnings: string[]): AttendanceFileSummary {
  return {
    fileId: options.fileId,
    fileName: options.fileName,
    format: 'unknown',
    headerRowIndex: -1,
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
    detectedDateFormat: options.dateOrder,
  };
}

/**
 * Chooses the most plausible header row and classifies each column.
 */
export function detectLayout(
  rows: string[][],
  options: AttendanceParseOptions,
  detectedOrder: 'MDY' | 'DMY',
): AttendanceLayout {
  const maxHeader = Math.min(6, rows.length);
  let best: AttendanceLayout | null = null;
  let bestScore = -Infinity;

  for (let index = 0; index < maxHeader; index += 1) {
    const row = rows[index] ?? [];
    const headers = row.map((cell) => String(cell ?? '').trim());
    const lower = headers.map((h) => h.toLowerCase());

    let nameColumn = lower.findIndex((h) => NAME_COLUMN_PATTERN.test(h));

    const idColumn = lower.findIndex((h) => ID_COLUMN_PATTERN.test(h) && h !== '');
    const departmentColumn = lower.findIndex((h) => DEPT_COLUMN_PATTERN.test(h));

    // date columns
    const dateColumns: AttendanceLayout['dateColumns'] = [];
    for (let column = 0; column < headers.length; column += 1) {
      if (column === nameColumn || column === idColumn || column === departmentColumn) continue;
      const label = headers[column];
      if (!label) continue;
      if (DATE_COLUMN_PATTERN.test(label.toLowerCase())) continue;
      if (TIME_COLUMN_PATTERN.test(label) && !/\d/.test(label)) continue;
      const parsed = parseLooseDate(label, {
        order: options.dateOrder === 'auto' ? detectedOrder : options.dateOrder,
        fallbackYear: options.fallbackYear,
        defaultOrder: detectedOrder,
      });
      if (parsed) {
        dateColumns.push({ index: column, label, date: parsed.iso, raw: label });
      }
    }

    // long layout: an explicit date column + time columns
    const dateColumnIndex = lower.findIndex((h) => DATE_COLUMN_PATTERN.test(h));
    const timeColumns = lower
      .map((h, column) => ({ h, column }))
      .filter(({ h }) => h && TIME_COLUMN_PATTERN.test(h) && !/^date$/.test(h))
      .filter(({ h }) => !/total|duration|worked|hours|late|early|status|remark|note|ot\b/i.test(h))
      .map(({ column }) => column);

    // datetime packed into a single column ("2026-09-01 06:38:12")
    let longDateTimeColumn: number | null = null;
    for (let column = 0; column < headers.length; column += 1) {
      if (column === nameColumn) continue;
      const h = lower[column];
      if (!h) continue;
      if (/date\s*time|datetime|timestamp|punch\s*time/.test(h)) {
        longDateTimeColumn = column;
        break;
      }
    }

    const long =
      dateColumnIndex >= 0 && (timeColumns.length > 0 || longDateTimeColumn !== null);

    let score = headerScore(row);
    if (nameColumn >= 0) score += 3;
    score += Math.min(dateColumns.length, 8);

    // if no explicit name column, look for the text column that best behaves like names
    if (nameColumn < 0) {
      const candidate = guessNameColumn(rows, index, headers.length, options, detectedOrder);
      if (candidate >= 0) {
        nameColumn = candidate;
        score += 2;
      }
    }

    if (long) {
      score += 4;
    }
    if (!best || score > bestScore) {
      bestScore = score;
      best = {
        format: long ? 'long' : 'matrix',
        headerRowIndex: index,
        headers,
        nameColumn,
        idColumn: idColumn >= 0 ? idColumn : null,
        departmentColumn: departmentColumn >= 0 ? departmentColumn : null,
        dateColumns,
        longDateColumn: dateColumnIndex >= 0 ? dateColumnIndex : null,
        longTimeColumns: timeColumns,
        longDateTimeColumn,
      };
    }
  }

  if (!best) {
    return {
      format: 'matrix',
      headerRowIndex: 0,
      headers: (rows[0] ?? []).map((c) => String(c ?? '').trim()),
      nameColumn: 0,
      idColumn: null,
      departmentColumn: null,
      dateColumns: [],
      longDateColumn: null,
      longTimeColumns: [],
      longDateTimeColumn: null,
    };
  }
  return best;
}

function guessNameColumn(
  rows: string[][],
  headerRowIndex: number,
  columnCount: number,
  options: AttendanceParseOptions,
  detectedOrder: 'MDY' | 'DMY',
): number {
  const sample = rows.slice(headerRowIndex + 1, headerRowIndex + 12);
  let bestColumn = -1;
  let bestScore = 0;

  for (let column = 0; column < columnCount; column += 1) {
    let score = 0;
    for (const row of sample) {
      const value = String(row[column] ?? '').trim();
      if (!value) continue;
      const isTime = extractClockTokens(value).length > 0;
      const isDate = Boolean(
        parseLooseDate(value, {
          order: options.dateOrder === 'auto' ? detectedOrder : options.dateOrder,
          fallbackYear: options.fallbackYear,
          defaultOrder: detectedOrder,
        }),
      );
      const hasLetters = /\p{L}/u.test(value);
      const wordCount = value.split(/\s+/).length;
      if (hasLetters && !isTime && !isDate && wordCount >= 1 && wordCount <= 5) score += 2;
      if (isTime || isDate) score -= 2;
      if (/^\d+$/.test(value)) score -= 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestColumn = column;
    }
  }
  return bestScore > 0 ? bestColumn : -1;
}

/* ------------------------------------------------------------------ *
 * Main parser
 * ------------------------------------------------------------------ */

export function parseAttendanceFile(
  text: string,
  options: AttendanceParseOptions,
): AttendanceParseResult {
  const warnings: string[] = [];
  const problems: AttendanceParseResult['problems'] = [];

  let rows: string[][];
  let delimiter = ',';
  if (options.rows && options.rows.length > 0) {
    rows = options.rows;
    delimiter = 'xlsx';
  } else {
    const parsed = csvRows(text);
    rows = parsed.rows;
    delimiter = parsed.delimiter;
  }

  if (rows.length === 0) {
    warnings.push(`"${options.fileName}" contains no rows.`);
    return {
      employees: [],
      records: [],
      punches: [],
      warnings,
      problems,
      summary: emptySummary(options, warnings),
    };
  }

  // Detect the day/month order from headers + first column of each row
  const orderSamples: string[] = [];
  rows.slice(0, 8).forEach((row) => row.forEach((cell) => orderSamples.push(String(cell ?? ''))));
  const detected = detectDateOrder(orderSamples);

  const layout = detectLayout(rows, options, detected.order);
  const effectiveOrder: DateOrder =
    options.dateOrder === 'auto' ? detected.order : options.dateOrder;

  if (detected.ambiguous && options.dateOrder === 'auto' && layout.dateColumns.length > 0) {
    warnings.push(
      `Date columns in "${options.fileName}" are ambiguous (every day component is ≤ 12). Month-first (M/D/Y) was assumed — change it in Settings if the report is day-first.`,
    );
  }

  const employees = new Map<string, AttendanceEmployee>();
  const records = new Map<string, AttendanceRecord>();
  const punches: Punch[] = [];
  const markersFound = new Set<string>();

  const buildKey = (employee: AttendanceEmployee, date: string) => `${employee.id}__${date}`;

  const ensureEmployee = (
    rawName: string,
    rawCode: string | null,
    department: string | null,
    rowNumber: number,
    rawRow: Record<string, string>,
  ): AttendanceEmployee | null => {
    const name = String(rawName ?? '').trim();
    const code = rawCode ? String(rawCode).trim() : null;
    if (!name && !code) return null;
    const identity = code ? `code:${code.toLowerCase()}` : `name:${normalizeName(name)}`;
    const existing = employees.get(identity);
    if (existing) {
      if (!existing.department && department) existing.department = department;
      if (!existing.sourceFileIds.includes(options.fileId)) existing.sourceFileIds.push(options.fileId);
      existing.rowNumbers[options.fileId] = rowNumber;
      Object.assign(existing.rawRow, rawRow);
      return existing;
    }
    const employee: AttendanceEmployee = {
      id: `${options.fileId}-e${employees.size + 1}`,
      employeeCode: code,
      name: name || code || 'Unknown',
      nameNormalized: normalizeName(name || code || ''),
      department,
      sourceFileIds: [options.fileId],
      rawRow,
      rowNumbers: { [options.fileId]: rowNumber },
    };
    employees.set(identity, employee);
    return employee;
  };

  const pushRecord = (
    employee: AttendanceEmployee,
    date: string,
    cell: AttendanceCell,
    rowNumber: number,
    columnLabel: string,
  ) => {
    const key = buildKey(employee, date);
    let record = records.get(key);
    if (!record) {
      record = {
        key,
        employeeId: employee.id,
        date,
        cells: [],
        punches: [],
        firstPunch: null,
        lastPunch: null,
        punchCount: 0,
        markers: [],
        parseWarnings: [],
        sourceFileIds: [],
      };
      records.set(key, record);
    }
    record.cells.push(cell);
    record.punches.push(...cell.punches);
    record.parseWarnings.push(...cell.parseWarnings);
    cell.markers.forEach((marker) => {
      markersFound.add(marker);
      if (!record!.markers.includes(marker)) record!.markers.push(marker);
    });
    if (!record.sourceFileIds.includes(options.fileId)) record.sourceFileIds.push(options.fileId);
    punches.push(...cell.punches);
    if (cell.parseWarnings.length > 0) {
      problems.push({
        type: 'malformed_time',
        message: cell.parseWarnings.join(' '),
        rowNumber,
        column: columnLabel,
        raw: cell.raw,
      });
    }
  };

  const headerRow = rows[layout.headerRowIndex] ?? [];
  const dataRows = rows.slice(layout.headerRowIndex + 1).map((row, offset) => ({
    row,
    rowNumber: layout.headerRowIndex + offset + 2, // 1-based, matching a spreadsheet
  }));

  if (layout.format === 'long' && layout.nameColumn >= 0) {
    parseLongLayout({
      dataRows,
      layout,
      options,
      effectiveOrder,
      detectedOrder: detected.order,
      ensureEmployee,
      pushRecord,
      problems,
      warnings,
    });
  } else if (layout.dateColumns.length > 0 && layout.nameColumn >= 0) {
    parseMatrixLayout({
      dataRows,
      layout,
      options,
      effectiveOrder,
      detectedOrder: detected.order,
      ensureEmployee,
      pushRecord,
      problems,
      warnings,
    });
  } else {
    warnings.push(
      `No usable date columns were found in "${options.fileName}". Expected either a column per date (matrix export) or a Date column with Clock in / Clock out columns.`,
    );
    problems.push({
      type: 'missing_dates',
      message: 'No date columns could be identified in this file.',
    });
  }

  if (dataRows.length > 0 && layout.nameColumn < 0) {
    problems.push({
      type: 'employee_without_punches',
      message: `No employee-name column could be identified in "${options.fileName}".`,
    });
  }

  // Finalise each record: order punches and derive first/last punch.
  for (const record of records.values()) {
    record.punches.sort((a, b) => a.minutesOfDay - b.minutesOfDay);
    record.punchCount = record.punches.length;
    record.firstPunch = record.punches.length > 0 ? record.punches[0].minutesOfDay : null;
    record.lastPunch =
      record.punches.length > 0 ? record.punches[record.punches.length - 1].minutesOfDay : null;
    if (record.punchCount === 0 && record.markers.length === 0 && record.cells.length > 0) {
      const rawValues = record.cells.map((cell) => cell.raw).filter(Boolean);
      if (rawValues.length > 0 && rawValues.some((value) => value.trim() !== '')) {
        record.parseWarnings.push(
          `No time could be read from "${rawValues.join(' | ')}" — the day is reported as a parsing problem, not as an absence.`,
        );
      }
    }
  }

  const employeeList = [...employees.values()];

  // employees that never produced a punch
  const employeeWithPunches = new Set<string>();
  for (const record of records.values()) {
    if (record.punchCount > 0) employeeWithPunches.add(record.employeeId);
  }
  for (const employee of employeeList) {
    if (!employeeWithPunches.has(employee.id)) {
      problems.push({
        type: 'employee_without_punches',
        message: `"${employee.name}" has no readable punch in "${options.fileName}".`,
        raw: employee.rawRow ? JSON.stringify(employee.rawRow) : undefined,
      });
    }
  }

  const summary: AttendanceFileSummary = {
    fileId: options.fileId,
    fileName: options.fileName,
    format: layout.format,
    delimiter,
    headerRowIndex: layout.headerRowIndex,
    headers: headerRow.map((cell) => String(cell ?? '').trim()),
    employeeColumn: layout.nameColumn >= 0 ? (headerRow[layout.nameColumn] ?? `column ${layout.nameColumn + 1}`) : null,
    idColumn: layout.idColumn !== null ? (headerRow[layout.idColumn] ?? null) : null,
    departmentColumn:
      layout.departmentColumn !== null ? (headerRow[layout.departmentColumn] ?? null) : null,
    dateColumns: layout.dateColumns.map((column) => ({
      column: column.label,
      date: column.date,
      raw: column.raw,
    })),
    rowCount: dataRows.length,
    employeeCount: employeeList.length,
    recordCount: records.size,
    punchCount: punches.length,
    markersFound: [...markersFound],
    warnings,
    detectedDateFormat:
      detected.order === 'DMY' ? 'day/month/year' : 'month/day/year',
  };

  if (layout.dateColumns.length === 0 && layout.format === 'matrix' && dataRows.length > 0) {
    warnings.push(
      'No date columns detected — every column was treated as non-attendance data. Verify the header row in the validation panel.',
    );
  }

  return { employees: employeeList, records: [...records.values()], punches, warnings, problems, summary };
}

/* ------------------------------------------------------------------ *
 * Layout-specific parsers
 * ------------------------------------------------------------------ */

interface LayoutContext {
  dataRows: { row: string[]; rowNumber: number }[];
  layout: AttendanceLayout;
  options: AttendanceParseOptions;
  effectiveOrder: DateOrder;
  detectedOrder: 'MDY' | 'DMY';
  ensureEmployee: (
    rawName: string,
    rawCode: string | null,
    department: string | null,
    rowNumber: number,
    rawRow: Record<string, string>,
  ) => AttendanceEmployee | null;
  pushRecord: (
    employee: AttendanceEmployee,
    date: string,
    cell: AttendanceCell,
    rowNumber: number,
    columnLabel: string,
  ) => void;
  problems: AttendanceParseResult['problems'];
  warnings: string[];
}

function rawRowObject(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = header || `column ${index + 1}`;
    out[key] = String(row[index] ?? '');
  });
  return out;
}

function parseMatrixLayout(context: LayoutContext): void {
  const { dataRows, layout, options, pushRecord, ensureEmployee } = context;

  for (const { row, rowNumber } of dataRows) {
    const nameCell = String(row[layout.nameColumn] ?? '').trim();
    const codeCell =
      layout.idColumn !== null ? String(row[layout.idColumn] ?? '').trim() || null : null;
    const department =
      layout.departmentColumn !== null
        ? String(row[layout.departmentColumn] ?? '').trim() || null
        : null;

    if (!nameCell && !codeCell) continue;
    if (NAME_COLUMN_PATTERN.test(nameCell)) continue; // repeated header

    const employee = ensureEmployee(
      nameCell,
      codeCell,
      department,
      rowNumber,
      rawRowObject(layout.headers, row),
    );
    if (!employee) continue;

    for (const column of layout.dateColumns) {
      if (!column.date) continue;
      const raw = String(row[column.index] ?? '');
      const cell = parseAttendanceCell(raw, {
        fileId: options.fileId,
        fileName: options.fileName,
        rowNumber,
        columnLabel: column.label,
      });
      if (cell.raw === '' && cell.punches.length === 0 && cell.markers.length === 0) continue;
      pushRecord(employee, column.date, cell, rowNumber, column.label);
    }
  }
}

function parseLongLayout(context: LayoutContext): void {
  const { dataRows, layout, options, effectiveOrder, detectedOrder, pushRecord, ensureEmployee } =
    context;

  for (const { row, rowNumber } of dataRows) {
    const nameCell = String(row[layout.nameColumn] ?? '').trim();
    const codeCell =
      layout.idColumn !== null ? String(row[layout.idColumn] ?? '').trim() || null : null;
    const department =
      layout.departmentColumn !== null
        ? String(row[layout.departmentColumn] ?? '').trim() || null
        : null;
    if (!nameCell && !codeCell) continue;
    if (NAME_COLUMN_PATTERN.test(nameCell)) continue;

    let dateIso: string | null = null;
    if (layout.longDateColumn !== null) {
      const rawDate = String(row[layout.longDateColumn] ?? '').trim();
      const parsed = parseLooseDate(rawDate, {
        order: effectiveOrder,
        fallbackYear: options.fallbackYear,
        defaultOrder: detectedOrder,
      });
      if (parsed) dateIso = parsed.iso;
      else if (rawDate) {
        context.problems.push({
          type: 'malformed_time',
          message: `Could not read the date "${rawDate}".`,
          rowNumber,
          column: layout.headers[layout.longDateColumn] ?? 'date',
          raw: rawDate,
        });
      }
    }

    const timeCells: {
      text: string;
      columnLabel: string;
      rowNumber: number;
      cell: AttendanceCell;
    }[] = [];

    for (const column of layout.longTimeColumns) {
      const raw = String(row[column] ?? '');
      const label = layout.headers[column] ?? `column ${column + 1}`;
      const cell = parseAttendanceCell(raw, {
        fileId: options.fileId,
        fileName: options.fileName,
        rowNumber,
        columnLabel: label,
      });
      if (cell.punches.length > 0 || cell.markers.length > 0) {
        timeCells.push({ text: raw, columnLabel: label, rowNumber, cell });
      }
    }

    if (layout.longDateTimeColumn !== null) {
      const raw = String(row[layout.longDateTimeColumn] ?? '');
      const parsed = parseLooseDate(raw, {
        order: effectiveOrder,
        fallbackYear: options.fallbackYear,
        defaultOrder: detectedOrder,
      });
      if (parsed) dateIso = dateIso ?? parsed.iso;
      const cell = parseAttendanceCell(raw, {
        fileId: options.fileId,
        fileName: options.fileName,
        rowNumber,
        columnLabel: layout.headers[layout.longDateTimeColumn] ?? 'timestamp',
      });
      if (cell.punches.length > 0) {
        timeCells.push({
          text: raw,
          columnLabel: layout.headers[layout.longDateTimeColumn] ?? 'timestamp',
          rowNumber,
          cell,
        });
      }
    }

    const employee = ensureEmployee(
      nameCell,
      codeCell,
      department,
      rowNumber,
      rawRowObject(layout.headers, row),
    );
    if (!employee) continue;

    if (!dateIso) {
      if (timeCells.length > 0) {
        context.problems.push({
          type: 'malformed_time',
          message: `Row ${rowNumber} has punches but no readable date — the row was kept but cannot be placed on a day.`,
          rowNumber,
          raw: row.join(','),
        });
      }
      continue;
    }

    if (timeCells.length === 0) {
      // Explicit status-only row (e.g. "ABSENT" in the status column)
      const statusColumn = layout.headers.findIndex((header) =>
        /status|remarks?|notes?|attendance/i.test(String(header)),
      );
      if (statusColumn >= 0) {
        const raw = String(row[statusColumn] ?? '');
        const cell = parseAttendanceCell(raw, {
          fileId: options.fileId,
          fileName: options.fileName,
          rowNumber,
          columnLabel: layout.headers[statusColumn] ?? 'status',
        });
        if (cell.markers.length > 0 || cell.raw) {
          pushRecord(employee, dateIso, cell, rowNumber, layout.headers[statusColumn] ?? 'status');
        }
      }
      continue;
    }

    const markerSet = new Set<string>();
    for (const entry of timeCells) entry.cell.markers.forEach((marker) => markerSet.add(marker));
    const merged: AttendanceCell = {
      raw: timeCells.map((entry) => entry.text).join(' | '),
      punches: timeCells.flatMap((entry) => entry.cell.punches),
      markers: [...markerSet],
      parseWarnings: timeCells.flatMap((entry) => entry.cell.parseWarnings),
    };
    pushRecord(
      employee,
      dateIso,
      merged,
      rowNumber,
      timeCells.map((entry) => entry.columnLabel).join(' + '),
    );
  }
}

/** A one-line human summary used in the file validation panel. */
export function describeAttendanceSummary(summary: AttendanceFileSummary): string {
  const parts = [
    `${summary.employeeCount} employee(s)`,
    `${summary.recordCount} employee-day record(s)`,
    `${summary.punchCount} punch(es)`,
    summary.dateColumns.length > 0 ? `${summary.dateColumns.length} date column(s)` : 'no date columns',
  ];
  return `${summary.format === 'long' ? 'Long/transactional' : 'Matrix'} layout — ${parts.join(', ')}.`;
}

/** Weekday restriction helper used by the audit rules. */
export function isWeekend(iso: string, weekendDays: number[]): boolean {
  return weekendDays.includes(weekdayIndex(iso));
}
