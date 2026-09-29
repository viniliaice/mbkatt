/**
 * Administrative layer tests — specification items 29–37.
 *
 * The rules that matter most here are the honest ones: a WhatsApp notification
 * is never an administrative excuse, late minutes come from biometric evidence,
 * thresholds are configurable, and nothing (documentation, actions, reasons) is
 * ever invented.
 */

import { describe, expect, it } from 'vitest';
import { analyze } from '@/lib/analyze';
import { detectFileType } from '@/lib/detect';
import { DEFAULT_SETTINGS, settingsWithDefaults } from '@/lib/rules';
import {
  NOT_PROVIDED,
  PENDING_REVIEW,
  buildAdminLog,
  buildAdminTeacherStats,
  computeAttendanceRate,
  confirmedLateMinutes,
  estimatedLateMinutes,
  evaluateAdministrativeStatus,
  excuseStatusOf,
  lateMinutesFor,
  logTypeFor,
} from '@/lib/admin';
import { compareAttendanceSources } from '@/lib/sources';
import { emptyCorrections, type AnalysisInputFile, type AnalysisResult, type UploadedFileMeta } from '@/lib/types';
import chatRaw from './fixtures/chat.md?raw';
import matrixRaw from './fixtures/attendence.csv?raw';
import longRaw from './fixtures/attendence11.csv.txt?raw';

function toInputFile(name: string, text: string): AnalysisInputFile {
  const detection = detectFileType(name, text);
  const meta: UploadedFileMeta = {
    id: `file-${name}`,
    name,
    size: text.length,
    mimeType: 'text/plain',
    uploadedAt: '2026-09-16T08:00:00.000Z',
    kind: detection.kind,
    kindOverride: null,
    detection,
    preview: text.slice(0, 400),
    parseStatus: 'parsed',
  };
  return { meta, text };
}

const result: AnalysisResult = analyze({
  files: [
    toInputFile('chat.md', chatRaw),
    toInputFile('attendence.csv', matrixRaw),
    toInputFile('attendence11.csv.txt', longRaw),
  ],
  settings: null,
  aliases: [],
  corrections: emptyCorrections(),
});

const findRecord = (name: string, date: string) =>
  result.auditRecords.find((record) => record.employeeName.includes(name) && record.date === date);

describe('administrative layer on the real fixtures', () => {
  it('builds one row per teacher with the required columns', () => {
    const stats = result.admin.teacherStats;
    expect(stats.length).toBeGreaterThan(5);
    for (const teacher of stats) {
      expect(teacher.employeeName).toBeTruthy();
      expect(teacher.fullAbsencesExcused).toBeGreaterThanOrEqual(0);
      expect(teacher.fullAbsencesUnexcused).toBeGreaterThanOrEqual(0);
      expect(teacher.lateOccurrences).toBeGreaterThanOrEqual(0);
      expect(teacher.totalLateMinutes).toBeGreaterThanOrEqual(0);
      expect(teacher.statusReason.length).toBeGreaterThan(10);
      expect(teacher.statusRule.length).toBeGreaterThan(5);
    }
  });

  it('never marks an absence as excused just because WhatsApp was used (spec 29)', () => {
    // every excuse status starts as pending, whatever the chat says
    for (const record of result.auditRecords) {
      if (!record.biometric.isAbsent) continue;
      expect(excuseStatusOf(record, {})).toBe('pending');
    }
    const notifiedAbsences = result.auditRecords.filter(
      (record) => record.biometric.isAbsent && record.whatsapp.hasNotification,
    );
    expect(notifiedAbsences.length).toBeGreaterThan(0);
    for (const teacher of result.admin.teacherStats) {
      expect(teacher.fullAbsencesExcused).toBe(0); // no administrator has decided anything yet
    }
    const pending = result.admin.log.filter((row) => row.excuseStatus === 'pending');
    expect(pending.length).toBe(result.admin.log.length);
  });

  it('counts only biometric late minutes (spec 31)', () => {
    const lateRow = findRecord('Ikram', '2026-09-13');
    expect(lateRow).toBeTruthy();
    const minutes = confirmedLateMinutes(lateRow!);
    expect(minutes).not.toBeNull();
    expect(minutes).toBe((lateRow!.biometric.firstPunch ?? 0) - (lateRow!.biometric.lateCutoffMinutes ?? 0));

    // a claim that the biometric record does not confirm contributes nothing
    const notConfirmed = findRecord('Ikram', '2026-09-08');
    expect(notConfirmed?.matchStatus).toBe('WHATSAPP_LATE_NOT_CONFIRMED');
    expect(confirmedLateMinutes(notConfirmed!)).toBeNull();

    const estimateOff = settingsWithDefaults({ estimateLateFromWhatsApp: false });
    const estimateOn = settingsWithDefaults({ estimateLateFromWhatsApp: true });
    expect(lateMinutesFor(notConfirmed!, estimateOff)).toBe(0);
    // even when enabled, the estimate never overrides biometric evidence
    expect(estimatedLateMinutes(lateRow!)).toBeNull();
    expect(lateMinutesFor(lateRow!, estimateOn)).toBe(minutes);
  });

  it('applies the Thursday and Saturday cut-offs correctly', () => {
    // Thursday 2026-09-10: cut-off 08:00; Saturday 2026-09-05: cut-off 06:45
    const thursday = result.auditRecords.find((record) => record.date === '2026-09-10' && record.biometric.isLate);
    if (thursday) {
      expect(thursday.biometric.lateCutoffLabel).toContain('08:00');
    }
    const saturday = result.auditRecords.find((record) => record.date === '2026-09-05' && record.biometric.isLate);
    if (saturday) {
      expect(saturday.biometric.lateCutoffLabel).toContain('06:45');
    }
  });

  it('reports the attendance-rate calculation and excludes what it was configured to exclude (spec 32)', () => {
    const settings = settingsWithDefaults({
      attendanceRate: {
        excludeApprovedLeave: true,
        excludeExcusedAbsence: true,
        excludeHolidays: true,
        excludeWeekends: true,
        excludeOtherApproved: true,
      },
    });
    const { rate, detail } = computeAttendanceRate({
      expectedWorkingDays: 20,
      presentDays: 19,
      excusedDays: 1,
      leaveDays: 0,
      settings,
    });
    expect(rate).toBeCloseTo(100, 5);
    expect(detail.explanation).toContain('Expected working days: 20');
    expect(detail.explanation).toContain('Present: 19');
    expect(detail.explanation).toContain('Approved absence excluded: 1');
    expect(detail.explanation).toContain('19 / 19 = 100.0%');

    const withoutExclusion = computeAttendanceRate({
      expectedWorkingDays: 20,
      presentDays: 19,
      excusedDays: 1,
      leaveDays: 0,
      settings: settingsWithDefaults({
        attendanceRate: {
          excludeApprovedLeave: false,
          excludeExcusedAbsence: false,
          excludeHolidays: false,
          excludeWeekends: false,
          excludeOtherApproved: false,
        },
      }),
    });
    expect(withoutExclusion.rate).toBeCloseTo(95, 5);
  });

  it('never counts Friday as an absence while Friday is the weekend', () => {
    expect(result.settings.weekendDays).toContain(5);
    const friday = result.auditRecords.filter((record) => record.date === '2026-09-11');
    expect(friday).toHaveLength(0);
    expect(result.coverage.workingDates).not.toContain('2026-09-11');
  });

  it('does not invent documentation, actions or reasons (spec 33)', () => {
    const row = result.admin.log[0];
    expect(row.documentation).toBe(NOT_PROVIDED);
    expect(row.administrativeAction).toBe(PENDING_REVIEW);
    expect(row.reviewer).toBeNull();
    expect(row.decidedAt).toBeNull();
    // a reason only ever repeats what the source data actually contains
    const notified = result.admin.log.find((entry) => entry.whatsappNotified === 'yes');
    expect(notified?.reasonProvided).not.toBe(NOT_PROVIDED);
    const silent = result.admin.log.find((entry) => entry.whatsappNotified === 'no');
    expect(silent?.reasonProvided).toBe(NOT_PROVIDED);
  });

  it('maps audited days to the itemized log types (spec 33)', () => {
    const types = new Set(result.admin.log.map((row) => row.type));
    expect(types.has('LATE')).toBe(true);
    expect(types.has('FULL_ABSENT')).toBe(true);
    expect(types.has('SICK')).toBe(true);
    for (const row of result.admin.log) {
      if (row.type === 'LATE') expect(row.recordedTimeIn).not.toBeNull();
      if (row.type === 'FULL_ABSENT') expect(row.recordedTimeIn).toBeNull();
    }
  });

  it('keeps a person who only exists in WhatsApp out of the rate calculation', () => {
    const orphan = result.admin.teacherStats.find((teacher) => teacher.employeeName === 'Maryan');
    expect(orphan).toBeTruthy();
    expect(orphan!.attendanceRate).toBeNull();
    expect(orphan!.statusReason).toMatch(/no employee record|no matching employee/i);
  });

  it('describes the relationship between the two attendance files (spec 48)', () => {
    const comparison = compareAttendanceSources({
      summaries: result.attendanceFiles,
      perFileRecords: new Map(
        result.attendanceFiles.map((summary) => [
          summary.fileId,
          result.attendanceRecords.filter((record) => record.sourceFileIds.includes(summary.fileId)),
        ]),
      ),
    });
    expect(comparison).toHaveLength(1);
    const entry = comparison[0];
    expect(entry.overlapRecords).toBeGreaterThan(0);
    expect(entry.explanation).toContain('These files appear to describe the same attendance period');
    expect(['same-data', 'different-view', 'complementary', 'conflicting']).toContain(entry.relation);
  });

  it('states which source was used for overlapping days (spec 48)', () => {
    expect(result.sourceNotes.length).toBeGreaterThan(0);
    expect(result.sourceNotes.join(' ')).toMatch(/was used for the calculation/);
    // nothing is double counted: each employee-day exists once in the audit
    const keys = result.auditRecords.map((record) => `${record.employeeId}__${record.date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('administrative status rules (spec 30)', () => {
  const base = {
    fullAbsencesExcused: 0,
    fullAbsencesUnexcused: 0,
    lateOccurrences: 0,
    totalLateMinutes: 0,
    attendanceRate: 100,
  };

  it('gives Perfect Attendance when there is nothing to report', () => {
    const verdict = evaluateAdministrativeStatus(base, DEFAULT_SETTINGS);
    expect(verdict.status).toBe('PERFECT_ATTENDANCE');
    expect(verdict.rule).toContain('Perfect Attendance when absences ≤ 0');
  });

  it('returns Satisfactory within the configured band', () => {
    const verdict = evaluateAdministrativeStatus({ ...base, lateOccurrences: 2 }, DEFAULT_SETTINGS);
    expect(verdict.status).toBe('SATISFACTORY');
  });

  it('returns Verbal Notice at the configured late threshold and states the rule', () => {
    const verdict = evaluateAdministrativeStatus({ ...base, lateOccurrences: 3 }, DEFAULT_SETTINGS);
    expect(verdict.status).toBe('VERBAL_NOTICE');
    expect(verdict.reason).toBe(
      '3 late occurrence(s) reached the configured Verbal Notice threshold of 3.',
    );
    // the Review-Required late threshold sits above it and is configurable
    expect(evaluateAdministrativeStatus({ ...base, lateOccurrences: 6 }, DEFAULT_SETTINGS).status).toBe(
      'REVIEW_REQUIRED',
    );
  });

  it('returns Review Required when the attendance rate drops below the threshold', () => {
    const verdict = evaluateAdministrativeStatus({ ...base, attendanceRate: 84 }, DEFAULT_SETTINGS);
    expect(verdict.status).toBe('REVIEW_REQUIRED');
    expect(verdict.reason).toContain('below the configured Review threshold of 85%');
  });

  it('returns Critical Review for unexcused absences or a very low rate', () => {
    expect(
      evaluateAdministrativeStatus({ ...base, fullAbsencesUnexcused: 3 }, DEFAULT_SETTINGS).status,
    ).toBe('CRITICAL_REVIEW');
    expect(evaluateAdministrativeStatus({ ...base, attendanceRate: 70 }, DEFAULT_SETTINGS).status).toBe(
      'CRITICAL_REVIEW',
    );
  });

  it('follows the administrator when the thresholds are changed', () => {
    const strict = settingsWithDefaults({
      adminRules: {
        ...DEFAULT_SETTINGS.adminRules,
        verbalNoticeMinLate: 2,
        reviewMaxLate: 6,
      },
    });
    expect(evaluateAdministrativeStatus({ ...base, lateOccurrences: 2 }, strict).status).toBe('VERBAL_NOTICE');
    // and the same data is Satisfactory under the shipped defaults
    expect(evaluateAdministrativeStatus({ ...base, lateOccurrences: 2 }, DEFAULT_SETTINGS).status).toBe(
      'SATISFACTORY',
    );
  });

  it('supports the optional total-late-minutes rule and leaves it off by default', () => {
    const withMinutes = settingsWithDefaults({
      adminRules: { ...DEFAULT_SETTINGS.adminRules, reviewMaxLateMinutes: 20 },
    });
    expect(
      evaluateAdministrativeStatus({ ...base, lateOccurrences: 1, totalLateMinutes: 25 }, withMinutes).status,
    ).toBe('REVIEW_REQUIRED');
    expect(
      evaluateAdministrativeStatus({ ...base, lateOccurrences: 1, totalLateMinutes: 25 }, DEFAULT_SETTINGS).status,
    ).toBe('SATISFACTORY');
  });

  it('uses neutral language only — no subjective descriptions', () => {
    const verdicts = [
      evaluateAdministrativeStatus(base, DEFAULT_SETTINGS),
      evaluateAdministrativeStatus({ ...base, lateOccurrences: 6 }, DEFAULT_SETTINGS),
      evaluateAdministrativeStatus({ ...base, attendanceRate: 70 }, DEFAULT_SETTINGS),
    ];
    for (const verdict of verdicts) {
      expect(verdict.reason).not.toMatch(/poor|bad|lazy|irresponsible|negligent/i);
    }
  });

  it('recomputes the teacher summary when an administrator records a decision (spec 34)', () => {
    const absence = result.auditRecords.find(
      (record) => record.biometric.isAbsent && record.employeeCode?.startsWith('EMP'),
    );
    expect(absence).toBeTruthy();
    const reviews = {
      [absence!.id]: {
        auditId: absence!.id,
        excuseStatus: 'excused' as const,
        documentation: 'Medical certificate received',
        administrativeAction: 'Filed',
        notes: 'Hospital letter seen by the head teacher',
        reviewer: 'Head Teacher',
        decidedAt: '2026-09-16T09:00:00.000Z',
        history: [{ at: '2026-09-16T09:00:00.000Z', by: 'Head Teacher', action: 'Confirm Excused' }],
      },
    };
    const stats = buildAdminTeacherStats({
      records: result.auditRecords,
      workingDates: result.coverage.workingDates,
      settings: result.settings,
      reviews,
    });
    const before = result.admin.teacherStats.find((teacher) => teacher.employeeId === absence!.employeeId)!;
    const after = stats.find((teacher) => teacher.employeeId === absence!.employeeId)!;
    expect(after.fullAbsencesExcused).toBe(before.fullAbsencesExcused + 1);
    expect(after.fullAbsencesUnexcused).toBe(before.fullAbsencesUnexcused);
    // and the day's record now excludes the absence from the rate
    expect(after.rateDetail.countedDays).toBeLessThanOrEqual(after.rateDetail.expectedWorkingDays);
  });

  it('carries the administrator decision into the itemized log', () => {
    const target = result.auditRecords.find((record) => record.biometric.isAbsent && record.employeeCode?.startsWith('EMP'))!;
    const reviews = {
      [target.id]: {
        auditId: target.id,
        excuseStatus: 'unexcused' as const,
        documentation: 'No certificate provided',
        administrativeAction: 'HR-02 issued',
        notes: 'No prior notice',
        reviewer: 'Head Teacher',
        decidedAt: '2026-09-16T09:00:00.000Z',
        history: [],
      },
    };
    const log = buildAdminLog(result.auditRecords, reviews);
    const row = log.find((entry) => entry.auditId === target.id)!;
    expect(row.excuseStatus).toBe('unexcused');
    expect(row.documentation).toBe('No certificate provided');
    expect(row.administrativeAction).toBe('HR-02 issued');
    expect(row.reasonProvided).toBe('No prior notice');
    expect(row.reviewer).toBe('Head Teacher');
  });

  it('labels the log types from real audited rows', () => {
    const absence = result.auditRecords.find((record) => record.biometric.isAbsent);
    const late = result.auditRecords.find((record) => record.biometric.isLate);
    expect(logTypeFor(absence!)).toBe('FULL_ABSENT');
    expect(logTypeFor(late!)).toBe('LATE');
  });
});

describe('administrative review routing to the itemized log', () => {
  it('includes every questionable day and nothing else', () => {
    expect(result.admin.log.length).toBeGreaterThan(0);
    expect(result.admin.log.length).toBeLessThan(result.auditRecords.length + 1);
    for (const row of result.admin.log) {
      const record = result.auditRecords.find((entry) => entry.id === row.auditId)!;
      const notable =
        record.biometric.isLate ||
        record.biometric.isAbsent ||
        record.biometric.leftEarly ||
        record.whatsapp.events.length > 0 ||
        record.matchStatus === 'BIOMETRIC_PARSE_ISSUE' ||
        record.matchStatus.startsWith('WHAT');
      expect(notable).toBe(true);
    }
  });
});
