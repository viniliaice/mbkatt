/**
 * Cross-reference engine.
 *
 * For every employee and every day it compares:
 *   A. what the biometric attendance files say, and
 *   B. what was reported in the WhatsApp group,
 * and produces one auditable status per row, together with the evidence that
 * produced it.
 *
 * Rules of engagement (from the specification):
 *   • never invent a notification,
 *   • never treat a similar name as a notification,
 *   • never turn unreadable attendance data into an absence,
 *   • "on the way" / "will be back" / "went out" are not absences,
 *   • a WhatsApp claim never overrides the biometric record — it is reported as
 *     an unconfirmed claim instead.
 */

import { addDaysIso, compareIso, weekdayName } from './dates';
import { evaluateBiometric } from './rules';
import {
  ABSENCE_CONTEXT_EVENTS,
  EVENT_LABELS,
  EARLY_EVENTS,
  eventGroupLabel,
  matchStatusMeta,
} from './statuses';
import type {
  AttendanceEmployee,
  AttendanceRecord,
  AuditRecord,
  BiometricEvaluation,
  EvidenceItem,
  MatchStatus,
  NameMatch,
  NotificationStatus,
  StaffEventType,
  WhatsAppEventRow,
  WhatsAppEvidenceSlice,
  WhatsAppMessage,
  Settings,
} from './types';
import { minutesToClock } from './time';
import { normalizeName } from './normalize';

export const UNMATCHED_PREFIX = 'wa-unmatched:';

/**
 * Grade/class value from the attendance row, when the file has such a column.
 * Nothing is inferred when the column is absent.
 */
export function gradeFromRawRow(rawRow: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(rawRow ?? {})) {
    if (!/grade|class|fasal|grado|darajad|sanad/i.test(key)) continue;
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
}
export const NOT_IN_ATTENDANCE_PREFIX = 'wa-only:';

export interface AuditContext {
  employees: AttendanceEmployee[];
  records: AttendanceRecord[];
  messages: WhatsAppMessage[];
  nameMatches: NameMatch[];
  settings: Settings;
  /** every date covered by the attendance files */
  attendanceDates: Set<string>;
  /** dates on which at least one staff-related WhatsApp message exists */
  staffReportDates: Set<string>;
  /** all dates in the audited period */
  dates: string[];
  /**
   * messageId -> employee ids an administrator attached to the message by hand
   * in the Review Center (Corrections.addedSubjects, spec 34/44). These are
   * treated exactly like a resolved mention, never as a guess.
   */
  subjectAdditions?: Record<string, string[]>;
}

export interface AuditOutput {
  auditRecords: AuditRecord[];
  whatsappEvents: WhatsAppEventRow[];
  messagesByDate: Map<string, WhatsAppMessage[]>;
}

/* ------------------------------------------------------------------ *
 * Message → employee resolution
 * ------------------------------------------------------------------ */

export function resolveSubjectEmployees(
  message: WhatsAppMessage,
  lookup: Map<string, NameMatch>,
): { name: string; isSelf: boolean; match: NameMatch | null }[] {
  const classification = message.classification;
  if (classification.mentions.length === 0) return [];

  const resolved: { name: string; isSelf: boolean; match: NameMatch | null }[] = [];
  const seen = new Set<string>();

  for (const mention of classification.mentions) {
    const key = normalizeName(mention.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const match =
      lookup.get(key) ??
      lookup.get(normalizeName(mention.normalized)) ??
      null;
    resolved.push({ name: mention.text, isSelf: mention.isSelf, match });
  }
  return resolved;
}

export function isAuditableMessage(message: WhatsAppMessage, settings: Settings): boolean {
  if (message.isSystem) return false;
  if (message.classification.manual) return true;
  if (message.classification.audience === 'student') return false;
  if (message.classification.audience === 'uncertain') {
    return settings.includeUncertainMessagesInAudit;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Audit table
 * ------------------------------------------------------------------ */

export function buildAudit(context: AuditContext): AuditOutput {
  const { settings } = context;
  const recordIndex = new Map<string, AttendanceRecord>();
  for (const record of context.records) {
    recordIndex.set(`${record.employeeId}__${record.date}`, record);
  }

  const messagesByDate = new Map<string, WhatsAppMessage[]>();
  for (const message of context.messages) {
    if (!message.date) continue;
    const list = messagesByDate.get(message.date) ?? [];
    list.push(message);
    messagesByDate.set(message.date, list);
  }

  const nameLookup = new Map<string, NameMatch>();
  for (const match of context.nameMatches) {
    nameLookup.set(normalizeName(match.whatsappName), match);
  }

  const employeesById = new Map(context.employees.map((employee) => [employee.id, employee]));

  const messagesByEmployeeDate = new Map<string, WhatsAppMessage[]>();
  /** event-row ids per audit key, so the report can show the final verdict */
  const eventRowsByKey = new Map<string, WhatsAppEventRow[]>();
  const whatsappEvents: WhatsAppEventRow[] = [];

  // ---------------------------------------------------------------- 1. index
  for (const message of context.messages) {
    if (message.isSystem) continue;
    if (!message.date) continue;
    if (!isAuditableMessage(message, settings)) continue;

    const subjects = resolveSubjectEmployees(message, nameLookup);

    /* Manual subject additions (spec 34/44): an administrator attached this
       employee to the message. The attribution is explicit, so it is recorded
       as a manual 100%-confidence match rather than a heuristic one. */
    for (const employeeId of context.subjectAdditions?.[message.id] ?? []) {
      if (subjects.some((subject) => subject.match?.employeeId === employeeId)) continue;
      const employee = employeesById.get(employeeId);
      if (!employee) continue;
      subjects.push({
        name: employee.name,
        isSelf: false,
        match: {
          id: `manual-${message.id}-${employeeId}`,
          whatsappName: employee.name,
          employeeId: employee.id,
          employeeName: employee.name,
          employeeCode: employee.employeeCode,
          department: employee.department,
          confidence: 100,
          tier: 'matched',
          method: 'Manual attribution in the Review Center',
          reasons: [
            'An administrator attached this employee to the message by hand; no automatic matching was involved.',
          ],
          alternatives: [],
          occurrences: 1,
          manual: true,
        },
      });
    }
    const events: StaffEventType[] =
      message.classification.events.length > 0
        ? message.classification.events.map((event) => event.type)
        : ['UNKNOWN'];

    // Which day(s) may this message refer to?  Same-day in the normal case;
    // explicitly the previous/next day when the wording says "yesterday" or
    // "tomorrow"; and the following day(s) for messages sent in the evening.
    // Every deviation is recorded so the user can see why a message was used.
    const targets = resolveMessageTargets(message, settings);

    if (subjects.length === 0) {
      // A staff message that names nobody we could recognise.
      for (const event of events) {
        whatsappEvents.push(
          buildEventRow({
            message,
            subjectText: '',
            employeeId: null,
            employeeName: null,
            department: null,
            event,
            match: null,
            matchStatus: 'WHATSAPP_UNMATCHED_NAME',
            biometricSummary: 'No employee could be attached to this message.',
            nameConfidence: 0,
            nameTier: 'unmatched',
            evidence: [
              {
                kind: 'validation',
                label: 'No employee identified',
                detail:
                  'This staff message does not name anybody that matched an attendance employee. Classify or map it in the Review Center.',
                sourceFile: message.fileName,
                sourceLocation: `line ${message.lineNumber}`,
                raw: message.raw,
              },
            ],
          }),
        );
      }
      continue;
    }

    for (const subject of subjects) {
      for (const target of targets) {
        const key = subject.match?.employeeId
          ? `${subject.match.employeeId}__${target.date}`
          : `${UNMATCHED_PREFIX}${normalizeName(subject.name)}__${target.date}`;
        const list = messagesByEmployeeDate.get(key) ?? [];
        if (!list.includes(message)) list.push(message);
        messagesByEmployeeDate.set(key, list);

        const unmatchedName = !subject.match?.employeeId;
        const bucket = unmatchedName ? null : (eventRowsByKey.get(key) ?? []);

        for (const event of events) {
          whatsappEvents.push(
            buildEventRow({
              message,
              subjectText: subject.name,
              employeeId: unmatchedName ? null : (subject.match?.employeeId ?? null),
              employeeName: unmatchedName ? null : (subject.match?.employeeName ?? null),
              department: unmatchedName ? null : (subject.match?.department ?? null),
              event,
              match: unmatchedName ? null : subject.match,
              matchStatus: unmatchedName ? 'WHATSAPP_UNMATCHED_NAME' : 'UNCERTAIN',
              biometricSummary: unmatchedName
                ? 'No employee could be attached to this message.'
                : '',
              nameConfidence: unmatchedName ? 0 : (subject.match?.confidence ?? 0),
              nameTier: unmatchedName ? 'unmatched' : (subject.match?.tier ?? 'unmatched'),
              evidence: buildMessageEvidence(message, target.note),
              bucket: bucket ?? undefined,
            }),
          );
        }
        if (bucket) eventRowsByKey.set(key, bucket);
      }
    }
  }

  // ---------------------------------------------------------------- 2. audit rows
  const auditRecords: AuditRecord[] = [];

  for (const employee of context.employees) {
    for (const date of context.dates) {
      const record = recordIndex.get(`${employee.id}__${date}`) ?? null;
      const messages = messagesByEmployeeDate.get(`${employee.id}__${date}`) ?? [];
      const slice = buildWhatsappSlice(messages, settings, date);

      const attendanceDataAvailable = context.attendanceDates.has(date);
      const biometric = evaluateBiometric({
        date,
        employeeName: employee.name,
        record,
        settings,
        attendanceDataAvailable,
        employeeKnownToAttendance: true,
      });

      const relevant = shouldEmitRow(biometric, slice);
      if (!relevant) continue;

      const derived = deriveMatchStatus({
        biometric,
        whatsapp: slice,
        employeeKnownToAttendance: true,
        dateHasOtherStaffMessages: context.staffReportDates.has(date),
        settings,
      });

      const notes = [...biometric.caveats, ...derived.reasons];
      if (slice.hasNotification) notes.push(...slice.reasons);

      const auditRecord: AuditRecord = {
        id: `audit-${employee.id}-${date}`,
        date,
        weekday: weekdayName(date),
        employeeId: employee.id,
        employeeName: employee.name,
        employeeCode: employee.employeeCode,
        department: employee.department,
        grade: gradeFromRawRow(employee.rawRow),
        biometric,
        whatsapp: slice,
        notificationStatus: derived.notificationStatus,
        matchStatus: derived.status,
        matchLabel: matchStatusMeta(derived.status).label,
        confidence: derived.confidence,
        confidenceScore: derived.confidenceScore,
        notes,
        evidence: [...biometric.evidence, ...whatsappEvidence(slice, messages)],
        whatsappOnly: false,
      };
      auditRecords.push(auditRecord);

      const key = `${employee.id}__${date}`;
      const eventRows = eventRowsByKey.get(key);
      if (eventRows) {
        for (const row of eventRows) {
          row.matchStatus = derived.status;
          row.matchLabel = matchStatusMeta(derived.status).shortLabel;
          row.biometricSummary = describeBiometric(biometric);
          row.confidence = derived.confidence;
        }
      }
    }
  }

  // ------------------------------------------------- 3. WhatsApp-only rows
  // Messages about people who are not in the attendance files at all, or whose
  // name could not be matched: they still belong in the audit, clearly marked.
  const handledUnmatchedKeys = new Set<string>();
  for (const [key, messages] of messagesByEmployeeDate.entries()) {
    if (!key.startsWith(UNMATCHED_PREFIX)) continue;
    const [rawName, date] = key.slice(UNMATCHED_PREFIX.length).split('__');
    const dedupeKey = `${rawName}__${date}`;
    if (handledUnmatchedKeys.has(dedupeKey)) continue;
    handledUnmatchedKeys.add(dedupeKey);
    const slice = buildWhatsappSlice(messages, settings, date);
    auditRecords.push({
      id: `audit-unmatched-${rawName}-${date}`,
      date,
      weekday: weekdayName(date),
      employeeId: `${UNMATCHED_PREFIX}${rawName}`,
      employeeName: displayNameFromKey(rawName, messages),
      employeeCode: null,
      department: null,
      biometric: emptyBiometric(date),
      whatsapp: slice,
      notificationStatus: 'notified',
      matchStatus: 'WHATSAPP_UNMATCHED_NAME',
      matchLabel: matchStatusMeta('WHATSAPP_UNMATCHED_NAME').label,
      confidence: 'low',
      confidenceScore: 30,
      notes: [
        `The name "${displayNameFromKey(rawName, messages)}" in WhatsApp could not be matched to any attendance employee.`,
      ],
      evidence: whatsappEvidence(slice, messages),
      whatsappOnly: true,
    });
  }

  // Sort: newest date first, then employee name
  auditRecords.sort((a, b) => {
    const byDate = compareIso(b.date, a.date);
    if (byDate !== 0) return byDate;
    return a.employeeName.localeCompare(b.employeeName);
  });
  whatsappEvents.sort((a, b) => {
    const byDate = compareIso(b.date ?? '', a.date ?? '');
    if (byDate !== 0) return byDate;
    const byTime = (b.minutesOfDay ?? -1) - (a.minutesOfDay ?? -1);
    if (byTime !== 0) return byTime;
    return a.subjectText.localeCompare(b.subjectText);
  });

  return { auditRecords, whatsappEvents, messagesByDate };
}

/** Which calendar day(s) a message can plausibly refer to. */
export function resolveMessageTargets(
  message: WhatsAppMessage,
  settings: Settings,
): { date: string; note: string | null }[] {
  if (!message.date) return [];
  const text = message.raw.toLowerCase();
  const targets: { date: string; note: string | null }[] = [];

  if (/\byesterday\b|\bearly this morning\b|\blast night\b/.test(text)) {
    targets.push({
      date: addDaysIso(message.date, -1),
      note: 'The message says "yesterday"/"last night", so it was attributed to the previous day.',
    });
  }
  if (/\btomorrow\b/.test(text)) {
    targets.push({
      date: addDaysIso(message.date, 1),
      note: 'The message says "tomorrow", so it was attributed to the following day.',
    });
  }

  targets.push({ date: message.date, note: null });

  if (
    settings.notificationDateToleranceDays > 0 &&
    message.minutesOfDay !== null &&
    message.minutesOfDay >= 16 * 60
  ) {
    for (let offset = 1; offset <= settings.notificationDateToleranceDays; offset += 1) {
      targets.push({
        date: addDaysIso(message.date, offset),
        note: `Message was sent the evening before (${message.timeText ?? ''}) and may refer to this day.`,
      });
    }
  }

  // De-duplicate dates while keeping the most specific note first
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.date)) return false;
    seen.add(target.date);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function displayNameFromKey(key: string, messages: WhatsAppMessage[]): string {
  for (const message of messages) {
    for (const mention of message.classification.mentions) {
      if (normalizeName(mention.text) === key) return mention.text;
    }
  }
  return key;
}

function shouldEmitRow(biometric: BiometricEvaluation, slice: WhatsAppEvidenceSlice): boolean {
  if (slice.hasNotification) return true;
  if (!biometric.isWorkingDay) return false;
  if (biometric.status === 'DATA_UNAVAILABLE') return false;
  if (biometric.status === 'NON_WORKING_DAY') return false;
  return true;
}

function emptyBiometric(date: string): BiometricEvaluation {
  return {
    date,
    isWorkingDay: true,
    workingDayReason: 'Not evaluated — this person is not in the attendance files.',
    firstPunch: null,
    lastPunch: null,
    punchCount: 0,
    hasRecord: false,
    lateCutoffMinutes: null,
    lateCutoffLabel: '',
    isLate: null,
    lateByMinutes: null,
    isAbsent: null,
    absentReason: '',
    leftEarly: null,
    leftEarlyByMinutes: null,
    onTime: null,
    status: 'DATA_UNAVAILABLE',
    statusLabel: 'No attendance data',
    confidence: 0.1,
    caveats: [],
    evidence: [],
  };
}

export function buildWhatsappSlice(
  messages: WhatsAppMessage[],
  settings: Settings,
  date: string,
): WhatsAppEvidenceSlice {
  const auditable = messages.filter((message) => isAuditableMessage(message, settings));
  const events = new Set<StaffEventType>();
  const senders = new Set<string>();
  const times = new Set<string>();
  const originalMessages: string[] = [];
  const messageIds: string[] = [];
  const subjectTexts = new Set<string>();
  const reasons: string[] = [];
  let audience: WhatsAppEvidenceSlice['audience'] = 'staff';
  let confidence = 1;

  for (const message of auditable) {
    originalMessages.push(message.raw);
    messageIds.push(message.id);
    if (message.sender) senders.add(message.sender);
    if (message.timeText) times.add(message.timeText);
    for (const event of message.classification.events) events.add(event.type);
    for (const mention of message.classification.mentions) subjectTexts.add(mention.text);

    if (message.classification.audience === 'uncertain') {
      audience = 'uncertain';
      confidence = Math.min(confidence, 0.5);
      reasons.push(
        `Message "${truncate(message.raw)}" is classified as UNCERTAIN (staff/student) — it was included because Settings allows uncertain messages in the audit.`,
      );
    }
    for (const warning of message.parseWarnings) reasons.push(warning);
  }

  if (auditable.length > 0) {
    reasons.push(
      `${auditable.length} WhatsApp message(s) refer to this person on ${date}: ${auditable
        .map((message) => `"${truncate(message.raw)}"`)
        .join(' | ')}`,
    );
  }

  return {
    hasNotification: auditable.length > 0,
    events: [...events],
    statusLabel: eventGroupLabel([...events]),
    senders: [...senders],
    times: [...times],
    minutesOfDay:
      auditable.length > 0
        ? auditable.reduce<number | null>(
            (earliest, message) =>
              message.minutesOfDay === null
                ? earliest
                : earliest === null
                  ? message.minutesOfDay
                  : Math.min(earliest, message.minutesOfDay),
            null,
          )
        : null,
    originalMessages,
    messageIds,
    audience,
    subjectTexts: [...subjectTexts],
    rawDate: auditable[0]?.dateText ?? null,
    confidence,
    reasons,
  };
}

function truncate(value: string, max = 120): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

function buildMessageEvidence(message: WhatsAppMessage, note: string | null): EvidenceItem[] {
  const items: EvidenceItem[] = [
    {
      kind: 'whatsapp',
      label: `WhatsApp message from ${message.sender ?? 'unknown sender'}`,
      detail: `${message.dateText ?? 'unknown date'} ${message.timeText ?? ''} — "${truncate(message.raw, 400)}"`,
      sourceFile: message.fileName,
      sourceLocation: `line ${message.lineNumber}`,
      raw: message.rawLines.join('\n'),
    },
  ];
  if (note) {
    items.push({ kind: 'rule', label: 'Date attribution', detail: note });
  }
  return items;
}

function whatsappEvidence(
  slice: WhatsAppEvidenceSlice,
  messages: WhatsAppMessage[],
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const message of messages) {
    items.push({
      kind: 'whatsapp',
      label: `WhatsApp message from ${message.sender ?? 'unknown sender'}`,
      detail: `${message.dateText ?? ''} ${message.timeText ?? ''} — "${truncate(message.raw, 400)}"`,
      sourceFile: message.fileName,
      sourceLocation: `line ${message.lineNumber}`,
      raw: message.rawLines.join('\n'),
    });
  }
  if (messages.length === 0) {
    items.push({
      kind: 'validation',
      label: 'No WhatsApp notification found',
      detail:
        'No message in the uploaded WhatsApp export names this employee for this date (within the configured date tolerance).',
    });
  }
  if (slice.reasons.length > 0) {
    items.push({
      kind: 'validation',
      label: 'Notification reasoning',
      detail: slice.reasons.join(' '),
    });
  }
  return items;
}

function describeBiometric(biometric: BiometricEvaluation): string {
  if (biometric.status === 'DATA_UNAVAILABLE') return 'No attendance data';
  if (biometric.status === 'NON_WORKING_DAY') return 'Non-working day';
  if (biometric.firstPunch !== null) {
    const first = minutesToClock(biometric.firstPunch);
    const last = biometric.lastPunch !== null ? minutesToClock(biometric.lastPunch) : '—';
    return `${biometric.statusLabel} — first punch ${first}, last punch ${last} (${biometric.punchCount} punch(es))`;
  }
  return biometric.statusLabel;
}

/* ------------------------------------------------------------------ *
 * Comparison rules
 * ------------------------------------------------------------------ */

export interface DeriveInput {
  biometric: BiometricEvaluation;
  whatsapp: WhatsAppEvidenceSlice;
  employeeKnownToAttendance: boolean;
  dateHasOtherStaffMessages: boolean;
  settings: Settings;
}

export interface DerivedStatus {
  status: MatchStatus;
  reasons: string[];
  notificationStatus: NotificationStatus;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
}

export function deriveMatchStatus(input: DeriveInput): DerivedStatus {
  const { biometric: bio, whatsapp: wa } = input;
  const events = wa.events;
  const reasons: string[] = [];

  const isSick = events.includes('SICK') || events.includes('HOSPITAL');
  const isAbsentClaim = events.includes('ABSENT');
  const hasAbsenceContext = events.some((event) => ABSENCE_CONTEXT_EVENTS.includes(event));
  const isLateClaim = events.includes('LATE');
  const isEarlyClaim = events.some((event) => EARLY_EVENTS.includes(event));
  const isOnTheWay = events.includes('ON_THE_WAY');

  const bioPresent =
    bio.status === 'PRESENT' || bio.status === 'LATE' || bio.status === 'PRESENT_LEFT_EARLY';
  const bioAbsent = bio.status === 'ABSENT';
  const bioSickLeave = bio.status === 'SICK_LEAVE';
  const bioHasNoPunch = bio.punchCount === 0;

  const nameConfidence = wa.confidence;
  const bioConfidence = bio.confidence;
  const score = Math.round(
    100 *
      (0.5 * nameConfidence + 0.35 * bioConfidence + 0.15 * (wa.hasNotification ? nameConfidence : 1)),
  );

  const confidence: DerivedStatus['confidence'] =
    wa.audience === 'uncertain' || bio.status === 'PARSE_ISSUE'
      ? 'low'
      : bioConfidence >= 0.85 && score >= 80
        ? 'high'
        : score >= 60
          ? 'medium'
          : 'low';

  const notificationStatus: NotificationStatus = wa.hasNotification
    ? wa.audience === 'uncertain'
      ? 'uncertain'
      : 'notified'
    : 'not_notified';

  const finish = (status: MatchStatus, extra: string[] = []): DerivedStatus => {
    const meta = matchStatusMeta(status);
    return {
      status,
      reasons: [
        meta.label,
        ...extra,
        ...(wa.hasNotification
          ? [`WhatsApp evidence: ${eventGroupLabel(events) || 'no recognised event'}.`]
          : ['No WhatsApp evidence for this person on this date.']),
      ],
      notificationStatus: meta.isUnnotified ? 'not_notified' : notificationStatus,
      confidence,
      confidenceScore: score,
    };
  };

  /* ---- nothing to compare ---- */
  if (!bio.isWorkingDay) {
    if (wa.hasNotification && hasAbsenceContext) {
      reasons.push(
        'WhatsApp reports an absence on a day the settings treat as a non-working day — please review.',
      );
      return finish('UNCERTAIN');
    }
    return finish('AGREED', ['Non-working day: no attendance expectation.']);
  }

  if (bio.status === 'DATA_UNAVAILABLE') {
    if (wa.hasNotification) {
      reasons.push(
        'The WhatsApp report exists but no attendance file covers this date, so the claim cannot be checked against the machine.',
      );
      return finish('BIOMETRIC_DATA_UNAVAILABLE');
    }
    return finish('AGREED', ['No attendance data for this date, and no WhatsApp report either.']);
  }

  if (bio.status === 'PARSE_ISSUE') {
    reasons.push(
      'The attendance file holds a row for this day but no readable time, so the biometric side cannot be trusted. This is a parsing problem, not a verdict.',
    );
    return finish('BIOMETRIC_PARSE_ISSUE');
  }

  /* ---- no WhatsApp notification ---- */
  if (!wa.hasNotification) {
    if (bioAbsent) {
      reasons.push(
        bio.absentReason || 'The attendance files show no valid punch on this working day.',
      );
      return finish(
        input.dateHasOtherStaffMessages ? 'BIOMETRIC_ABSENCE_NO_REPORT' : 'ABSENT_NOT_NOTIFIED',
        input.dateHasOtherStaffMessages
          ? ['Other staff reported that day, but nobody reported this absence.']
          : ['Nobody reported anything in the WhatsApp group on this day.'],
      );
    }
    if (bioSickLeave) {
      reasons.push('The attendance file itself marks this day as sick leave.');
      return finish('SICK_NOT_NOTIFIED');
    }
    if (bio.isLate) {
      reasons.push(
        `The biometric record shows a late arrival (${bio.lateByMinutes ?? 0} minute(s) after the cut-off) and no WhatsApp notification was found.`,
      );
      return finish(
        input.dateHasOtherStaffMessages ? 'BIOMETRIC_LATE_NO_REPORT' : 'LATE_NOT_NOTIFIED',
        input.dateHasOtherStaffMessages
          ? ['Messages exist in the group on this date, but none mentions this late arrival.']
          : ['No WhatsApp message at all on this date.'],
      );
    }
    if (bio.leftEarly) {
      reasons.push(
        `The biometric record shows an early departure (${bio.leftEarlyByMinutes ?? 0} minute(s) before the threshold) and no WhatsApp notification was found.`,
      );
      return finish('LEFT_EARLY_NOT_NOTIFIED');
    }
    if (bio.status === 'EXCUSED') {
      return finish('AGREED', ['The attendance file marks this day as leave/holiday.']);
    }
    if (bio.status === 'NO_RECORD') {
      return finish('UNCERTAIN', [
        'There is no attendance record for this day and the settings do not convert a missing punch into an absence.',
      ]);
    }
    if (bioPresent) {
      return finish('AGREED', ['The person attended on time and no notification was required.']);
    }
    return finish('UNCERTAIN');
  }

  /* ---- a WhatsApp notification exists ---- */
  const attendanceSummary = describeBiometric(bio);

  if (isSick) {
    if (bioAbsent || bioSickLeave) {
      reasons.push(`WhatsApp reported sickness and the biometric record shows no attendance.`);
      return finish('SICK_NOTIFIED');
    }
    if (bioPresent) {
      reasons.push(
        `WhatsApp reported sickness, but the attendance file shows attendance (${attendanceSummary}). The biometric record is not overruled by the message.`,
      );
      return finish('WHATSAPP_ABSENT_BUT_PRESENT');
    }
    if (bioHasNoPunch && !input.employeeKnownToAttendance) {
      reasons.push('WhatsApp reported sickness and this person does not appear in the attendance files at all.');
      return finish('SICK_NO_BIOMETRIC');
    }
    reasons.push('WhatsApp reported sickness but the biometric record could not be evaluated.');
    return finish('SICK_NOTIFIED');
  }

  if (isAbsentClaim || hasAbsenceContext) {
    if (bioAbsent) {
      reasons.push(
        'WhatsApp reported an absence and the attendance files confirm that there is no valid punch.',
      );
      return finish('ABSENT_NOTIFIED');
    }
    if (bioPresent) {
      reasons.push(
        `WhatsApp reported that the person would not be in, but the biometric record shows attendance (${attendanceSummary}).`,
      );
      return finish('WHATSAPP_ABSENT_BUT_PRESENT');
    }
    if (!input.employeeKnownToAttendance) {
      reasons.push(
        'WhatsApp reported an absence but this person does not appear in the attendance files — there is no biometric record to compare with.',
      );
      return finish('WHATSAPP_REPORT_NO_BIOMETRIC');
    }
    reasons.push(
      'WhatsApp reported an absence; the attendance file has no usable entry for this day, so the notification stands unchallenged.',
    );
    return finish('ABSENT_NOTIFIED');
  }

  if (isLateClaim) {
    if (bio.isLate) {
      reasons.push(
        `WhatsApp reported lateness and the biometric first punch (${attendanceSummary}) confirms it.`,
      );
      return finish('LATE_NOTIFIED');
    }
    if (bioPresent) {
      reasons.push(
        `WhatsApp reported lateness but the biometric first punch (${attendanceSummary}) does NOT confirm it. The message is recorded as an unconfirmed claim, not as proof.`,
      );
      return finish('WHATSAPP_LATE_NOT_CONFIRMED');
    }
    if (bioAbsent || bioSickLeave) {
      reasons.push(
        'WhatsApp reported lateness, but the biometric record shows no attendance at all for this day — the two systems do not agree.',
      );
      return finish('WHATSAPP_LATE_NO_BIOMETRIC');
    }
    reasons.push('WhatsApp reported lateness but there is no biometric record for this day.');
    return finish('WHATSAPP_LATE_NO_BIOMETRIC');
  }

  if (isEarlyClaim) {
    if (bio.leftEarly) {
      reasons.push('WhatsApp reported leaving early and the biometric last punch confirms it.');
      return finish('LEFT_EARLY_NOTIFIED');
    }
    if (bioPresent) {
      reasons.push(
        `WhatsApp reports the person left/went home, but the biometric last punch (${attendanceSummary}) does not show an early departure.`,
      );
      return finish('WHATSAPP_CLAIM_NOT_CONFIRMED');
    }
    reasons.push(
      'WhatsApp reports the person left, but there is no biometric record for this day.',
    );
    return finish('WHATSAPP_PRESENT_NO_BIOMETRIC');
  }

  if (isOnTheWay) {
    if (bioPresent) {
      return finish('AGREED', [
        '"On the way" is not an absence: the biometric record shows the person attended.',
      ]);
    }
    reasons.push(
      'WhatsApp says the person was on the way, but no biometric attendance was found. This is a discrepancy, not an automatic absence.',
    );
    return finish('WHATSAPP_PRESENT_NO_BIOMETRIC');
  }

  // Only an unrecognised / personal message
  if (bioAbsent) {
    return finish('ABSENT_NOTIFIED', [
      `A WhatsApp message was found ("${wa.statusLabel}") and the biometric record shows no attendance.`,
    ]);
  }
  if (bio.isLate) {
    return finish('LATE_NOTIFIED', [
      `A WhatsApp message was found ("${wa.statusLabel}") and the biometric record shows a late arrival.`,
    ]);
  }
  if (bioPresent) {
    return finish('AGREED', [
      `A WhatsApp message was found ("${wa.statusLabel}") and the biometric record shows attendance.`,
    ]);
  }
  return finish('UNCERTAIN');
}

/* ------------------------------------------------------------------ *
 * Event rows
 * ------------------------------------------------------------------ */

function buildEventRow(params: {
  message: WhatsAppMessage;
  subjectText: string;
  employeeId: string | null;
  employeeName: string | null;
  department: string | null;
  event: StaffEventType;
  match: NameMatch | null;
  matchStatus: MatchStatus;
  biometricSummary: string;
  nameConfidence: number;
  nameTier: NameMatch['tier'];
  evidence: EvidenceItem[];
  bucket?: WhatsAppEventRow[];
}): WhatsAppEventRow {
  const { message, event, match } = params;
  const audience = message.classification.audience;
  const row: WhatsAppEventRow = {
    id: `wae-${message.id}-${params.subjectText || 'none'}-${event}`.replace(/\s+/g, '_'),
    messageId: message.id,
    date: message.date,
    timeText: message.timeText,
    minutesOfDay: message.minutesOfDay,
    sender: message.sender,
    subjectText: params.subjectText,
    employeeId: params.employeeId,
    employeeName: params.employeeName,
    department: params.department,
    event,
    eventPhrase:
      message.classification.events.find((candidate) => candidate.type === event)?.phrase ?? '',
    originalMessage: message.raw,
    audience,
    classificationReason:
      [
        `Classified as ${audience.toUpperCase()} (confidence ${Math.round(
          message.classification.audienceConfidence * 100,
        )}%).`,
        ...message.classification.audienceReasons,
      ].join(' '),
    matchStatus: params.matchStatus,
    matchLabel: matchStatusMeta(params.matchStatus).shortLabel,
    nameConfidence: params.nameConfidence,
    nameTier: params.nameTier,
    biometricSummary: params.biometricSummary,
    confidence:
      audience === 'uncertain' || params.nameTier === 'unmatched'
        ? 'low'
        : params.nameTier === 'possible'
          ? 'medium'
          : 'high',
    evidence: [
      ...params.evidence,
      ...(match
        ? [
            {
              kind: 'name' as const,
              label: `Name match: "${params.subjectText}" → "${match.employeeName ?? '?'}"`,
              detail: `${match.method}, confidence ${match.confidence}%. ${match.reasons.join(' ')}`,
            },
          ]
        : [
            {
              kind: 'name' as const,
              label: `Name "${params.subjectText}" could not be matched`,
              detail: 'Map this name to an employee in the Review Center to audit it.',
            },
          ]),
      {
        kind: 'rule' as const,
        label: 'Event classification',
        detail: `${EVENT_LABELS[event]} — matched phrase: ${
          message.classification.events.find((candidate) => candidate.type === event)?.phrase ||
          '(no explicit keyword)'
        }`,
      },
    ],
  };
  params.bucket?.push(row);
  return row;
}
