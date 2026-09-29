/**
 * Attendance rule engine.
 *
 * Turns raw punches into a *biometric* verdict, using only the administrator's
 * configured rules. Every verdict lists the evidence it used, and anything the
 * parser could not read is reported as a parsing problem rather than as an
 * absence.
 */

import { weekdayIndex, weekdayName } from './dates';
import { formatDuration, minutesToClock, parseClockValue } from './time';
import { BIOMETRIC_STATUS_LABELS } from './statuses';
import type { AttendanceRecord, BiometricEvaluation, EvidenceItem, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  // Friday is the weekend by default (Saturday–Thursday working week).
  weekendDays: [5],
  defaultLateCutoff: '06:45',
  // Thursday is the late-start day.
  lateCutoffByWeekday: { 4: '08:00' },
  earlyLeaveThreshold: '13:00',
  earlyLeaveEnabled: true,
  minValidPunches: 1,
  holidayDates: [],
  extraWorkingDates: [],
  earliestPlausiblePunch: '03:00',
  latestPlausiblePunch: '23:00',

  whatsappDateOrder: 'auto',
  attendanceDateOrder: 'auto',
  fallbackYear: null,
  treatNoPunchAsAbsent: true,

  matchedThreshold: 85,
  possibleThreshold: 62,
  useTransliterationVariants: true,
  notificationDateToleranceDays: 1,
  includeUncertainMessagesInAudit: true,

  persistToBrowser: true,
  schoolName: 'MBK School',
};

export function settingsWithDefaults(partial: Partial<Settings> | null | undefined): Settings {
  if (!partial) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    weekendDays: partial.weekendDays ?? DEFAULT_SETTINGS.weekendDays,
    lateCutoffByWeekday: { ...(partial.lateCutoffByWeekday ?? DEFAULT_SETTINGS.lateCutoffByWeekday) },
    holidayDates: partial.holidayDates ?? DEFAULT_SETTINGS.holidayDates,
    extraWorkingDates: partial.extraWorkingDates ?? DEFAULT_SETTINGS.extraWorkingDates,
  };
}

export interface WorkingDayInfo {
  isWorkingDay: boolean;
  reason: string;
}

export function resolveWorkingDay(date: string, settings: Settings): WorkingDayInfo {
  const weekday = weekdayIndex(date);
  const name = weekdayName(date);

  if (settings.holidayDates.includes(date)) {
    return { isWorkingDay: false, reason: `${name}, ${date} is configured as a holiday/closure.` };
  }
  if (settings.extraWorkingDates.includes(date)) {
    return { isWorkingDay: true, reason: `${name}, ${date} was added as an extra working day.` };
  }
  if (settings.weekendDays.includes(weekday)) {
    return { isWorkingDay: false, reason: `${name} is configured as a weekend day.` };
  }
  return { isWorkingDay: true, reason: `${name} is a configured working day.` };
}

export function lateCutoffFor(date: string, settings: Settings): { minutes: number; label: string } {
  const weekday = weekdayIndex(date);
  const override = settings.lateCutoffByWeekday[weekday];
  const raw = override ?? settings.defaultLateCutoff;
  const minutes = parseClockValue(raw) ?? parseClockValue(DEFAULT_SETTINGS.defaultLateCutoff) ?? 405;
  const label =
    override !== undefined
      ? `${weekdayName(date)} rule: late after ${minutesToClock(minutes)}`
      : `General rule: late after ${minutesToClock(minutes)}`;
  return { minutes, label };
}

export interface EvaluateParams {
  date: string;
  employeeName: string;
  record: AttendanceRecord | null;
  settings: Settings;
  /**
   * False when no attendance file covers this date at all — then "no punch"
   * means "no data", never "absent".
   */
  attendanceDataAvailable: boolean;
  /** True when the employee exists in at least one attendance file. */
  employeeKnownToAttendance: boolean;
}

export function evaluateBiometric(params: EvaluateParams): BiometricEvaluation {
  const { date, record, settings, attendanceDataAvailable, employeeKnownToAttendance } = params;
  const evidence: EvidenceItem[] = [];
  const caveats: string[] = [];

  const working = resolveWorkingDay(date, settings);
  const cutoff = lateCutoffFor(date, settings);
  const minPunches = Math.max(1, settings.minValidPunches);

  const hasRecord = Boolean(record && record.cells.length > 0);
  const punchCount = record?.punchCount ?? 0;
  const firstPunch = record?.firstPunch ?? null;
  const lastPunch = record?.lastPunch ?? null;
  const markers = record?.markers ?? [];

  const base: BiometricEvaluation = {
    date,
    isWorkingDay: working.isWorkingDay,
    workingDayReason: working.reason,
    firstPunch,
    lastPunch,
    punchCount,
    hasRecord,
    lateCutoffMinutes: working.isWorkingDay ? cutoff.minutes : null,
    lateCutoffLabel: cutoff.label,
    isLate: null,
    lateByMinutes: null,
    isAbsent: null,
    absentReason: '',
    leftEarly: null,
    leftEarlyByMinutes: null,
    onTime: null,
    status: 'NON_WORKING_DAY',
    statusLabel: BIOMETRIC_STATUS_LABELS.NON_WORKING_DAY,
    confidence: 0.9,
    caveats,
    evidence,
  };

  evidence.push({ kind: 'rule', label: 'Working-day rule', detail: working.reason });

  if (record && record.punches.length > 0) {
    const first = record.punches[0];
    evidence.push({
      kind: 'attendance',
      label: 'Biometric punches read from the file',
      detail: record.punches
        .map(
          (punch) =>
            `${minutesToClock(punch.minutesOfDay)} — cell "${punch.rawCell}" in ${punch.fileName}, row ${punch.rowNumber}, column "${punch.columnLabel}"`,
        )
        .join(' • '),
      sourceFile: first.fileName,
      sourceLocation: `row ${first.rowNumber}, column "${first.columnLabel}"`,
      raw: record.cells.map((cell) => cell.raw).join(' | '),
    });
  } else if (hasRecord) {
    const cell = record?.cells[0];
    evidence.push({
      kind: 'attendance',
      label: 'Raw attendance cell (no readable time)',
      detail: record?.cells.map((entry) => `"${entry.raw}"`).join(', ') || '(empty)',
      sourceFile: cell?.punches[0]?.fileName,
      raw: record?.cells.map((entry) => entry.raw).join(' | '),
    });
  }

  if (record && record.parseWarnings.length > 0) caveats.push(...record.parseWarnings);

  // ---------------- non-working day ----------------
  if (!working.isWorkingDay) {
    if (punchCount > 0) {
      caveats.push(
        `Punches exist on a non-working day (${record?.punches
          .map((punch) => minutesToClock(punch.minutesOfDay))
          .join(', ')}). The day is excluded from late/absence statistics.`,
      );
    }
    return {
      ...base,
      status: 'NON_WORKING_DAY',
      statusLabel: BIOMETRIC_STATUS_LABELS.NON_WORKING_DAY,
      isLate: false,
      isAbsent: false,
      onTime: punchCount > 0 ? true : null,
      confidence: 0.95,
    };
  }

  // ---------------- no attendance data for this date at all ----------------
  if (!attendanceDataAvailable) {
    caveats.push(
      `No attendance file covers ${date}, so this day cannot be judged biometrically. Only the WhatsApp report exists.`,
    );
    return {
      ...base,
      status: 'DATA_UNAVAILABLE',
      statusLabel: BIOMETRIC_STATUS_LABELS.DATA_UNAVAILABLE,
      isLate: null,
      isAbsent: null,
      confidence: 0.2,
    };
  }

  if (!employeeKnownToAttendance) {
    caveats.push('This person does not appear anywhere in the uploaded attendance files.');
  }

  // ---------------- explicit status markers written by the attendance file ------
  const markerStatus = markers.find((marker) =>
    ['ABSENT', 'SICK', 'LEAVE', 'HOLIDAY', 'OFF', 'WEEKEND', 'MISSING'].includes(marker),
  );

  if (punchCount >= minPunches) {
    const isLate = firstPunch !== null && firstPunch > cutoff.minutes;
    const lateByMinutes = isLate && firstPunch !== null ? firstPunch - cutoff.minutes : null;

    const earlyThreshold = settings.earlyLeaveEnabled
      ? parseClockValue(settings.earlyLeaveThreshold)
      : null;
    const leftEarly =
      settings.earlyLeaveEnabled &&
      earlyThreshold !== null &&
      lastPunch !== null &&
      lastPunch < earlyThreshold;
    const leftEarlyByMinutes =
      leftEarly && lastPunch !== null && earlyThreshold !== null
        ? earlyThreshold - lastPunch
        : null;

    if (punchCount === 1) {
      caveats.push(
        'Only one punch was found for this day, so the leaving time (and therefore any early departure) is uncertain.',
      );
    }
    if (markers.length > 0) {
      caveats.push(`The attendance cell also contains the marker(s): ${markers.join(', ')}.`);
    }

    evidence.push({
      kind: 'calculation',
      label: 'Late calculation',
      detail:
        firstPunch === null
          ? 'No first punch available.'
          : isLate
            ? `First punch ${minutesToClock(firstPunch)} is ${formatDuration(
                lateByMinutes ?? 0,
              )} after the ${minutesToClock(cutoff.minutes)} cut-off → LATE.`
            : `First punch ${minutesToClock(firstPunch)} is at or before the ${minutesToClock(
                cutoff.minutes,
              )} cut-off → on time.`,
    });

    if (settings.earlyLeaveEnabled && earlyThreshold !== null) {
      evidence.push({
        kind: 'calculation',
        label: 'Early-departure check',
        detail:
          lastPunch === null
            ? 'No last punch available.'
            : leftEarly
              ? `Last punch ${minutesToClock(lastPunch)} is ${formatDuration(
                  leftEarlyByMinutes ?? 0,
                )} before the ${minutesToClock(earlyThreshold)} threshold → LEFT EARLY.`
              : `Last punch ${minutesToClock(lastPunch)} is at or after the ${minutesToClock(
                  earlyThreshold,
                )} threshold → no early departure detected.`,
      });
    }

    const status = isLate ? 'LATE' : leftEarly ? 'PRESENT_LEFT_EARLY' : 'PRESENT';
    return {
      ...base,
      isLate,
      lateByMinutes,
      isAbsent: false,
      absentReason: '',
      leftEarly,
      leftEarlyByMinutes,
      onTime: !isLate,
      status,
      statusLabel: BIOMETRIC_STATUS_LABELS[status],
      confidence: punchCount === 1 ? 0.7 : 0.92,
    };
  }

  // ---------------- record exists but holds no readable time ----------------
  if (hasRecord) {
    if (markerStatus === 'ABSENT' || markerStatus === 'MISSING') {
      evidence.push({
        kind: 'attendance',
        label: 'Status marker in the attendance file',
        detail: `The file itself marks this day as "${markerStatus}".`,
        raw: record?.cells.map((entry) => entry.raw).join(' | '),
      });
      return {
        ...base,
        isAbsent: true,
        absentReason: `The attendance file itself marks this day as "${markerStatus}".`,
        isLate: false,
        onTime: false,
        status: 'ABSENT',
        statusLabel: BIOMETRIC_STATUS_LABELS.ABSENT,
        confidence: 0.9,
      };
    }
    if (markerStatus === 'SICK') {
      evidence.push({
        kind: 'attendance',
        label: 'Status marker in the attendance file',
        detail: 'The file itself marks this day as sick leave.',
        raw: record?.cells.map((entry) => entry.raw).join(' | '),
      });
      return {
        ...base,
        isAbsent: true,
        absentReason: 'The attendance file marks this day as sick leave.',
        isLate: false,
        onTime: false,
        status: 'SICK_LEAVE',
        statusLabel: BIOMETRIC_STATUS_LABELS.SICK_LEAVE,
        confidence: 0.85,
      };
    }
    if (markerStatus && ['LEAVE', 'HOLIDAY', 'OFF', 'WEEKEND'].includes(markerStatus)) {
      evidence.push({
        kind: 'attendance',
        label: 'Status marker in the attendance file',
        detail: `The file marks this day as "${markerStatus}". It is not counted as an unexcused absence.`,
        raw: record?.cells.map((entry) => entry.raw).join(' | '),
      });
      return {
        ...base,
        isAbsent: false,
        isLate: false,
        onTime: null,
        status: 'EXCUSED',
        statusLabel: BIOMETRIC_STATUS_LABELS.EXCUSED,
        confidence: 0.85,
      };
    }

    caveats.push(
      'The attendance file has a row/cell for this day but it contains no readable time. This is reported as a parsing problem — it is NOT counted as an absence.',
    );
    evidence.push({
      kind: 'validation',
      label: 'Why this is not an absence',
      detail:
        'A cell exists for this employee and date, but no valid clock value could be extracted from it. The audit never converts unreadable data into an absence.',
    });
    return {
      ...base,
      isAbsent: null,
      isLate: null,
      onTime: null,
      status: 'PARSE_ISSUE',
      statusLabel: BIOMETRIC_STATUS_LABELS.PARSE_ISSUE,
      confidence: 0.3,
    };
  }

  // ---------------- nothing in the file for this employee/date ----------------
  evidence.push({
    kind: 'attendance',
    label: 'Search result',
    detail: employeeKnownToAttendance
      ? `No attendance row or punch was found for "${params.employeeName}" on ${date} in the uploaded attendance files.`
      : `"${params.employeeName}" does not appear in the uploaded attendance files.`,
  });

  if (!settings.treatNoPunchAsAbsent) {
    caveats.push(
      'Settings: "treat a missing punch as absence" is switched OFF, so this day is reported as "no record" instead of absent.',
    );
    return {
      ...base,
      isAbsent: false,
      isLate: false,
      onTime: false,
      status: 'NO_RECORD',
      statusLabel: BIOMETRIC_STATUS_LABELS.NO_RECORD,
      confidence: 0.5,
    };
  }

  return {
    ...base,
    isAbsent: true,
    absentReason: 'No valid punch was found in the attendance files for this working day.',
    isLate: false,
    onTime: false,
    status: 'ABSENT',
    statusLabel: BIOMETRIC_STATUS_LABELS.ABSENT,
    confidence: 0.85,
  };
}
