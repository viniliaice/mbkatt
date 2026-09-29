/**
 * Human-readable vocabulary for every status the audit can produce.
 * Keeping it in one place guarantees the UI, the exports and the PDF report all
 * say exactly the same thing.
 */

import type {
  BiometricStatus,
  MatchStatus,
  MatchStatusMeta,
  NotificationStatus,
  StaffEventType,
} from './types';

export const BIOMETRIC_STATUS_LABELS: Record<BiometricStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  PRESENT_LEFT_EARLY: 'Present — left early',
  ABSENT: 'Absent (no valid punch)',
  SICK_LEAVE: 'Sick leave (marked in attendance file)',
  EXCUSED: 'Excused (leave/holiday marked in attendance file)',
  NO_RECORD: 'No record in attendance file',
  NON_WORKING_DAY: 'Non-working day',
  PARSE_ISSUE: 'Attendance record unreadable (parsing problem)',
  DATA_UNAVAILABLE: 'No attendance data for this date',
};

export const BIOMETRIC_STATUS_SHORT: Record<BiometricStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  PRESENT_LEFT_EARLY: 'Left early',
  ABSENT: 'Absent',
  SICK_LEAVE: 'Sick leave',
  EXCUSED: 'Excused',
  NO_RECORD: 'No record',
  NON_WORKING_DAY: 'Non-working day',
  PARSE_ISSUE: 'Parse issue',
  DATA_UNAVAILABLE: 'No data',
};

export const BIOMETRIC_STATUS_TONE: Record<
  BiometricStatus,
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  PRESENT: 'success',
  LATE: 'warning',
  PRESENT_LEFT_EARLY: 'warning',
  ABSENT: 'danger',
  SICK_LEAVE: 'info',
  EXCUSED: 'info',
  NO_RECORD: 'neutral',
  NON_WORKING_DAY: 'neutral',
  PARSE_ISSUE: 'danger',
  DATA_UNAVAILABLE: 'neutral',
};

export const EVENT_LABELS: Record<StaffEventType, string> = {
  LATE: 'Late',
  ABSENT: 'Absent',
  SICK: 'Sick',
  LEFT_EARLY: 'Left early',
  ON_THE_WAY: 'On the way',
  GOING_HOME: 'Going home',
  EMERGENCY: 'Emergency',
  HOSPITAL: 'Hospital',
  FUNERAL: 'Funeral',
  PERSONAL: 'Personal / other',
  UNKNOWN: 'Unrecognised',
};

export const EVENT_FILTER_ORDER: StaffEventType[] = [
  'LATE',
  'ABSENT',
  'SICK',
  'LEFT_EARLY',
  'HOSPITAL',
  'EMERGENCY',
  'GOING_HOME',
  'ON_THE_WAY',
  'FUNERAL',
  'PERSONAL',
  'UNKNOWN',
];

/** Events that describe somebody being away from work. */
export const ABSENCE_CONTEXT_EVENTS: StaffEventType[] = [
  'ABSENT',
  'SICK',
  'HOSPITAL',
  'FUNERAL',
  'EMERGENCY',
  'PERSONAL',
];

export const LATE_EVENTS: StaffEventType[] = ['LATE'];
export const EARLY_EVENTS: StaffEventType[] = ['LEFT_EARLY', 'GOING_HOME'];
export const PRESENT_CONTEXT_EVENTS: StaffEventType[] = ['ON_THE_WAY'];

export function eventGroupLabel(events: StaffEventType[]): string {
  if (events.length === 0) return 'No WhatsApp message';
  return events.map((event) => EVENT_LABELS[event]).join(' + ');
}

export const MATCH_STATUS_META: Record<MatchStatus, MatchStatusMeta> = {
  LATE_NOTIFIED: {
    code: 'LATE_NOTIFIED',
    index: 1,
    label: 'Late + Notified',
    shortLabel: 'Late + notified',
    tone: 'info',
    isConflict: false,
    isUnnotified: false,
    group: 'late',
  },
  LATE_NOT_NOTIFIED: {
    code: 'LATE_NOT_NOTIFIED',
    index: 2,
    label: 'Late + Not notified',
    shortLabel: 'Late, not notified',
    tone: 'danger',
    isConflict: false,
    isUnnotified: true,
    group: 'late',
  },
  ABSENT_NOTIFIED: {
    code: 'ABSENT_NOTIFIED',
    index: 3,
    label: 'Absent + Notified',
    shortLabel: 'Absent + notified',
    tone: 'warning',
    isConflict: false,
    isUnnotified: false,
    group: 'absent',
  },
  ABSENT_NOT_NOTIFIED: {
    code: 'ABSENT_NOT_NOTIFIED',
    index: 4,
    label: 'Absent + Not notified',
    shortLabel: 'Absent, not notified',
    tone: 'danger',
    isConflict: false,
    isUnnotified: true,
    group: 'absent',
  },
  SICK_NOTIFIED: {
    code: 'SICK_NOTIFIED',
    index: 5,
    label: 'Sick + Notified',
    shortLabel: 'Sick + notified',
    tone: 'info',
    isConflict: false,
    isUnnotified: false,
    group: 'sick',
  },
  SICK_NO_BIOMETRIC: {
    code: 'SICK_NO_BIOMETRIC',
    index: 6,
    label: 'Sick + No biometric record',
    shortLabel: 'Sick, no biometric',
    tone: 'neutral',
    isConflict: false,
    isUnnotified: false,
    group: 'sick',
  },
  LEFT_EARLY_NOTIFIED: {
    code: 'LEFT_EARLY_NOTIFIED',
    index: 7,
    label: 'Left early + Notified',
    shortLabel: 'Left early + notified',
    tone: 'info',
    isConflict: false,
    isUnnotified: false,
    group: 'early',
  },
  WHATSAPP_LATE_NOT_CONFIRMED: {
    code: 'WHATSAPP_LATE_NOT_CONFIRMED',
    index: 8,
    label: 'WhatsApp reports late — biometric does not confirm it',
    shortLabel: 'Late not confirmed',
    tone: 'warning',
    isConflict: true,
    isUnnotified: false,
    group: 'conflict',
  },
  BIOMETRIC_LATE_NO_REPORT: {
    code: 'BIOMETRIC_LATE_NO_REPORT',
    index: 9,
    label: 'Biometric shows late — other messages that day, but none for this arrival',
    shortLabel: 'Late, nobody reported',
    tone: 'danger',
    isConflict: false,
    isUnnotified: true,
    group: 'late',
  },
  WHATSAPP_ABSENT_BUT_PRESENT: {
    code: 'WHATSAPP_ABSENT_BUT_PRESENT',
    index: 10,
    label: 'WhatsApp reports absent/sick — biometric shows attendance',
    shortLabel: 'Conflict: reported absent',
    tone: 'danger',
    isConflict: true,
    isUnnotified: false,
    group: 'conflict',
  },
  WHATSAPP_PRESENT_NO_BIOMETRIC: {
    code: 'WHATSAPP_PRESENT_NO_BIOMETRIC',
    index: 11,
    label: 'WhatsApp says the person was present/coming — no biometric evidence',
    shortLabel: 'Present per WhatsApp only',
    tone: 'warning',
    isConflict: true,
    isUnnotified: false,
    group: 'conflict',
  },
  AGREED: {
    code: 'AGREED',
    index: 12,
    label: 'Both systems agree',
    shortLabel: 'Agreed',
    tone: 'success',
    isConflict: false,
    isUnnotified: false,
    group: 'ok',
  },
  UNCERTAIN: {
    code: 'UNCERTAIN',
    index: 13,
    label: 'Uncertain — needs review',
    shortLabel: 'Needs review',
    tone: 'neutral',
    isConflict: false,
    isUnnotified: false,
    group: 'review',
  },

  /* ---- extensions ---- */
  LEFT_EARLY_NOT_NOTIFIED: {
    code: 'LEFT_EARLY_NOT_NOTIFIED',
    index: null,
    label: 'Left early + Not notified',
    shortLabel: 'Left early, not notified',
    tone: 'danger',
    isConflict: false,
    isUnnotified: true,
    group: 'early',
  },
  SICK_NOT_NOTIFIED: {
    code: 'SICK_NOT_NOTIFIED',
    index: null,
    label: 'Sick (attendance file) + Not notified',
    shortLabel: 'Sick, not notified',
    tone: 'warning',
    isConflict: false,
    isUnnotified: true,
    group: 'sick',
  },
  BIOMETRIC_ABSENCE_NO_REPORT: {
    code: 'BIOMETRIC_ABSENCE_NO_REPORT',
    index: null,
    label: 'Biometric shows absence — other messages that day, but none about this person',
    shortLabel: 'Absent, nobody reported',
    tone: 'danger',
    isConflict: false,
    isUnnotified: true,
    group: 'absent',
  },
  WHATSAPP_LATE_NO_BIOMETRIC: {
    code: 'WHATSAPP_LATE_NO_BIOMETRIC',
    index: null,
    label: 'WhatsApp reports late — no biometric record at all',
    shortLabel: 'Late, no biometric record',
    tone: 'warning',
    isConflict: true,
    isUnnotified: false,
    group: 'conflict',
  },
  BIOMETRIC_DATA_UNAVAILABLE: {
    code: 'BIOMETRIC_DATA_UNAVAILABLE',
    index: null,
    label: 'No attendance data for this date — only the WhatsApp report exists',
    shortLabel: 'No attendance data',
    tone: 'neutral',
    isConflict: false,
    isUnnotified: false,
    group: 'review',
  },
  WHATSAPP_UNMATCHED_NAME: {
    code: 'WHATSAPP_UNMATCHED_NAME',
    index: null,
    label: 'WhatsApp name could not be matched to an employee',
    shortLabel: 'Unmatched name',
    tone: 'neutral',
    isConflict: false,
    isUnnotified: false,
    group: 'review',
  },
  WHATSAPP_REPORT_NO_BIOMETRIC: {
    code: 'WHATSAPP_REPORT_NO_BIOMETRIC',
    index: null,
    label: 'WhatsApp report exists — no biometric record for this person',
    shortLabel: 'Report, no biometric',
    tone: 'warning',
    isConflict: true,
    isUnnotified: false,
    group: 'review',
  },
  WHATSAPP_CLAIM_NOT_CONFIRMED: {
    code: 'WHATSAPP_CLAIM_NOT_CONFIRMED',
    index: null,
    label: 'WhatsApp claim is not confirmed by the biometric record',
    shortLabel: 'Claim not confirmed',
    tone: 'warning',
    isConflict: true,
    isUnnotified: false,
    group: 'conflict',
  },
  BIOMETRIC_PARSE_ISSUE: {
    code: 'BIOMETRIC_PARSE_ISSUE',
    index: null,
    label: 'Attendance record exists but holds no readable time (parsing problem)',
    shortLabel: 'Parsing problem',
    tone: 'danger',
    isConflict: false,
    isUnnotified: false,
    group: 'review',
  },
};

export const MATCH_STATUS_ORDER: MatchStatus[] = (
  Object.keys(MATCH_STATUS_META) as MatchStatus[]
).sort((a, b) => (MATCH_STATUS_META[a].index ?? 100) - (MATCH_STATUS_META[b].index ?? 100));

export function matchStatusMeta(code: MatchStatus): MatchStatusMeta {
  return (
    MATCH_STATUS_META[code] ?? {
      code,
      index: null,
      label: String(code),
      shortLabel: String(code),
      tone: 'neutral',
      isConflict: false,
      isUnnotified: false,
      group: 'review',
    }
  );
}

export const NOTIFICATION_LABELS: Record<NotificationStatus, string> = {
  notified: 'Notified',
  not_notified: 'Not notified',
  uncertain: 'Unclear',
};

export const NOTIFICATION_TONE: Record<
  NotificationStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  notified: 'success',
  not_notified: 'danger',
  uncertain: 'warning',
};
