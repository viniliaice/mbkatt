import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/lib/analyze';
import { emptyCorrections } from '../src/lib/types';
import {
  isOleBinaryXls,
  isZipOoxml,
  isExcelWorkbook,
  sniffExcelFormat,
  parseDuration,
  parseCompoundDays,
  classifyWorksheet,
  parseExcelWorkbook,
} from '../src/lib/parsers/excelWorkbook';

const xlsBuffer = readFileSync(new URL('./fixtures/150_StandardReport.xls', import.meta.url));

describe('Excel format sniffing', () => {
  it('detects legacy OLE/BIFF XLS binary workbook from magic bytes', () => {
    expect(isOleBinaryXls(xlsBuffer)).toBe(true);
    expect(isZipOoxml(xlsBuffer)).toBe(false);
    expect(isExcelWorkbook(xlsBuffer, '150_StandardReport.xls')).toBe(true);
    const sniff = sniffExcelFormat(xlsBuffer, '150_StandardReport.xls');
    expect(sniff.isLegacy).toBe(true);
    expect(sniff.isExcel).toBe(true);
    expect(sniff.formatDescription).toBe('Microsoft Excel 97-2003 Workbook (.xls)');
  });
});

describe('Duration parser', () => {
  it('parses large durations like 143:45 correctly (NOT as time of day)', () => {
    const dur = parseDuration('143:45');
    expect(dur).not.toBeNull();
    expect(dur?.hours).toBe(143);
    expect(dur?.minutes).toBe(45);
    expect(dur?.totalMinutes).toBe(143 * 60 + 45); // 8625
    expect(dur?.totalHours).toBeCloseTo(143.75, 2);
    expect(dur?.raw).toBe('143:45');
  });

  it('parses small durations like 0:10 and 0:00', () => {
    const dur1 = parseDuration('0:10');
    expect(dur1?.totalMinutes).toBe(10);
    const dur2 = parseDuration('0:00');
    expect(dur2?.totalMinutes).toBe(0);
  });

  it('parses other durations from spec: 93:14, 81:15, 90:51, 97:00', () => {
    expect(parseDuration('93:14')?.totalMinutes).toBe(93 * 60 + 14);
    expect(parseDuration('81:15')?.totalMinutes).toBe(81 * 60 + 15);
    expect(parseDuration('90:51')?.totalMinutes).toBe(90 * 60 + 51);
    expect(parseDuration('97:00')?.totalMinutes).toBe(97 * 60);
  });
});

describe('Compound days parser', () => {
  it('parses 23/19 into normal and real days preserving original string', () => {
    const comp = parseCompoundDays('23/19');
    expect(comp?.normalDays).toBe(23);
    expect(comp?.realDays).toBe(19);
    expect(comp?.raw).toBe('23/19');
  });

  it('parses other ratios from spec: 23/1, 23/15, 23/18, 23/0, 23/11', () => {
    expect(parseCompoundDays('23/1')).toEqual({ normalDays: 23, realDays: 1, raw: '23/1' });
    expect(parseCompoundDays('23/15')).toEqual({ normalDays: 23, realDays: 15, raw: '23/15' });
    expect(parseCompoundDays('23/18')).toEqual({ normalDays: 23, realDays: 18, raw: '23/18' });
    expect(parseCompoundDays('23/0')).toEqual({ normalDays: 23, realDays: 0, raw: '23/0' });
    expect(parseCompoundDays('23/11')).toEqual({ normalDays: 23, realDays: 11, raw: '23/11' });
  });
});

describe('Sheet classification', () => {
  it('classifies all 5 standard sheets with high confidence', () => {
    expect(classifyWorksheet('Schedule Information Report', []).type).toBe('SCHEDULE');
    expect(classifyWorksheet('Schedule Information Report', []).confidence).toBeGreaterThanOrEqual(95);

    expect(classifyWorksheet('Att. Stat.', []).type).toBe('ATTENDANCE_STATISTICS');
    expect(classifyWorksheet('Att. Stat.', []).confidence).toBeGreaterThanOrEqual(95);

    expect(classifyWorksheet('Att.log report', []).type).toBe('ATTENDANCE_LOG');
    expect(classifyWorksheet('Att.log report', []).confidence).toBeGreaterThanOrEqual(95);

    expect(classifyWorksheet('Exception Stat.', []).type).toBe('EXCEPTION_REPORT');
    expect(classifyWorksheet('Exception Stat.', []).confidence).toBeGreaterThanOrEqual(95);

    expect(classifyWorksheet('Statistical Report of Attendan', []).type).toBe('ATTENDANCE_SUMMARY');
    expect(classifyWorksheet('Statistical Report of Attendan', []).confidence).toBeGreaterThanOrEqual(95);
  });
});

describe('150_StandardReport.xls full parsing', () => {
  const result = parseExcelWorkbook(xlsBuffer, {
    fileId: 'xls-150',
    fileName: '150_StandardReport.xls',
    dateOrder: 'auto',
    fallbackYear: 2026,
  });

  it('detects and parses all 5 sheets', () => {
    expect(result.meta.sheetCount).toBe(5);
    expect(result.meta.sheets).toHaveLength(5);
    for (const sheet of result.meta.sheets) {
      expect(sheet.status).toBe('Parsed');
      expect(sheet.recordCount).toBeGreaterThan(0);
    }
  });

  it('extracts all 127 canonical employees across sheets matching by ID', () => {
    expect(result.canonicalEmployees).toHaveLength(127);
    const axmed = result.canonicalEmployees.find((e) => e.id === '1193');
    expect(axmed).toBeDefined();
    expect(axmed?.name).toBe('axmed xasan axmed');
    expect(axmed?.department).toBe('Teacher');

    const ikram = result.canonicalEmployees.find((e) => e.id === '1122');
    expect(ikram).toBeDefined();
    expect(ikram?.name).toBe('Ikram Axmed');

    const abdiqadir = result.canonicalEmployees.find((e) => e.id === '1132');
    expect(abdiqadir).toBeDefined();
    expect(abdiqadir?.department).toBe('Office');
  });

  it('parses special shifts (25 = leave, 26 = out, null = holiday)', () => {
    // Axmed (1193) has 25 on Sep 12 and 26 on Sep 24
    const sep12Record = result.records.find((r) => r.employeeId === '1193' && r.date === '2026-09-12');
    expect(sep12Record).toBeDefined();
    expect(sep12Record?.specialShift?.code).toBe(25);
    expect(sep12Record?.markers).toContain('LEAVE');

    const sep24Record = result.records.find((r) => r.employeeId === '1193' && r.date === '2026-09-24');
    expect(sep24Record).toBeDefined();
    expect(sep24Record?.specialShift?.code).toBe(26);
    expect(sep24Record?.markers).toContain('OUT');
  });

  it('parses multiple punches in a cell (e.g. 06:26 06:27 13:11 14:01 on Sep 7)', () => {
    const sep7 = result.records.find((r) => r.employeeId === '1193' && r.date === '2026-09-07');
    expect(sep7).toBeDefined();
    expect(sep7?.punchCount).toBe(4);
    expect(sep7?.firstPunch).toBe(386); // 06:26
    expect(sep7?.lastPunch).toBe(841); // 14:01
  });

  it('calculates late duration accurately (e.g. Sep 2 first punch 06:53 -> 8 mins late)', () => {
    const sep2 = result.records.find((r) => r.employeeId === '1193' && r.date === '2026-09-02');
    expect(sep2).toBeDefined();
    expect(sep2?.lateDurationMinutes).toBe(8);
  });

  it('calculates Thursday late duration accurately (cutoff 08:00, first punch 08:21 -> 21 mins late)', () => {
    const sep3 = result.records.find((r) => r.employeeId === '1193' && r.date === '2026-09-03');
    expect(sep3).toBeDefined();
    expect(sep3?.lateDurationMinutes).toBe(21);
  });

  it('confirms Ikram is on-time on Sep 8 with 06:38 punch (cutoff 06:45)', () => {
    const sep8 = result.records.find((r) => r.employeeId === '1122' && r.date === '2026-09-08');
    expect(sep8).toBeDefined();
    expect(sep8?.firstPunch).toBe(398); // 06:38
    expect(sep8?.lateDurationMinutes).toBe(0); // ON TIME!
  });

  it('records cell diagnostics with coordinates, raw values, and parsed values', () => {
    expect(result.diagnostics.length).toBeGreaterThan(50);
    const ratioDiag = result.diagnostics.find((d) => d.detectedType === 'Attendance ratio');
    expect(ratioDiag).toBeDefined();
    expect(ratioDiag?.status).toBe('SUCCESS');
    expect(ratioDiag?.rawValue).toBe('23/19');
  });

  it('runs analyze() end-to-end on 150_StandardReport.xls', () => {
    const analysis = analyze({
      files: [
        {
          meta: {
            id: 'f-xls',
            name: '150_StandardReport.xls',
            size: xlsBuffer.length,
            mimeType: 'application/vnd.ms-excel',
            uploadedAt: new Date().toISOString(),
            kind: 'attendance',
            kindOverride: null,
            detection: { kind: 'attendance', confidence: 1, reasons: [] },
            preview: '',
            parseStatus: 'parsed',
          },
          text: '',
          buffer: xlsBuffer,
        },
      ],
      settings: null,
      aliases: [],
      corrections: emptyCorrections(),
    });
    console.log('Audit records count:', analysis.auditRecords.length);
    console.log('Working dates count:', analysis.coverage.workingDates.length);
    console.log('Coverage dates count:', analysis.coverage.dates.length);
    console.log('Attendance dates:', analysis.coverage.attendanceFirstDate, analysis.coverage.attendanceLastDate);
    console.log('Total late arrivals in summary:', analysis.summary.unnotifiedLateArrivals);
    console.log('Total absences in summary:', analysis.summary.unnotifiedAbsences);
  });
});
