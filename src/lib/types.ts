import type { WhatsAppParseDiagnostics } from './parsers/whatsapp';

/**
 * MBK Attendance Audit — shared data model.
 *
 * Design principle: every derived value carries the raw evidence that produced it.
 * The uploaded files are the only source of truth; nothing is inferred from thin air.
 */

/* ------------------------------------------------------------------ *
 * Files
 * ------------------------------------------------------------------ */

export type FileKind = 'whatsapp' | 'attendance' | 'unknown';

export interface DetectionResult {
  kind: FileKind;
  /** 0..1 */
  confidence: number;
  reasons: string[];
  warnings: string[];
  /** CSV dialect actually detected (attendance files) */
  delimiter?: string;
  headerRowIndex?: number;
}

export interface UploadedFileMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  /** Detected kind; can be overridden by the user before analysis. */
  kind: FileKind;
  kindOverride: FileKind | null;
  detection: DetectionResult;
  /** Text preview (first ~400 chars) shown in the validation panel. */
  preview: string;
  parseStatus: 'pending' | 'parsed' | 'error';
  parseError?: string;
}

/* ------------------------------------------------------------------ *
 * WhatsApp
 * ------------------------------------------------------------------ */

export type Audience = 'staff' | 'student' | 'uncertain';

export type StaffEventType =
  | 'LATE'
  | 'ABSENT'
  | 'SICK'
  | 'LEFT_EARLY'
  | 'ON_THE_WAY'
  | 'GOING_HOME'
  | 'EMERGENCY'
  | 'HOSPITAL'
  | 'FUNERAL'
  | 'PERSONAL'
  | 'UNKNOWN';

export interface DetectedEvent {
  type: StaffEventType;
  /** The exact phrase inside the message that triggered this event. */
  phrase: string;
  negated: boolean;
  confidence: number;
  /** Character offset of `phrase` inside the original message text. */
  offset: number;
}

export interface MentionedPerson {
  /** exactly as written, e.g. "T. Axmed Jaamac" */
  text: string;
  /** normalized comparison key */
  normalized: string;
  offset: number;
  /** true when the message is written in the first person ("I will be late") */
  isSelf: boolean;
}

export interface MessageClassification {
  audience: Audience;
  audienceConfidence: number;
  audienceReasons: string[];
  /** keyword hits, shown in the UI as the classification reason */
  audienceSignals: { term: string; kind: 'student' | 'staff'; offset: number }[];
  events: DetectedEvent[];
  mentions: MentionedPerson[];
  /** detected bus / grade / student info, kept but never assumed */
  studentInfo: string[];
  busInfo: string[];
  notes: string[];
  /** true when the user manually corrected the classification */
  manual?: boolean;
}

export interface WhatsAppMessage {
  id: string;
  fileId: string;
  fileName: string;
  /** 1-based line number where the message starts in the source file */
  lineNumber: number;
  rawLines: string[];
  /** the message body exactly as exported (line breaks preserved) */
  raw: string;
  /** "9/1/26" exactly as written, or null when unparsable */
  dateText: string | null;
  /** ISO yyyy-MM-dd, or null when unparsable */
  date: string | null;
  /** "5:17:33 AM" exactly as written, or null */
  timeText: string | null;
  minutesOfDay: number | null;
  /** "Fardosa Kamal", or null for system messages */
  sender: string | null;
  isSystem: boolean;
  parseWarnings: string[];
  classification: MessageClassification;
}

/** One row of the WhatsApp Report page: a staff event linked to an employee + biometric result. */
export interface WhatsAppEventRow {
  id: string;
  messageId: string;
  date: string | null;
  timeText: string | null;
  minutesOfDay: number | null;
  sender: string | null;
  subjectText: string;
  employeeId: string | null;
  employeeName: string | null;
  department: string | null;
  event: StaffEventType;
  eventPhrase: string;
  originalMessage: string;
  audience: Audience;
  classificationReason: string;
  matchStatus: MatchStatus;
  matchLabel: string;
  nameConfidence: number;
  nameTier: MatchTier;
  biometricSummary: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: EvidenceItem[];
}

/* ------------------------------------------------------------------ *
 * Attendance files
 * ------------------------------------------------------------------ */

export interface Punch {
  /** minutes since midnight */
  minutesOfDay: number;
  /** the exact token found in the cell, e.g. "6:38" / "06:38:00" / "0.2764" */
  text: string;
  rawCell: string;
  /** index of the punch inside the cell, in raw order */
  order: number;
  fileId: string;
  fileName: string;
  rowNumber: number;
  columnLabel: string;
}

export interface AttendanceCell {
  raw: string;
  punches: Punch[];
  /** non-time markers found in the cell, e.g. "ABSENT", "LEAVE", "OFF" */
  markers: string[];
  parseWarnings: string[];
}

export interface AttendanceEmployee {
  id: string;
  /** value from the source file's ID/code column, if any */
  employeeCode: string | null;
  name: string;
  nameNormalized: string;
  department: string | null;
  sourceFileIds: string[];
  /** the untouched source row, keyed by original header */
  rawRow: Record<string, string>;
  rowNumbers: Record<string, number>;
}

export interface AttendanceRecord {
  key: string;
  employeeId: string;
  date: string;
  cells: AttendanceCell[];
  punches: Punch[];
  firstPunch: number | null;
  lastPunch: number | null;
  punchCount: number;
  markers: string[];
  parseWarnings: string[];
  sourceFileIds: string[];
}

/**
 * Relationship between two uploaded attendance files (spec 48). The app never
 * double-counts: it explains what the files appear to be and which one is used.
 */
export interface SourceComparison {
  fileIds: [string, string];
  fileNames: [string, string];
  formats: [string, string];
  relation: 'same-data' | 'different-view' | 'complementary' | 'conflicting' | 'unrelated';
  relationLabel: string;
  overlapRecords: number;
  onlyInFirst: number;
  onlyInSecond: number;
  conflictingValues: number;
  employeeOverlap: number;
  dateOverlapDays: number;
  explanation: string;
  recommendation: 'use-one' | 'use-both';
}

export interface AttendanceFileSummary {
  fileId: string;
  fileName: string;
  format: 'matrix' | 'long' | 'unknown';
  delimiter?: string;
  headerRowIndex: number;
  headers: string[];
  employeeColumn: string | null;
  idColumn: string | null;
  departmentColumn: string | null;
  dateColumns: { column: string; date: string | null; raw: string }[];
  rowCount: number;
  employeeCount: number;
  recordCount: number;
  punchCount: number;
  markersFound: string[];
  warnings: string[];
  detectedDateFormat: string;
}

/* ------------------------------------------------------------------ *
 * Name matching
 * ------------------------------------------------------------------ */

export type MatchTier = 'matched' | 'possible' | 'unmatched' | 'manual' | 'rejected';

export interface NameMatchAlternative {
  employeeId: string;
  employeeName: string;
  confidence: number;
}

export interface NameMatch {
  id: string;
  /** canonical display name from WhatsApp */
  whatsappName: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeCode?: string | null;
  department?: string | null;
  /** 0..100 */
  confidence: number;
  tier: MatchTier;
  method: string;
  reasons: string[];
  alternatives: NameMatchAlternative[];
  occurrences: number;
  /** true when the mapping was decided manually in the Review Center */
  manual: boolean;
}

export interface AliasRule {
  whatsappName: string;
  employeeId: string;
  employeeName: string;
}

/* ------------------------------------------------------------------ *
 * Rules, biometric evaluation
 * ------------------------------------------------------------------ */

export type BiometricStatus =
  | 'PRESENT'
  | 'LATE'
  | 'PRESENT_LEFT_EARLY'
  | 'ABSENT'
  | 'SICK_LEAVE'
  | 'EXCUSED'
  | 'NO_RECORD'
  | 'NON_WORKING_DAY'
  | 'PARSE_ISSUE'
  | 'DATA_UNAVAILABLE';

export interface EvidenceItem {
  kind: 'whatsapp' | 'attendance' | 'rule' | 'name' | 'calculation' | 'validation';
  label: string;
  detail: string;
  sourceFile?: string;
  sourceLocation?: string;
  raw?: string;
}

export interface BiometricEvaluation {
  date: string;
  isWorkingDay: boolean;
  workingDayReason: string;
  firstPunch: number | null;
  lastPunch: number | null;
  punchCount: number;
  hasRecord: boolean;
  lateCutoffMinutes: number | null;
  lateCutoffLabel: string;
  isLate: boolean | null;
  lateByMinutes: number | null;
  isAbsent: boolean | null;
  absentReason: string;
  leftEarly: boolean | null;
  leftEarlyByMinutes: number | null;
  onTime: boolean | null;
  status: BiometricStatus;
  statusLabel: string;
  confidence: number;
  caveats: string[];
  evidence: EvidenceItem[];
}

/* ------------------------------------------------------------------ *
 * Cross reference
 * ------------------------------------------------------------------ */

export type MatchStatus =
  /* spec items 1-13 */
  | 'LATE_NOTIFIED'
  | 'LATE_NOT_NOTIFIED'
  | 'ABSENT_NOTIFIED'
  | 'ABSENT_NOT_NOTIFIED'
  | 'SICK_NOTIFIED'
  | 'SICK_NO_BIOMETRIC'
  | 'LEFT_EARLY_NOTIFIED'
  | 'WHATSAPP_LATE_NOT_CONFIRMED'
  | 'BIOMETRIC_LATE_NO_REPORT'
  | 'WHATSAPP_ABSENT_BUT_PRESENT'
  | 'WHATSAPP_PRESENT_NO_BIOMETRIC'
  | 'AGREED'
  | 'UNCERTAIN'
  /* practical extensions the audit needs to stay honest */
  | 'LEFT_EARLY_NOT_NOTIFIED'
  | 'SICK_NOT_NOTIFIED'
  | 'BIOMETRIC_ABSENCE_NO_REPORT'
  | 'WHATSAPP_LATE_NO_BIOMETRIC'
  | 'BIOMETRIC_DATA_UNAVAILABLE'
  | 'WHATSAPP_UNMATCHED_NAME'
  | 'BIOMETRIC_PARSE_ISSUE'
  | 'WHATSAPP_REPORT_NO_BIOMETRIC'
  | 'WHATSAPP_CLAIM_NOT_CONFIRMED';

export interface MatchStatusMeta {
  code: MatchStatus;
  /** sequential number as used in the specification (1..13), or null for practical extensions */
  index: number | null;
  label: string;
  shortLabel: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  isConflict: boolean;
  isUnnotified: boolean;
  group: 'late' | 'absent' | 'sick' | 'early' | 'conflict' | 'ok' | 'review';
}

export type NotificationStatus = 'notified' | 'not_notified' | 'uncertain';

export interface WhatsAppEvidenceSlice {
  hasNotification: boolean;
  /** derived whatsapp "status" (may be several events, e.g. SICK + ABSENT) */
  events: StaffEventType[];
  statusLabel: string;
  senders: string[];
  times: string[];
  minutesOfDay: number | null;
  originalMessages: string[];
  messageIds: string[];
  audience: Audience;
  subjectTexts: string[];
  rawDate: string | null;
  confidence: number;
  reasons: string[];
}

export interface AuditRecord {
  id: string;
  date: string;
  weekday: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  /** grade/class column when the attendance file provides one (spec 35 filter) */
  grade?: string | null;
  biometric: BiometricEvaluation;
  whatsapp: WhatsAppEvidenceSlice;
  notificationStatus: NotificationStatus;
  matchStatus: MatchStatus;
  matchLabel: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  notes: string[];
  evidence: EvidenceItem[];
  /** true if this row was produced from a WhatsApp-only name (no biometric row) */
  whatsappOnly: boolean;
}

/* ------------------------------------------------------------------ *
 * Administrative layer (spec 29–37)
 * ------------------------------------------------------------------ */

/**
 * Administrative excuse status. This is deliberately kept separate from the
 * WhatsApp notification: a message saying "Teacher X is sick" means
 * "notified = yes" but leaves the administrative excuse status UNKNOWN until an
 * administrator records a decision (spec 29).
 */
export type AdminExcuseStatus = 'pending' | 'excused' | 'unexcused' | 'leave';

export const ADMIN_EXCUSE_LABELS: Record<AdminExcuseStatus, string> = {
  pending: 'Pending Review',
  excused: 'Excused',
  unexcused: 'Unexcused',
  leave: 'Approved Leave',
};

export type AdminStatus =
  | 'PERFECT_ATTENDANCE'
  | 'SATISFACTORY'
  | 'VERBAL_NOTICE'
  | 'REVIEW_REQUIRED'
  | 'CRITICAL_REVIEW';

/** One administrative decision, recorded by a named reviewer with a timestamp. */
export interface AdminReviewEntry {
  auditId: string;
  excuseStatus: AdminExcuseStatus;
  /** what the administrator actually saw — never invented by the app */
  documentation: string;
  administrativeAction: string;
  notes: string;
  reviewer: string;
  decidedAt: string;
  attachedFileName?: string;
  attachedFileSize?: number;
  /** manual correction of the attendance values for this day */
  correction?: {
    firstPunch?: number | null;
    lastPunch?: number | null;
  };
  history: { at: string; by: string; action: string; detail?: string }[];
}

/** A row of the itemized absence / late arrival log (spec 33). */
export interface AdminLogRow {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  department: string | null;
  grade: string | null;
  type: 'LATE' | 'FULL_ABSENT' | 'SICK' | 'LEFT_EARLY' | 'OTHER';
  typeLabel: string;
  recordedTimeIn: string | null;
  whatsappNotified: 'yes' | 'no' | 'uncertain';
  reasonProvided: string;
  excuseStatus: AdminExcuseStatus;
  documentation: string;
  administrativeAction: string;
  reviewer: string | null;
  decidedAt: string | null;
  matchedLateMinutes: number | null;
  auditId: string;
}

/** Per-teacher totals behind the administrative summary (spec 29/31/32). */
export interface AdminTeacherStats {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  grade: string | null;
  fullAbsencesExcused: number;
  fullAbsencesUnexcused: number;
  fullAbsencesPending: number;
  sickDays: number;
  leftEarlyDays: number;
  lateOccurrences: number;
  totalLateMinutes: number;
  expectedWorkingDays: number;
  presentDays: number;
  excusedExcludedDays: number;
  attendanceRate: number | null;
  rateDetail: {
    expectedWorkingDays: number;
    present: number;
    excludedExcused: number;
    excludedLeave: number;
    excludedHolidays: number;
    countedDays: number;
    explanation: string;
  };
  whatsappNotifications: number;
  status: AdminStatus;
  statusLabel: string;
  statusReason: string;
  statusRule: string;
  statusTone: 'success' | 'info' | 'warning' | 'danger';
}

/* ------------------------------------------------------------------ *
 * Validation & review
 * ------------------------------------------------------------------ */

export type ReviewIssueType =
  | 'uncertain_classification'
  | 'uncertain_name_match'
  | 'conflicting_attendance'
  | 'missing_dates'
  | 'malformed_time'
  | 'duplicate_record'
  | 'employee_without_punches'
  | 'unparsed_message'
  | 'unknown_event';

export interface ReviewIssue {
  id: string;
  type: ReviewIssueType;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  sourceFile?: string;
  sourceLocation?: string;
  raw?: string;
  /** links back to the objects the user can act on */
  messageId?: string;
  employeeId?: string;
  auditId?: string;
  whatsappName?: string;
  date?: string;
  /** what the administrator can do about it (never a guess at the data) */
  suggestion?: string;
  /** true when this problem stops an honest analysis from being produced */
  critical?: boolean;
  resolved: boolean;
}

export interface ValidationReport {
  files: {
    fileId: string;
    fileName: string;
    kind: FileKind;
    confidence: number;
    reasons: string[];
    warnings: string[];
    recordsParsed: number;
    /** per-file detail shown on the upload screen (spec 45/46/49) */
    staffMessages?: number;
    studentMessages?: number;
    uncertainMessages?: number;
    employees?: number;
    records?: number;
    punches?: number;
    dateRange?: { first: string | null; last: string | null };
    /** first lines exactly as they appear in the file (spec 46) */
    previewRaw?: string[];
    /** first parsed records, rendered as readable key/value lines (spec 46) */
    previewParsed?: string[];
    /** structural evidence from the WhatsApp parser (spec 45) */
    diagnostics?: WhatsAppParseDiagnostics;
    critical?: boolean;
  }[];
  totals: {
    files: number;
    whatsappMessages: number;
    staffMessages: number;
    studentMessages: number;
    uncertainMessages: number;
    attendanceEmployees: number;
    attendanceRecords: number;
    punches: number;
    datesFound: number;
    employeesMatched: number;
    employeesRequiringReview: number;
    unmatchedNames: number;
    parseProblems: number;
    /** parsing problems that block an honest analysis (spec 51) */
    criticalProblems: number;
    warningProblems: number;
  };
  dateRange: { first: string | null; last: string | null };
  problems: ReviewIssue[];
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Settings, aliases, corrections
 * ------------------------------------------------------------------ */

export type DateOrder = 'auto' | 'MDY' | 'DMY' | 'YMD';

export interface Settings {
  /* --- working day rules --- */
  /** 0 = Sunday … 6 = Saturday. Default: Friday is the weekend. */
  weekendDays: number[];
  /** Late after this time on ordinary working days. */
  defaultLateCutoff: string;
  /** Per-weekday override, keyed by weekday number (Thursday = 4 → "08:00"). */
  lateCutoffByWeekday: Record<number, string>;
  /** Optional early-departure threshold (last punch before this time = left early). */
  earlyLeaveThreshold: string;
  earlyLeaveEnabled: boolean;
  /** Minimum punches required to consider a day as attended. */
  minValidPunches: number;
  /** Days explicitly excluded from the audit (public holidays, closures). */
  holidayDates: string[];
  /** Dates forced to be working days even if they fall on a weekend. */
  extraWorkingDates: string[];
  /** Reject punches before this time as machine noise (24h HH:mm). */
  earliestPlausiblePunch: string;
  /** Reject punches after this time as machine noise (24h HH:mm). */
  latestPlausiblePunch: string;

  /* --- parsing --- */
  whatsappDateOrder: DateOrder;
  attendanceDateOrder: DateOrder;
  /** Fallback year for date columns without a year. */
  fallbackYear: number | null;
  /** Treat "no valid punch" as absence. When off, such days are only reported, never called absent. */
  treatNoPunchAsAbsent: boolean;

  /* --- name matching --- */
  matchedThreshold: number;
  possibleThreshold: number;
  useTransliterationVariants: boolean;
  notificationDateToleranceDays: number;
  includeUncertainMessagesInAudit: boolean;

  /* --- privacy & branding --- */
  persistToBrowser: boolean;
  /** shown on reports and in the application header */
  schoolName: string;

  /* --- administrative thresholds (spec 30) — never hard-coded --- */
  adminRules: {
    /** Perfect Attendance: at most this many absences (default 0) */
    perfectMaxAbsences: number;
    /** Perfect Attendance: at most this many late occurrences (default 0) */
    perfectMaxLate: number;
    /** Satisfactory: attendance rate at or above this percentage */
    satisfactoryMinRate: number;
    /** Satisfactory: late occurrences at or below this number */
    satisfactoryMaxLate: number;
    /** Verbal Notice: late occurrences at or above this number */
    verbalNoticeMinLate: number;
    /** Review Required: attendance rate below this percentage */
    reviewMaxRate: number;
    /** Review Required: late occurrences at or above this number */
    reviewMaxLate: number;
    /** Review Required: unexcused absences at or above this number */
    reviewMaxUnexcused: number;
    /** Review Required: total confirmed late minutes at or above this number (0 = rule disabled) */
    reviewMaxLateMinutes: number;
    /** Critical Review: attendance rate below this percentage */
    criticalMaxRate: number;
    /** Critical Review: unexcused absences at or above this number */
    criticalMaxUnexcused: number;
  };

  /* --- attendance rate calculation (spec 32) --- */
  attendanceRate: {
    excludeApprovedLeave: boolean;
    excludeExcusedAbsence: boolean;
    excludeHolidays: boolean;
    excludeWeekends: boolean;
    excludeOtherApproved: boolean;
  };

  /**
   * Spec 31: late minutes come from biometric evidence only. When no biometric
   * record exists, the administrator may explicitly opt in to estimating the
   * duration from the WhatsApp message.
   */
  estimateLateFromWhatsApp: boolean;

  /**
   * Spec 48: which attendance source is used when the uploaded files describe
   * the same period. 'auto' prefers the most complete record per day,
   * 'both' merges every file, or a concrete file id makes that file primary.
   */
  primaryAttendanceSource: 'auto' | 'both' | string;
}

/* ------------------------------------------------------------------ *
 * Manual corrections (Review Center)
 * ------------------------------------------------------------------ */

export interface Corrections {
  /** messageId -> corrected audience */
  audience: Record<string, Audience>;
  /** messageId -> corrected event list (empty array = "no attendance event") */
  events: Record<string, StaffEventType[]>;
  /** messageId -> mention texts the user removed */
  removedMentions: Record<string, string[]>;
  /** messageId -> extra employee id chosen manually for this message */
  addedSubjects: Record<string, string[]>;
  /** normalised whatsapp name -> employee id, or 'reject' to force unmatched */
  nameOverrides: Record<string, string | 'reject'>;
  /** audit record ids that were dismissed as not applicable */
  dismissedRecords: string[];
  /** audit record id -> administrative decision (spec 34) */
  adminReviews: Record<string, AdminReviewEntry>;
}

export function emptyCorrections(): Corrections {
  return {
    audience: {},
    events: {},
    removedMentions: {},
    addedSubjects: {},
    nameOverrides: {},
    dismissedRecords: [],
    adminReviews: {},
  };
}

/* ------------------------------------------------------------------ *
 * Analysis result
 * ------------------------------------------------------------------ */

export interface AnalysisFileReport {
  file: UploadedFileMeta;
  kind: FileKind;
  summary: string;
  whatsapp?: {
    messages: number;
    parsedDates: number;
    unparsed: number;
    senders: string[];
    firstDate: string | null;
    lastDate: string | null;
    detectedDateOrder: 'MDY' | 'DMY';
  };
  attendance?: AttendanceFileSummary;
}

export interface AnalysisSummary {
  totalStaff: number;
  workingDays: number;
  totalLateEvents: number;
  totalAbsenceEvents: number;
  totalSickEvents: number;
  totalEarlyDepartures: number;
  whatsappNotifications: number;
  unnotifiedLateArrivals: number;
  unnotifiedAbsences: number;
  conflictingRecords: number;
  unmatchedNames: number;
  reviewItems: number;

  totalMessages: number;
  staffMessages: number;
  studentMessages: number;
  uncertainMessages: number;
  unmatchedMessages: number;

  employeesInAttendance: number;
  employeesInWhatsapp: number;
  employeesMatched: number;
  employeesRequiringReview: number;
  auditRecords: number;
  workingDayCount: number;

  lateByEmployee: { employeeId: string; name: string; count: number }[];
  absenceByEmployee: { employeeId: string; name: string; count: number }[];
  sickByEmployee: { employeeId: string; name: string; count: number }[];
  earlyByEmployee: { employeeId: string; name: string; count: number }[];
  notificationsByDate: { date: string; count: number }[];
  unnotifiedByDate: { date: string; notified: number; notNotified: number }[];
  discrepanciesByType: { code: MatchStatus; label: string; count: number }[];
  attendanceTrend: {
    date: string;
    present: number;
    late: number;
    absent: number;
    sick: number;
    notified: number;
    unnotified: number;
  }[];
  matchStatusCounts: { code: MatchStatus; label: string; count: number; tone: string }[];
}

export interface EmployeeSummary {
  employeeId: string;
  name: string;
  employeeCode: string | null;
  department: string | null;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  sickDays: number;
  leftEarlyDays: number;
  onTimeDays: number;
  unnotifiedLateDays: number;
  unnotifiedAbsenceDays: number;
  whatsappNotificationCount: number;
  matchedDays: number;
  conflictDays: number;
  uncertainDays: number;
  workingDaysObserved: number;
  firstDate: string | null;
  lastDate: string | null;
  whatsappNames: string[];
  history: AuditRecord[];
  attendanceRate: number | null;
}

export interface AnalysisResult {
  id: string;
  createdAt: string;
  settings: Settings;
  aliases: AliasRule[];
  files: AnalysisFileReport[];
  messages: WhatsAppMessage[];
  attendanceEmployees: AttendanceEmployee[];
  attendanceRecords: AttendanceRecord[];
  attendanceFiles: AttendanceFileSummary[];
  nameMatches: NameMatch[];
  auditRecords: AuditRecord[];
  whatsappEvents: WhatsAppEventRow[];
  employeeSummaries: EmployeeSummary[];
  summary: AnalysisSummary;
  validation: ValidationReport;
  reviewIssues: ReviewIssue[];
  /** overlap between the uploaded attendance files (spec 48) */
  sourceComparison: SourceComparison[];
  /** which source was used for each overlapping day (spec 48) */
  sourceNotes: string[];
  /** administrative layer recomputed from the audited rows (spec 29–37) */
  admin: {
    teacherStats: AdminTeacherStats[];
    log: AdminLogRow[];
    reviews: Record<string, AdminReviewEntry>;
  };
  coverage: {
    dates: string[];
    workingDates: string[];
    firstDate: string | null;
    lastDate: string | null;
    attendanceFirstDate: string | null;
    attendanceLastDate: string | null;
    whatsappFirstDate: string | null;
    whatsappLastDate: string | null;
    datesWithoutAttendanceData: string[];
  };
  warnings: string[];
  durationMs: number;
}

export interface AnalysisInputFile {
  meta: UploadedFileMeta;
  text: string;
  /** binary rows for xlsx (already converted to text tables) */
  rows?: string[][];
}
