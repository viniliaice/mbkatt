import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  evaluateBiometric,
  lateCutoffFor,
  resolveWorkingDay,
  settingsWithDefaults,
} from '../src/lib/rules';
import type { AttendanceRecord } from '../src/lib/types';

const settings = settingsWithDefaults(DEFAULT_SETTINGS);

function record(date: string, punches: number[], markers: string[] = []): AttendanceRecord {
  return {
    key: `e1__${date}`,
    employeeId: 'e1',
    date,
    cells: [
      {
        raw: punches.map((m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`).join(','),
        punches: punches.map((minutes, order) => ({
          minutesOfDay: minutes,
          text: 'x',
          rawCell: 'x',
          order,
          fileId: 'f1',
          fileName: 'attendence.csv',
          rowNumber: 2,
          columnLabel: date,
        })),
        markers,
        parseWarnings: [],
      },
    ],
    punches: punches.map((minutes, order) => ({
      minutesOfDay: minutes,
      text: 'x',
      rawCell: 'x',
      order,
      fileId: 'f1',
      fileName: 'attendence.csv',
      rowNumber: 2,
      columnLabel: date,
    })),
    firstPunch: punches.length ? Math.min(...punches) : null,
    lastPunch: punches.length ? Math.max(...punches) : null,
    punchCount: punches.length,
    markers,
    parseWarnings: [],
    sourceFileIds: ['f1'],
  };
}

const evaluate = (params: Partial<Parameters<typeof evaluateBiometric>[0]>) =>
  evaluateBiometric({
    date: '2026-09-01',
    employeeName: 'Ikram Axmed',
    record: null,
    settings,
    attendanceDataAvailable: true,
    employeeKnownToAttendance: true,
    ...params,
  });

describe('working day rules', () => {
  it('treats Friday as the weekend by default', () => {
    expect(resolveWorkingDay('2026-09-04', settings).isWorkingDay).toBe(false);
    expect(resolveWorkingDay('2026-09-03', settings).isWorkingDay).toBe(true);
  });

  it('supports holiday and extra-working-day overrides', () => {
    const custom = settingsWithDefaults({
      ...settings,
      holidayDates: ['2026-09-07'],
      extraWorkingDates: ['2026-09-04'],
    });
    expect(resolveWorkingDay('2026-09-07', custom).isWorkingDay).toBe(false);
    expect(resolveWorkingDay('2026-09-04', custom).isWorkingDay).toBe(true);
  });

  it('uses 06:45 on ordinary days and 08:00 on Thursday', () => {
    expect(lateCutoffFor('2026-09-01', settings).minutes).toBe(6 * 60 + 45);
    expect(lateCutoffFor('2026-09-03', settings).minutes).toBe(8 * 60);
  });
});

describe('late calculation', () => {
  it('does not flag a punch exactly at the cut-off', () => {
    const result = evaluate({ record: record('2026-09-01', [405, 900]) });
    expect(result.isLate).toBe(false);
    expect(result.status).toBe('PRESENT');
  });

  it('flags a punch one minute after the cut-off', () => {
    const result = evaluate({ record: record('2026-09-01', [406, 900]) });
    expect(result.isLate).toBe(true);
    expect(result.lateByMinutes).toBe(1);
    expect(result.status).toBe('LATE');
  });

  it('applies the Thursday cut-off', () => {
    const onTime = evaluate({ date: '2026-09-03', record: record('2026-09-03', [480, 900]) });
    expect(onTime.isLate).toBe(false);
    const late = evaluate({ date: '2026-09-03', record: record('2026-09-03', [481, 900]) });
    expect(late.isLate).toBe(true);
  });

  it('uses the first punch, not the longest or last', () => {
    const result = evaluate({ record: record('2026-09-01', [900, 380, 700]) });
    expect(result.firstPunch).toBe(380);
    expect(result.isLate).toBe(false);
  });

  it('records the calculation as evidence', () => {
    const result = evaluate({ record: record('2026-09-01', [406, 900]) });
    const evidence = result.evidence.find((item) => item.label === 'Late calculation');
    expect(evidence?.detail).toMatch(/06:46/);
    expect(evidence?.detail).toMatch(/cut-off/);
  });
});

describe('absence calculation', () => {
  it('marks a working day without any punch as absent when configured', () => {
    const result = evaluate({ record: null });
    expect(result.status).toBe('ABSENT');
    expect(result.isAbsent).toBe(true);
  });

  it('does not convert a missing punch into an absence when the setting is off', () => {
    const custom = settingsWithDefaults({ ...settings, treatNoPunchAsAbsent: false });
    const result = evaluate({ record: null, settings: custom });
    expect(result.status).toBe('NO_RECORD');
    expect(result.isAbsent).toBe(false);
  });

  it('reports an unreadable cell as a parsing problem, never as an absence', () => {
    const broken = record('2026-09-01', []);
    broken.parseWarnings.push('No time could be read from "6.3B".');
    const result = evaluate({ record: broken });
    expect(result.status).toBe('PARSE_ISSUE');
    expect(result.isAbsent).toBeNull();
    expect(result.caveats.join(' ')).toMatch(/parsing problem/i);
  });

  it('never reports absence when no attendance file covers the date', () => {
    const result = evaluate({ record: null, attendanceDataAvailable: false });
    expect(result.status).toBe('DATA_UNAVAILABLE');
    expect(result.isAbsent).toBeNull();
  });

  it('honours an explicit ABSENT marker in the file', () => {
    const result = evaluate({ record: record('2026-09-01', [], ['ABSENT']) });
    expect(result.status).toBe('ABSENT');
    expect(result.absentReason).toMatch(/marks this day/);
  });
});

describe('early departures', () => {
  it('detects leaving before the threshold', () => {
    const result = evaluate({ record: record('2026-09-01', [380, 700]) });
    expect(result.leftEarly).toBe(true);
    expect(result.status).toBe('PRESENT_LEFT_EARLY');
  });

  it('is disabled from settings', () => {
    const custom = settingsWithDefaults({ ...settings, earlyLeaveEnabled: false });
    const result = evaluate({ record: record('2026-09-01', [380, 700]), settings: custom });
    expect(result.leftEarly).toBe(false);
    expect(result.status).toBe('PRESENT');
  });
});

describe('non-working days', () => {
  it('does not count lateness on a weekend', () => {
    const result = evaluate({ date: '2026-09-04', record: record('2026-09-04', [600, 700]) });
    expect(result.status).toBe('NON_WORKING_DAY');
    expect(result.isLate).toBe(false);
  });
});
