/**
 * Administrative layer (specification items 29–37).
 *
 * This module turns the audited employee/days into the figures a school
 * administrator needs, and it is strict about what it does NOT know:
 *
 *  - a WhatsApp notification is never treated as an administrative excuse
 *    (spec 29) — the excuse status is 'pending' until an administrator records
 *    a decision;
 *  - late minutes always come from biometric evidence (spec 31); estimating
 *    them from a message is an explicit, opt-in choice;
 *  - nothing is invented: documentation, administrative actions and reasons are
 *    only ever what a human entered or what the message actually says
 *    (spec 33).
 */

import { formatDisplayDate } from './dates';
import { minutesToClock } from './time';
import { matchStatusMeta } from './statuses';
import { WEEKDAY_NAMES } from './dates';
import type {
  AdminExcuseStatus,
  AdminLogRow,
  AdminReviewEntry,
  AdminStatus,
  AdminTeacherStats,
  AuditRecord,
  Settings,
} from './types';

export const ADMIN_STATUS_LABELS: Record<AdminStatus, string> = {
  PERFECT_ATTENDANCE: 'Perfect Attendance',
  SATISFACTORY: 'Satisfactory',
  VERBAL_NOTICE: 'Verbal Notice',
  REVIEW_REQUIRED: 'Review Required',
  CRITICAL_REVIEW: 'Critical Review',
};

export const ADMIN_STATUS_TONES: Record<AdminStatus, 'success' | 'info' | 'warning' | 'danger'> = {
  PERFECT_ATTENDANCE: 'success',
  SATISFACTORY: 'success',
  VERBAL_NOTICE: 'info',
  REVIEW_REQUIRED: 'warning',
  CRITICAL_REVIEW: 'danger',
};

export const NOT_PROVIDED = 'Not provided';
export const PENDING_REVIEW = 'Pending administrative review';

/* ------------------------------------------------------------------ *
 * Late minutes (spec 31)
 * ------------------------------------------------------------------ */

/**
 * Confirmed late duration for one audited day.
 * `firstPunch` − applicable cut-off, from the biometric record only.
 */
export function confirmedLateMinutes(record: AuditRecord): number | null {
  const { biometric } = record;
  if (!biometric.isLate) return null;
  if (biometric.firstPunch === null || biometric.lateCutoffMinutes === null) return null;
  return Math.max(0, biometric.firstPunch - biometric.lateCutoffMinutes);
}

/**
 * Late duration estimated from a WhatsApp message — only used when the
 * administrator explicitly enables `estimateLateFromWhatsApp` and there is no
 * biometric evidence at all. The estimate is the difference between the time
 * the message was sent and the cut-off, and it is labelled as an estimate
 * everywhere it is shown.
 */
export function estimatedLateMinutes(record: AuditRecord): number | null {
  const { whatsapp, biometric } = record;
  if (biometric.firstPunch !== null) return null; // biometric evidence wins
  if (!whatsapp.hasNotification || whatsapp.minutesOfDay === null) return null;
  if (biometric.lateCutoffMinutes === null) return null;
  return Math.max(0, whatsapp.minutesOfDay - biometric.lateCutoffMinutes);
}

export function lateMinutesFor(record: AuditRecord, settings: Settings): number {
  const confirmed = confirmedLateMinutes(record);
  if (confirmed !== null) return confirmed;
  if (settings.estimateLateFromWhatsApp) return estimatedLateMinutes(record) ?? 0;
  return 0;
}

export function isEstimatedLate(record: AuditRecord, settings: Settings): boolean {
  return confirmedLateMinutes(record) === null && lateMinutesFor(record, settings) > 0;
}

/* ------------------------------------------------------------------ *
 * Excuse status (spec 29)
 * ------------------------------------------------------------------ */

export function excuseStatusOf(
  record: AuditRecord,
  reviews: Record<string, AdminReviewEntry>,
): AdminExcuseStatus {
  return reviews[record.id]?.excuseStatus ?? 'pending';
}

/* ------------------------------------------------------------------ *
 * Reason / documentation (spec 33) — never invented
 * ------------------------------------------------------------------ */

export function reasonProvidedFor(record: AuditRecord, review?: AdminReviewEntry): string {
  if (review?.notes.trim()) return review.notes.trim();
  const messages = record.whatsapp.originalMessages.filter(Boolean);
  if (messages.length > 0) {
    const text = messages.join(' | ').replace(/\s+/g, ' ').trim();
    return text.length > 300 ? `${text.slice(0, 297)}…` : text;
  }
  return NOT_PROVIDED;
}

export function documentationFor(review?: AdminReviewEntry): string {
  return review?.documentation?.trim() ? review.documentation.trim() : NOT_PROVIDED;
}

export function actionFor(review?: AdminReviewEntry): string {
  return review?.administrativeAction?.trim() ? review.administrativeAction.trim() : PENDING_REVIEW;
}

/* ------------------------------------------------------------------ *
 * Itemized log (spec 33)
 * ------------------------------------------------------------------ */

export function logTypeFor(record: AuditRecord): AdminLogRow['type'] {
  const { biometric, whatsapp } = record;
  if (biometric.status === 'ABSENT' || biometric.isAbsent) return 'FULL_ABSENT';
  if (biometric.status === 'SICK_LEAVE' || whatsapp.events.includes('SICK')) return 'SICK';
  if (biometric.isLate) return 'LATE';
  if (biometric.leftEarly) return 'LEFT_EARLY';
  if (whatsapp.events.includes('LEFT_EARLY') || whatsapp.events.includes('GOING_HOME')) return 'LEFT_EARLY';
  if (biometric.status === 'PARSE_ISSUE' || matchStatusMeta(record.matchStatus).isConflict) return 'OTHER';
  return 'OTHER';
}

const LOG_TYPE_LABELS: Record<AdminLogRow['type'], string> = {
  LATE: 'Late',
  FULL_ABSENT: 'Full Absent',
  SICK: 'Sick',
  LEFT_EARLY: 'Left Early',
  OTHER: 'Other',
};

/** True when the day deserves an administrative decision (spec 34). */
export function needsAdministrativeReview(record: AuditRecord): boolean {
  const meta = matchStatusMeta(record.matchStatus);
  if (record.biometric.isLate || record.biometric.isAbsent || record.biometric.leftEarly) return true;
  if (record.biometric.status === 'SICK_LEAVE' || record.biometric.status === 'EXCUSED') return true;
  if (record.biometric.status === 'PARSE_ISSUE') return true;
  if (meta.isConflict || meta.isUnnotified) return true;
  if (record.whatsapp.events.length > 0) return true;
  return false;
}

export function buildAdminLog(
  records: AuditRecord[],
  reviews: Record<string, AdminReviewEntry>,
): AdminLogRow[] {
  return records
    .filter((record) => needsAdministrativeReview(record))
    .map((record) => {
      const review = reviews[record.id];
      const type = logTypeFor(record);
      const lateMinutes = confirmedLateMinutes(record);
      return {
        id: `log-${record.id}`,
        date: record.date,
        employeeId: record.employeeId,
        employeeName: record.employeeName,
        department: record.department,
        grade: gradeOf(record),
        type,
        typeLabel: LOG_TYPE_LABELS[type],
        recordedTimeIn:
          record.biometric.firstPunch !== null ? minutesToClock(record.biometric.firstPunch) : null,
        whatsappNotified: (record.whatsapp.hasNotification
          ? 'yes'
          : record.whatsapp.audience === 'uncertain'
            ? 'uncertain'
            : 'no') as AdminLogRow['whatsappNotified'],
        reasonProvided: reasonProvidedFor(record, review),
        excuseStatus: excuseStatusOf(record, reviews),
        documentation: documentationFor(review),
        administrativeAction: actionFor(review),
        reviewer: review?.reviewer ?? null,
        decidedAt: review?.decidedAt ?? null,
        matchedLateMinutes: lateMinutes,
        auditId: record.id,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.employeeName.localeCompare(b.employeeName)));
}

/** Grade/class column when the attendance file provides one. */
export function gradeOf(record: AuditRecord): string | null {
  return record.grade ?? null;
}

/* ------------------------------------------------------------------ *
 * Attendance rate (spec 32)
 * ------------------------------------------------------------------ */

export interface RateInput {
  expectedWorkingDays: number;
  presentDays: number;
  excusedDays: number;
  leaveDays: number;
  settings: Settings;
}

export function computeAttendanceRate(input: RateInput): {
  rate: number | null;
  detail: AdminTeacherStats['rateDetail'];
} {
  const { settings } = input;
  let excludedExcused = 0;
  let excludedLeave = 0;
  if (settings.attendanceRate.excludeExcusedAbsence) excludedExcused = input.excusedDays;
  else if (settings.attendanceRate.excludeOtherApproved) excludedExcused = input.excusedDays;
  if (settings.attendanceRate.excludeApprovedLeave) excludedLeave = input.leaveDays;
  else if (settings.attendanceRate.excludeOtherApproved) excludedLeave = input.leaveDays;

  const countedDays = Math.max(0, input.expectedWorkingDays - excludedExcused - excludedLeave);
  const rate = countedDays === 0 ? null : (input.presentDays / countedDays) * 100;
  const parts = [
    `Expected working days: ${input.expectedWorkingDays}`,
    `Present: ${input.presentDays}`,
    `Approved absence excluded: ${excludedExcused}`,
    `Approved leave excluded: ${excludedLeave}`,
    settings.attendanceRate.excludeWeekends
      ? 'Weekends are already excluded from the working-day count.'
      : 'Weekend days are included in the working-day count.',
    settings.attendanceRate.excludeHolidays
      ? 'Configured holidays are excluded.'
      : 'Holidays are counted as working days.',
  ];
  return {
    rate,
    detail: {
      expectedWorkingDays: input.expectedWorkingDays,
      present: input.presentDays,
      excludedExcused,
      excludedLeave,
      excludedHolidays: settings.attendanceRate.excludeHolidays ? settings.holidayDates.length : 0,
      countedDays,
      explanation: `${parts.join(' · ')} → ${input.presentDays} / ${countedDays} = ${
        rate === null ? 'n/a' : `${rate.toFixed(1)}%`
      }`,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Administrative status rules (spec 30)
 * ------------------------------------------------------------------ */

export interface AdminStatusVerdict {
  status: AdminStatus;
  label: string;
  tone: 'success' | 'info' | 'warning' | 'danger';
  /** the exact rule that produced the status */
  rule: string;
  /** the values that triggered it */
  reason: string;
}

/**
 * Evaluates the configurable thresholds. Rules are checked from the most
 * serious to the least; the returned `rule` explains which one applied, so the
 * UI can always show the cause of a status.
 */
export function evaluateAdministrativeStatus(
  stats: {
    fullAbsencesExcused: number;
    fullAbsencesUnexcused: number;
    lateOccurrences: number;
    totalLateMinutes: number;
    attendanceRate: number | null;
  },
  settings: Settings,
): AdminStatusVerdict {
  const rules = settings.adminRules;
  const rate = stats.attendanceRate;
  const unexcused = stats.fullAbsencesUnexcused;

  const verdict = (status: AdminStatus, rule: string, reason: string): AdminStatusVerdict => ({
    status,
    label: ADMIN_STATUS_LABELS[status],
    tone: ADMIN_STATUS_TONES[status],
    rule,
    reason,
  });

  // 1 — Critical Review
  if (unexcused >= rules.criticalMaxUnexcused) {
    return verdict(
      'CRITICAL_REVIEW',
      `Critical Review when unexcused absences ≥ ${rules.criticalMaxUnexcused}`,
      `${unexcused} unexcused absence(s) reached the configured Critical Review threshold of ${rules.criticalMaxUnexcused}.`,
    );
  }
  if (rate !== null && rate < rules.criticalMaxRate) {
    return verdict(
      'CRITICAL_REVIEW',
      `Critical Review when attendance rate < ${rules.criticalMaxRate}%`,
      `Attendance rate ${rate.toFixed(1)}% is below the configured Critical Review threshold of ${rules.criticalMaxRate}%.`,
    );
  }

  // 2 — Review Required
  if (rate !== null && rate < rules.reviewMaxRate) {
    return verdict(
      'REVIEW_REQUIRED',
      `Review Required when attendance rate < ${rules.reviewMaxRate}%`,
      `Attendance rate ${rate.toFixed(1)}% is below the configured Review threshold of ${rules.reviewMaxRate}%.`,
    );
  }
  if (unexcused >= rules.reviewMaxUnexcused) {
    return verdict(
      'REVIEW_REQUIRED',
      `Review Required when unexcused absences ≥ ${rules.reviewMaxUnexcused}`,
      `${unexcused} unexcused absence(s) reached the configured Review threshold of ${rules.reviewMaxUnexcused}.`,
    );
  }
  if (stats.lateOccurrences >= rules.reviewMaxLate) {
    return verdict(
      'REVIEW_REQUIRED',
      `Review Required when late occurrences ≥ ${rules.reviewMaxLate}`,
      `${stats.lateOccurrences} late occurrence(s) reached the configured Review threshold of ${rules.reviewMaxLate}.`,
    );
  }
  if (rules.reviewMaxLateMinutes > 0 && stats.totalLateMinutes >= rules.reviewMaxLateMinutes) {
    return verdict(
      'REVIEW_REQUIRED',
      `Review Required when total late time ≥ ${rules.reviewMaxLateMinutes} minutes`,
      `Total late time ${stats.totalLateMinutes} minutes reached the configured Review threshold of ${rules.reviewMaxLateMinutes} minutes.`,
    );
  }

  // 3 — Verbal Notice
  if (stats.lateOccurrences >= rules.verbalNoticeMinLate) {
    return verdict(
      'VERBAL_NOTICE',
      `Verbal Notice when late occurrences ≥ ${rules.verbalNoticeMinLate}`,
      `${stats.lateOccurrences} late occurrence(s) reached the configured Verbal Notice threshold of ${rules.verbalNoticeMinLate}.`,
    );
  }

  // 4 — Perfect Attendance
  const totalAbsences = stats.fullAbsencesExcused + stats.fullAbsencesUnexcused;
  if (totalAbsences <= rules.perfectMaxAbsences && stats.lateOccurrences <= rules.perfectMaxLate) {
    return verdict(
      'PERFECT_ATTENDANCE',
      `Perfect Attendance when absences ≤ ${rules.perfectMaxAbsences} and late occurrences ≤ ${rules.perfectMaxLate}`,
      `${totalAbsences} absence(s) and ${stats.lateOccurrences} late occurrence(s) — at or below the configured Perfect Attendance limits.`,
    );
  }

  // 5 — Satisfactory
  if (
    (rate === null || rate >= rules.satisfactoryMinRate) &&
    stats.lateOccurrences <= rules.satisfactoryMaxLate
  ) {
    return verdict(
      'SATISFACTORY',
      `Satisfactory when attendance rate ≥ ${rules.satisfactoryMinRate}% and late occurrences ≤ ${rules.satisfactoryMaxLate}`,
      `Attendance rate ${rate === null ? 'n/a' : `${rate.toFixed(1)}%`} and ${stats.lateOccurrences} late occurrence(s) are within the configured Satisfactory limits.`,
    );
  }

  // 6 — nothing else matched: the values sit between the configured bands
  return verdict(
    'SATISFACTORY',
    `Satisfactory (fallback: attendance rate ≥ ${rules.satisfactoryMinRate}%)`,
    `Attendance rate ${rate === null ? 'n/a' : `${rate.toFixed(1)}%`} with ${stats.lateOccurrences} late occurrence(s) — no configured threshold was exceeded.`,
  );
}

/* ------------------------------------------------------------------ *
 * Per-teacher summary (spec 29/31/32)
 * ------------------------------------------------------------------ */

export interface BuildAdminStatsInput {
  records: AuditRecord[];
  workingDates: string[];
  settings: Settings;
  reviews: Record<string, AdminReviewEntry>;
}

export function buildAdminTeacherStats(input: BuildAdminStatsInput): AdminTeacherStats[] {
  const { records, workingDates, settings, reviews } = input;
  const byEmployee = new Map<string, AuditRecord[]>();
  for (const record of records) {
    const list = byEmployee.get(record.employeeId) ?? [];
    list.push(record);
    byEmployee.set(record.employeeId, list);
  }

  const stats: AdminTeacherStats[] = [];
  for (const [employeeId, employeeRecords] of byEmployee) {
    const first = employeeRecords[0];
    let presentDays = 0;
    let excusedDays = 0;
    let leaveDays = 0;
    let fullAbsencesExcused = 0;
    let fullAbsencesUnexcused = 0;
    let fullAbsencesPending = 0;
    let sickDays = 0;
    let leftEarlyDays = 0;
    let lateOccurrences = 0;
    let totalLateMinutes = 0;
    let notifiedLate = 0;
    let unnotifiedLate = 0;
    let notifiedAbsence = 0;
    let unnotifiedAbsence = 0;
    let whatsappNotifications = 0;

    const expectedDates = new Set(workingDates);
    for (const record of employeeRecords) expectedDates.add(record.date);

    for (const record of employeeRecords) {
      const status = excuseStatusOf(record, reviews);
      if (record.whatsapp.hasNotification) whatsappNotifications += 1;
      if (record.biometric.firstPunch !== null && !record.biometric.isAbsent) presentDays += 1;
      if (record.biometric.isLate) {
        lateOccurrences += 1;
        totalLateMinutes += lateMinutesFor(record, settings);
        if (record.whatsapp.hasNotification) notifiedLate += 1;
        else unnotifiedLate += 1;
      }
      if (record.biometric.leftEarly) leftEarlyDays += 1;
      if (record.biometric.status === 'SICK_LEAVE' || record.whatsapp.events.includes('SICK')) {
        sickDays += 1;
      }
      const isFullAbsence = record.biometric.isAbsent === true || record.biometric.status === 'ABSENT';
      if (isFullAbsence) {
        if (record.whatsapp.hasNotification) notifiedAbsence += 1;
        else unnotifiedAbsence += 1;

        if (status === 'excused') {
          fullAbsencesExcused += 1;
          excusedDays += 1;
        } else if (status === 'leave') {
          fullAbsencesExcused += 1;
          leaveDays += 1;
        } else if (status === 'unexcused') {
          fullAbsencesUnexcused += 1;
        } else {
          fullAbsencesPending += 1;
        }
      } else if (status === 'excused') {
        excusedDays += 1;
      } else if (status === 'leave') {
        leaveDays += 1;
      }
    }

    const rateInput: RateInput = {
      expectedWorkingDays: new Set([...workingDates, ...employeeRecords.map((record) => record.date)]).size,
      presentDays,
      excusedDays,
      leaveDays,
      settings,
    };
    const { rate, detail } = computeAttendanceRate(rateInput);
    const verdict = evaluateAdministrativeStatus(
      {
        fullAbsencesExcused,
        fullAbsencesUnexcused,
        lateOccurrences,
        totalLateMinutes,
        attendanceRate: rate,
      },
      settings,
    );

    // A person who only appears in WhatsApp has no attendance record to judge:
    // inventing a 0 % attendance rate for them would be a fabricated finding.
    const hasAttendanceRecord = employeeRecords.some((record) => record.biometric.hasRecord);
    const identityVerdict: AdminStatusVerdict | null = hasAttendanceRecord
      ? null
      : {
          status: 'REVIEW_REQUIRED',
          label: ADMIN_STATUS_LABELS.REVIEW_REQUIRED,
          tone: ADMIN_STATUS_TONES.REVIEW_REQUIRED,
          rule: 'Identity review: no matching employee in the attendance file',
          reason:
            'This name appears in the WhatsApp export but has no employee record in the attendance files, so no attendance rate or absence count can be calculated. Approve or reject the name match in the Review Center first.',
        };

    stats.push({
      employeeId,
      employeeName: first.employeeName,
      employeeCode: first.employeeCode,
      department: first.department,
      grade: gradeOf(first),
      fullAbsencesExcused,
      fullAbsencesUnexcused,
      fullAbsencesPending,
      sickDays,
      leftEarlyDays,
      lateOccurrences,
      totalLateMinutes,
      notifiedLate,
      unnotifiedLate,
      notifiedAbsence,
      unnotifiedAbsence,
      expectedWorkingDays: rateInput.expectedWorkingDays,
      presentDays,
      excusedExcludedDays: detail.excludedExcused + detail.excludedLeave,
      attendanceRate: hasAttendanceRecord ? rate : null,
      rateDetail: hasAttendanceRecord
        ? detail
        : {
            ...detail,
            explanation:
              'No attendance record exists for this person in the uploaded attendance files — no attendance rate is shown.',
          },
      whatsappNotifications,
      status: (identityVerdict ?? verdict).status,
      statusLabel: (identityVerdict ?? verdict).label,
      statusReason: (identityVerdict ?? verdict).reason,
      statusRule: (identityVerdict ?? verdict).rule,
      statusTone: (identityVerdict ?? verdict).tone,
    });
  }

  return stats.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/* ------------------------------------------------------------------ *
 * Review workflow helpers (spec 34)
 * ------------------------------------------------------------------ */

export interface AdminReviewAction {
  id:
    | 'confirm-excused'
    | 'confirm-unexcused'
    | 'mark-leave'
    | 'correct-attendance'
    | 'add-documentation'
    | 'add-action'
    | 'reset';
  label: string;
  excuseStatus?: AdminExcuseStatus;
}

export const ADMIN_REVIEW_ACTIONS: AdminReviewAction[] = [
  { id: 'confirm-excused', label: 'Confirm Excused', excuseStatus: 'excused' },
  { id: 'confirm-unexcused', label: 'Confirm Unexcused', excuseStatus: 'unexcused' },
  { id: 'mark-leave', label: 'Mark as Leave', excuseStatus: 'leave' },
  { id: 'correct-attendance', label: 'Correct Attendance' },
  { id: 'add-documentation', label: 'Add Documentation' },
  { id: 'add-action', label: 'Add Administrative Action' },
  { id: 'reset', label: 'Reset to Pending Review', excuseStatus: 'pending' },
];

/** Working-day explanation used in the review dialog. */
export function describeWorkingDay(record: AuditRecord): string {
  const weekday = WEEKDAY_NAMES[Number(new Date(`${record.date}T00:00:00`).getDay())] ?? '';
  return `${formatDisplayDate(record.date)} (${weekday}) — ${record.biometric.workingDayReason}`;
}

export function reviewSummaryLine(review?: AdminReviewEntry): string {
  if (!review) return 'Pending administrative review — no decision recorded yet.';
  return `${review.excuseStatus.toUpperCase()} recorded by ${review.reviewer || 'unknown reviewer'} on ${new Date(
    review.decidedAt,
  ).toLocaleString()}`;
}
