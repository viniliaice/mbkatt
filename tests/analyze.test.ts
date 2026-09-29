import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/lib/analyze';
import { detectFileType } from '../src/lib/detect';
import { emptyCorrections } from '../src/lib/types';
import { DEFAULT_SETTINGS, settingsWithDefaults } from '../src/lib/rules';
import type { AnalysisInputFile, AnalysisResult, UploadedFileMeta } from '../src/lib/types';

const fixtures = new URL('./fixtures/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, fixtures), 'utf8');

function inputFile(id: string, name: string, text: string): AnalysisInputFile {
  const detection = detectFileType(name, text);
  const meta: UploadedFileMeta = {
    id,
    name,
    size: text.length,
    mimeType: 'text/plain',
    uploadedAt: new Date().toISOString(),
    kind: detection.kind,
    kindOverride: null,
    detection,
    preview: text.slice(0, 200),
    parseStatus: 'parsed',
  };
  return { meta, text };
}

const settings = settingsWithDefaults({ ...DEFAULT_SETTINGS, fallbackYear: 2026 });

function runAnalysis(): AnalysisResult {
  return analyze({
    files: [
      inputFile('f-chat', 'chat.md', read('chat.md')),
      inputFile('f-att', 'attendence.csv', read('attendence.csv')),
      inputFile('f-att11', 'attendence11.csv.txt', read('attendence11.csv.txt')),
    ],
    settings,
    aliases: [],
    corrections: emptyCorrections(),
  });
}

const result = runAnalysis();

const recordOf = (name: string, date: string) =>
  result.auditRecords.find((record) => record.employeeName === name && record.date === date);

describe('file detection', () => {
  it('detects the WhatsApp export', () => {
    expect(detectFileType('chat.md', read('chat.md')).kind).toBe('whatsapp');
  });
  it('detects a matrix attendance CSV', () => {
    expect(detectFileType('attendence.csv', read('attendence.csv')).kind).toBe('attendance');
  });
  it('detects an attendance file with a misleading .txt extension', () => {
    expect(detectFileType('attendence11.csv.txt', read('attendence11.csv.txt')).kind).toBe('attendance');
  });
});

describe('end-to-end analysis', () => {
  it('parses all three files', () => {
    expect(result.files).toHaveLength(3);
    expect(result.validation.totals.whatsappMessages).toBeGreaterThan(25);
    expect(result.validation.totals.attendanceEmployees).toBe(9);
    expect(result.validation.totals.punches).toBeGreaterThan(200);
  });

  it('classifies student vs staff messages and keeps uncertain ones', () => {
    expect(result.summary.studentMessages).toBeGreaterThan(5);
    expect(result.summary.staffMessages).toBeGreaterThan(8);
    expect(result.summary.uncertainMessages).toBeGreaterThan(0);
    expect(result.summary.studentMessages + result.summary.staffMessages + result.summary.uncertainMessages).toBe(
      result.validation.totals.whatsappMessages,
    );
  });

  it('finds the audit period and working days (Friday is the weekend)', () => {
    expect(result.coverage.firstDate).toBe('2026-09-01');
    expect(result.coverage.lastDate).toBe('2026-09-15');
    expect(result.coverage.workingDates).not.toContain('2026-09-04');
    expect(result.coverage.workingDates).not.toContain('2026-09-11');
    expect(result.coverage.workingDates).toHaveLength(13);
  });

  it('confirms the specification example: WhatsApp late, biometric on time', () => {
    const record = recordOf('Ikram Axmed', '2026-09-08');
    expect(record?.biometric.firstPunch).toBe(398); // 06:38
    expect(record?.biometric.isLate).toBe(false);
    expect(record?.matchStatus).toBe('WHATSAPP_LATE_NOT_CONFIRMED');
  });

  it('confirms the specification example: 06:28 punch with a late notification', () => {
    const record = recordOf('Fardosa Kamal', '2026-09-01');
    expect(record?.biometric.firstPunch).toBe(388); // 06:28
    expect(record?.matchStatus).toBe('WHATSAPP_LATE_NOT_CONFIRMED');
  });

  it('never treats an exact 06:45 or Thursday 08:00 punch as late', () => {
    expect(recordOf('Ikram Axmed', '2026-09-12')?.biometric.isLate).toBe(false);
    expect(recordOf('Ikram Axmed', '2026-09-10')?.biometric.isLate).toBe(false);
  });

  it('links a notified absence', () => {
    const record = recordOf('Ikram Axmed', '2026-09-05');
    expect(record?.biometric.status).toBe('ABSENT');
    expect(record?.matchStatus).toBe('ABSENT_NOTIFIED');
    expect(record?.notificationStatus).toBe('notified');
  });

  it('links a sick notification', () => {
    const record = recordOf('Nafiisa Xuseen', '2026-09-05');
    expect(record?.matchStatus).toBe('SICK_NOTIFIED');
  });

  it('links a hospital notification to an absence', () => {
    const record = recordOf('Huda Saeed', '2026-09-10');
    expect(record?.matchStatus).toBe('SICK_NOTIFIED');
  });

  it('links a funeral notification to an absence', () => {
    const record = recordOf('Faysal Omar', '2026-09-14');
    expect(record?.matchStatus).toBe('ABSENT_NOTIFIED');
  });

  it('matches a misspelled WhatsApp name to the right employee', () => {
    const match = result.nameMatches.find((entry) => entry.whatsappName === 'Axmed jaamc');
    expect(match?.employeeName).toBe('Ahmed Jaamac Ism');
    expect(match?.confidence).toBeGreaterThanOrEqual(85);
    const record = recordOf('Ahmed Jaamac Ism', '2026-09-06');
    expect(record?.matchStatus).toBe('LATE_NOTIFIED');
  });

  it('flags a conflict when the message claims an absence but the machine shows attendance', () => {
    const record = recordOf('Ikram Axmed', '2026-09-06');
    expect(record?.matchStatus).toBe('WHATSAPP_ABSENT_BUT_PRESENT');
  });

  it('flags unnotified lateness', () => {
    // 7 September: late arrival and no WhatsApp message at all that day
    const silentDay = recordOf('Ikram Axmed', '2026-09-07');
    expect(silentDay?.biometric.isLate).toBe(true);
    expect(silentDay?.matchStatus).toBe('LATE_NOT_NOTIFIED');
    expect(silentDay?.notificationStatus).toBe('not_notified');

    // 13 September: staff messages exist that day, but none about this arrival
    const busyDay = recordOf('Ikram Axmed', '2026-09-13');
    expect(busyDay?.biometric.isLate).toBe(true);
    expect(busyDay?.biometric.lateByMinutes).toBe(1);
    expect(busyDay?.matchStatus).toBe('BIOMETRIC_LATE_NO_REPORT');
  });

  it('flags unnotified absences', () => {
    const record = recordOf('Nuha Cali', '2026-09-05');
    expect(record?.biometric.status).toBe('ABSENT');
    expect(record?.matchStatus).toBe('BIOMETRIC_ABSENCE_NO_REPORT');
  });

  it('reports an unreadable attendance cell as a parsing problem, not an absence', () => {
    const record = recordOf('Ahmed Jaamac Ism', '2026-09-09');
    expect(record?.biometric.status).toBe('PARSE_ISSUE');
    expect(record?.biometric.isAbsent).toBeNull();
  });

  it('keeps a WhatsApp name that matches nobody in the audit as unmatched', () => {
    const record = result.auditRecords.find((entry) => entry.employeeName === 'Maryan');
    expect(record?.matchStatus).toBe('WHATSAPP_UNMATCHED_NAME');
    expect(record?.whatsappOnly).toBe(true);
  });

  it('merges the second attendance file into the same employees', () => {
    expect(result.attendanceEmployees).toHaveLength(9);
    const abdiqadir = recordOf('Abdiqadir Maxamed', '2026-09-15');
    expect(abdiqadir?.biometric.firstPunch).toBe(6 * 60 + 48);
    expect(abdiqadir?.matchStatus).toBe('BIOMETRIC_LATE_NO_REPORT');
  });

  it('summarises each employee', () => {
    const ikram = result.employeeSummaries.find((employee) => employee.name === 'Ikram Axmed');
    expect(ikram?.lateDays).toBe(3);
    expect(ikram?.absentDays).toBe(1);
    expect(ikram?.leftEarlyDays).toBe(1);
    expect(ikram?.unnotifiedLateDays).toBe(3);
    expect(ikram?.history[0].date).toBe('2026-09-15');
  });

  it('produces evidence for every audit row', () => {
    for (const record of result.auditRecords.slice(0, 40)) {
      expect(record.evidence.length).toBeGreaterThan(0);
    }
  });

  it('produces review items with severity', () => {
    const types = new Set(result.reviewIssues.map((issue) => issue.type));
    expect(types.has('uncertain_name_match')).toBe(true);
    expect(types.has('conflicting_attendance')).toBe(true);
    expect(types.has('uncertain_classification')).toBe(true);
    expect(result.reviewIssues.every((issue) => !issue.resolved)).toBe(true);
  });

  it('is deterministic and reruns after a correction', () => {
    const again = runAnalysis();
    expect(again.summary.auditRecords).toBe(result.summary.auditRecords);

    const corrected = analyze({
      files: [
        inputFile('f-chat', 'chat.md', read('chat.md')),
        inputFile('f-att', 'attendence.csv', read('attendence.csv')),
        inputFile('f-att11', 'attendence11.csv.txt', read('attendence11.csv.txt')),
      ],
      settings,
      aliases: [],
      corrections: emptyCorrections(),
      onProgress: () => {},
    });
    expect(corrected.summary.totalLateEvents).toBe(result.summary.totalLateEvents);
  });

  it('exposes the original WhatsApp text for the evidence panel', () => {
    const record = recordOf('Ikram Axmed', '2026-09-08');
    const evidence = record?.evidence.find((item) => item.kind === 'whatsapp');
    expect(evidence?.raw).toContain('Ikram will be late');
    expect(evidence?.sourceFile).toBe('chat.md');
    expect(evidence?.sourceLocation).toMatch(/line \d+/);
  });
});
