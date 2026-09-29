import { describe, expect, it } from 'vitest';
import { deriveMatchStatus, buildWhatsappSlice, resolveMessageTargets } from '../src/lib/audit';
import { DEFAULT_SETTINGS, settingsWithDefaults } from '../src/lib/rules';
import type {
  BiometricEvaluation,
  BiometricStatus,
  MatchStatus,
  Settings,
  StaffEventType,
  WhatsAppEvidenceSlice,
  WhatsAppMessage,
} from '../src/lib/types';

const settings: Settings = settingsWithDefaults(DEFAULT_SETTINGS);

function biometric(
  status: BiometricStatus,
  overrides: Partial<BiometricEvaluation> = {},
): BiometricEvaluation {
  return {
    date: '2026-09-08',
    isWorkingDay: true,
    workingDayReason: 'Tuesday is a configured working day.',
    firstPunch: null,
    lastPunch: null,
    punchCount: 0,
    hasRecord: false,
    lateCutoffMinutes: 405,
    lateCutoffLabel: 'General rule: late after 06:45',
    isLate: null,
    lateByMinutes: null,
    isAbsent: null,
    absentReason: '',
    leftEarly: null,
    leftEarlyByMinutes: null,
    onTime: null,
    status,
    statusLabel: status,
    confidence: 0.9,
    caveats: [],
    evidence: [],
    ...overrides,
  };
}

function whatsapp(
  events: StaffEventType[],
  overrides: Partial<WhatsAppEvidenceSlice> = {},
): WhatsAppEvidenceSlice {
  return {
    hasNotification: events.length > 0,
    events,
    statusLabel: events.join(' + '),
    senders: ['Fardosa Kamal'],
    times: ['5:59:00 AM'],
    minutesOfDay: 359,
    originalMessages: [],
    messageIds: [],
    audience: 'staff',
    subjectTexts: [],
    rawDate: '9/8/26',
    confidence: 1,
    reasons: [],
    ...overrides,
  };
}

const derive = (
  bio: BiometricEvaluation,
  wa: WhatsAppEvidenceSlice,
  extra: Partial<Parameters<typeof deriveMatchStatus>[0]> = {},
) =>
  deriveMatchStatus({
    biometric: bio,
    whatsapp: wa,
    employeeKnownToAttendance: true,
    dateHasOtherStaffMessages: false,
    settings,
    ...extra,
  });

describe('cross-reference engine', () => {
  it('1. late + notified', () => {
    const result = derive(
      biometric('LATE', { firstPunch: 410, isLate: true, lateByMinutes: 5, punchCount: 2, onTime: false }),
      whatsapp(['LATE']),
    );
    expect(result.status).toBe<MatchStatus>('LATE_NOTIFIED');
  });

  it('2. late + not notified', () => {
    const result = derive(
      biometric('LATE', { firstPunch: 410, isLate: true, lateByMinutes: 5, punchCount: 2 }),
      whatsapp([]),
    );
    expect(result.status).toBe<MatchStatus>('LATE_NOT_NOTIFIED');
    expect(result.notificationStatus).toBe('not_notified');
  });

  it('3. absent + notified', () => {
    const result = derive(biometric('ABSENT', { isAbsent: true }), whatsapp(['ABSENT']));
    expect(result.status).toBe<MatchStatus>('ABSENT_NOTIFIED');
  });

  it('4. absent + not notified', () => {
    const result = derive(biometric('ABSENT', { isAbsent: true }), whatsapp([]));
    expect(result.status).toBe<MatchStatus>('ABSENT_NOT_NOTIFIED');
  });

  it('5. sick + notified (biometric shows no attendance)', () => {
    const result = derive(biometric('ABSENT', { isAbsent: true }), whatsapp(['SICK', 'ABSENT']));
    expect(result.status).toBe<MatchStatus>('SICK_NOTIFIED');
  });

  it('6. sick + no biometric record at all', () => {
    const result = derive(biometric('DATA_UNAVAILABLE', { isAbsent: null }), whatsapp(['SICK']), {
      employeeKnownToAttendance: false,
      biometric: biometric('ABSENT', { isAbsent: true }),
    });
    // Person exists in the files but has no punch → notified absence
    expect(result.status).toBe<MatchStatus>('SICK_NOTIFIED');
  });

  it('7. left early + notified', () => {
    const result = derive(
      biometric('PRESENT_LEFT_EARLY', { leftEarly: true, leftEarlyByMinutes: 90, punchCount: 2 }),
      whatsapp(['LEFT_EARLY']),
    );
    expect(result.status).toBe<MatchStatus>('LEFT_EARLY_NOTIFIED');
  });

  it('8. WhatsApp reports lateness the machine does not confirm', () => {
    const result = derive(
      biometric('PRESENT', { firstPunch: 398, isLate: false, onTime: true, punchCount: 2 }),
      whatsapp(['LATE']),
    );
    expect(result.status).toBe<MatchStatus>('WHATSAPP_LATE_NOT_CONFIRMED');
    expect(result.reasons.join(' ')).toMatch(/does not confirm/i);
  });

  it('9. biometric late, messages exist that day but none about this arrival', () => {
    const result = derive(
      biometric('LATE', { firstPunch: 412, isLate: true, lateByMinutes: 7, punchCount: 2 }),
      whatsapp([]),
      { dateHasOtherStaffMessages: true },
    );
    expect(result.status).toBe<MatchStatus>('BIOMETRIC_LATE_NO_REPORT');
  });

  it('10. WhatsApp reports absence but the machine shows attendance', () => {
    const result = derive(
      biometric('PRESENT', { firstPunch: 388, punchCount: 2, onTime: true, isLate: false }),
      whatsapp(['ABSENT']),
    );
    expect(result.status).toBe<MatchStatus>('WHATSAPP_ABSENT_BUT_PRESENT');
  });

  it('11. WhatsApp says the person was coming, no biometric evidence', () => {
    const result = derive(biometric('ABSENT', { isAbsent: true }), whatsapp(['ON_THE_WAY']));
    expect(result.status).toBe<MatchStatus>('WHATSAPP_PRESENT_NO_BIOMETRIC');
  });

  it('12. both systems agree', () => {
    const onTime = derive(
      biometric('PRESENT', { firstPunch: 380, isLate: false, onTime: true, punchCount: 2 }),
      whatsapp([]),
    );
    expect(onTime.status).toBe<MatchStatus>('AGREED');
    const onTheWay = derive(
      biometric('PRESENT', { firstPunch: 380, punchCount: 2, onTime: true, isLate: false }),
      whatsapp(['ON_THE_WAY']),
    );
    expect(onTheWay.status).toBe<MatchStatus>('AGREED');
  });

  it('13. uncertain when nothing can be compared', () => {
    const result = derive(biometric('NON_WORKING_DAY', { isWorkingDay: false }), whatsapp(['ABSENT']));
    expect(result.status).toBe<MatchStatus>('UNCERTAIN');
  });

  it('never turns unreadable attendance into an absence', () => {
    const result = derive(biometric('PARSE_ISSUE', { isAbsent: null }), whatsapp([]));
    expect(result.status).toBe<MatchStatus>('BIOMETRIC_PARSE_ISSUE');
  });

  it('does not confirm an early-departure claim that the machine contradicts', () => {
    const result = derive(
      biometric('PRESENT', { firstPunch: 380, lastPunch: 900, punchCount: 2, onTime: true, isLate: false }),
      whatsapp(['LEFT_EARLY']),
    );
    expect(result.status).toBe<MatchStatus>('WHATSAPP_CLAIM_NOT_CONFIRMED');
  });

  it('keeps "on the way" out of the absence statistics', () => {
    const result = derive(
      biometric('LATE', { firstPunch: 420, isLate: true, lateByMinutes: 15, punchCount: 2 }),
      whatsapp(['ON_THE_WAY']),
    );
    expect(result.status).not.toBe<MatchStatus>('ABSENT_NOT_NOTIFIED');
  });
});

describe('message date attribution', () => {
  const message = (raw: string, minutesOfDay: number): WhatsAppMessage =>
    ({
      id: 'm1',
      fileId: 'f1',
      fileName: 'chat.md',
      lineNumber: 1,
      rawLines: [raw],
      raw,
      dateText: '9/8/26',
      date: '2026-09-08',
      timeText: '7:00:00 AM',
      minutesOfDay,
      sender: 'Fardosa Kamal',
      isSystem: false,
      parseWarnings: [],
      classification: {
        audience: 'staff',
        audienceConfidence: 1,
        audienceReasons: [],
        audienceSignals: [],
        events: [],
        mentions: [],
        studentInfo: [],
        busInfo: [],
        notes: [],
      },
    }) as WhatsAppMessage;

  it('uses the message date by default', () => {
    expect(resolveMessageTargets(message('Ikram will be late', 420), settings)).toEqual([
      { date: '2026-09-08', note: null },
    ]);
  });

  it('moves to the previous day for "yesterday"', () => {
    const targets = resolveMessageTargets(message('T. Nuha left early yesterday', 420), settings);
    expect(targets.map((target) => target.date)).toContain('2026-09-07');
  });

  it('adds the following day for messages sent in the evening', () => {
    const targets = resolveMessageTargets(message('Ikram will be late tomorrow morning', 1200), settings);
    expect(targets.map((target) => target.date)).toContain('2026-09-09');
  });
});

describe('notification slices', () => {
  it('reports no notification when only student messages exist', () => {
    const slice = buildWhatsappSlice([], settings, '2026-09-08');
    expect(slice.hasNotification).toBe(false);
    expect(slice.statusLabel).toBe('No WhatsApp message');
  });
});
