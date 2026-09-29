import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateBiometric, DEFAULT_SETTINGS, settingsWithDefaults } from '../src/lib/rules';
import { deriveMatchStatus } from '../src/lib/audit';
import { analyze } from '../src/lib/analyze';
import { emptyCorrections } from '../src/lib/types';
import type { AttendanceEmployee, AttendanceRecord, WhatsAppEvidenceSlice } from '../src/lib/types';

const settings = settingsWithDefaults({
  ...DEFAULT_SETTINGS,
  fallbackYear: 2026,
});

describe('Specification Section 22: Mandatory Biometric Test Cases', () => {
  // TEST 1: Saturday-Wednesday, First punch = 06:45 -> Expected: ON TIME
  it('TEST 1: Saturday-Wednesday with first punch = 06:45 is ON TIME', () => {
    // 2026-09-08 is Tuesday
    const record: AttendanceRecord = {
      key: '101__2026-09-08',
      employeeId: '101',
      date: '2026-09-08',
      cells: [{ raw: '06:45 13:30', punches: [], markers: [], parseWarnings: [] }],
      punches: [
        {
          minutesOfDay: 6 * 60 + 45, // 06:45 = 405
          text: '06:45',
          rawCell: '06:45',
          order: 0,
          fileId: 'f1',
          fileName: 'attendance.csv',
          rowNumber: 2,
          columnLabel: '8',
        },
        {
          minutesOfDay: 13 * 60 + 30, // 13:30 = 810
          text: '13:30',
          rawCell: '13:30',
          order: 1,
          fileId: 'f1',
          fileName: 'attendance.csv',
          rowNumber: 2,
          columnLabel: '8',
        },
      ],
      firstPunch: 6 * 60 + 45,
      lastPunch: 13 * 60 + 30,
      punchCount: 2,
      markers: [],
      parseWarnings: [],
      sourceFileIds: ['f1'],
    };

    const bio = evaluateBiometric({
      date: '2026-09-08',
      employeeName: 'Ahmed',
      record,
      settings,
      attendanceDataAvailable: true,
      employeeKnownToAttendance: true,
    });

    expect(bio.isLate).toBe(false);
    expect(bio.onTime).toBe(true);
    expect(bio.lateByMinutes).toBeNull();
    expect(bio.status).toBe('PRESENT');
  });

  // TEST 2: Saturday-Wednesday, First punch = 06:46 -> Expected: LATE, 1 minute
  it('TEST 2: Saturday-Wednesday with first punch = 06:46 is LATE by 1 minute', () => {
    // 2026-09-08 is Tuesday
    const record: AttendanceRecord = {
      key: '101__2026-09-08',
      employeeId: '101',
      date: '2026-09-08',
      cells: [{ raw: '06:46', punches: [], markers: [], parseWarnings: [] }],
      punches: [
        {
          minutesOfDay: 6 * 60 + 46, // 06:46 = 406
          text: '06:46',
          rawCell: '06:46',
          order: 0,
          fileId: 'f1',
          fileName: 'attendance.csv',
          rowNumber: 2,
          columnLabel: '8',
        },
      ],
      firstPunch: 6 * 60 + 46,
      lastPunch: 6 * 60 + 46,
      punchCount: 1,
      markers: [],
      parseWarnings: [],
      sourceFileIds: ['f1'],
    };

    const bio = evaluateBiometric({
      date: '2026-09-08',
      employeeName: 'Ahmed',
      record,
      settings,
      attendanceDataAvailable: true,
      employeeKnownToAttendance: true,
    });

    expect(bio.isLate).toBe(true);
    expect(bio.onTime).toBe(false);
    expect(bio.lateByMinutes).toBe(1);
    expect(bio.status).toBe('LATE');
  });

  // TEST 3: Thursday, First punch = 08:00 -> Expected: ON TIME
  it('TEST 3: Thursday with first punch = 08:00 is ON TIME', () => {
    // 2026-09-10 is Thursday
    const record: AttendanceRecord = {
      key: '101__2026-09-10',
      employeeId: '101',
      date: '2026-09-10',
      cells: [{ raw: '08:00 13:30', punches: [], markers: [], parseWarnings: [] }],
      punches: [
        {
          minutesOfDay: 8 * 60 + 0, // 08:00 = 480
          text: '08:00',
          rawCell: '08:00',
          order: 0,
          fileId: 'f1',
          fileName: 'attendance.csv',
          rowNumber: 2,
          columnLabel: '10',
        },
        {
          minutesOfDay: 13 * 60 + 30, // 13:30 = 810
          text: '13:30',
          rawCell: '13:30',
          order: 1,
          fileId: 'f1',
          fileName: 'attendance.csv',
          rowNumber: 2,
          columnLabel: '10',
        },
      ],
      firstPunch: 8 * 60 + 0,
      lastPunch: 13 * 60 + 30,
      punchCount: 2,
      markers: [],
      parseWarnings: [],
      sourceFileIds: ['f1'],
    };

    const bio = evaluateBiometric({
      date: '2026-09-10',
      employeeName: 'Ahmed',
      record,
      settings,
      attendanceDataAvailable: true,
      employeeKnownToAttendance: true,
    });

    expect(bio.isLate).toBe(false);
    expect(bio.onTime).toBe(true);
    expect(bio.lateByMinutes).toBeNull();
    expect(bio.status).toBe('PRESENT');
  });

  // TEST 4: Thursday, First punch = 08:01 -> Expected: LATE, 1 minute
  it('TEST 4: Thursday with first punch = 08:01 is LATE by 1 minute', () => {
    // 2026-09-10 is Thursday
    const record: AttendanceRecord = {
      key: '101__2026-09-10',
      employeeId: '101',
      date: '2026-09-10',
      cells: [{ raw: '08:01', punches: [], markers: [], parseWarnings: [] }],
      punches: [
        {
          minutesOfDay: 8 * 60 + 1, // 08:01 = 481
          text: '08:01',
          rawCell: '08:01',
          order: 0,
          fileId: 'f1',
          fileName: 'attendance.csv',
          rowNumber: 2,
          columnLabel: '10',
        },
      ],
      firstPunch: 8 * 60 + 1,
      lastPunch: 8 * 60 + 1,
      punchCount: 1,
      markers: [],
      parseWarnings: [],
      sourceFileIds: ['f1'],
    };

    const bio = evaluateBiometric({
      date: '2026-09-10',
      employeeName: 'Ahmed',
      record,
      settings,
      attendanceDataAvailable: true,
      employeeKnownToAttendance: true,
    });

    expect(bio.isLate).toBe(true);
    expect(bio.onTime).toBe(false);
    expect(bio.lateByMinutes).toBe(1);
    expect(bio.status).toBe('LATE');
  });

  // TEST 5: Employee has first punch 06:52 on Tuesday. No WhatsApp message.
  // Expected: PRESENT, LATE, 7 late minutes, UNNOTIFIED LATE
  it('TEST 5: Employee with 06:52 punch on Tuesday and NO WhatsApp -> LATE, 7 mins, UNNOTIFIED LATE', () => {
    const record: AttendanceRecord = {
      key: '101__2026-09-08',
      employeeId: '101',
      date: '2026-09-08',
      cells: [{ raw: '06:52', punches: [], markers: [], parseWarnings: [] }],
      punches: [
        {
          minutesOfDay: 6 * 60 + 52, // 06:52 = 412
          text: '06:52',
          rawCell: '06:52',
          order: 0,
          fileId: 'f1',
          fileName: 'attendance.csv',
          rowNumber: 2,
          columnLabel: '8',
        },
      ],
      firstPunch: 6 * 60 + 52,
      lastPunch: 6 * 60 + 52,
      punchCount: 1,
      markers: [],
      parseWarnings: [],
      sourceFileIds: ['f1'],
    };

    const bio = evaluateBiometric({
      date: '2026-09-08',
      employeeName: 'Ahmed',
      record,
      settings,
      attendanceDataAvailable: true,
      employeeKnownToAttendance: true,
    });

    expect(bio.status).toBe('LATE');
    expect(bio.isLate).toBe(true);
    expect(bio.lateByMinutes).toBe(7); // 412 - 405 = 7

    const waSlice: WhatsAppEvidenceSlice = {
      hasNotification: false,
      events: [],
      senders: [],
      times: [],
      minutesOfDay: null,
      originalMessages: [],
      classificationReasons: [],
      messageIds: [],
      confidence: 0,
      tier: 'unmatched',
      audience: 'staff',
      statusLabel: 'no message',
      reasons: [],
    };

    const derived = deriveMatchStatus({
      biometric: bio,
      whatsapp: waSlice,
      employeeKnownToAttendance: true,
      dateHasOtherStaffMessages: false,
      settings,
    });

    expect(derived.notificationStatus).toBe('not_notified');
    expect(derived.finalStatus).toBe('LATE - UNNOTIFIED');
    expect(['LATE_NOT_NOTIFIED', 'BIOMETRIC_LATE_NO_REPORT']).toContain(derived.status);
  });

  // TEST 6: Employee has no punch on Wednesday. No leave/holiday/exception. No WhatsApp message.
  // Expected: ABSENT, UNNOTIFIED ABSENCE
  it('TEST 6: Employee with no punch on Wednesday, no exception, no WhatsApp -> ABSENT, UNNOTIFIED ABSENCE', () => {
    // 2026-09-09 is Wednesday
    const bio = evaluateBiometric({
      date: '2026-09-09',
      employeeName: 'Ahmed',
      record: null,
      settings,
      attendanceDataAvailable: true,
      employeeKnownToAttendance: true,
    });

    expect(bio.status).toBe('ABSENT');
    expect(bio.isAbsent).toBe(true);
    expect(bio.isLate).toBe(false);

    const waSlice: WhatsAppEvidenceSlice = {
      hasNotification: false,
      events: [],
      senders: [],
      times: [],
      minutesOfDay: null,
      originalMessages: [],
      classificationReasons: [],
      messageIds: [],
      confidence: 0,
      tier: 'unmatched',
      audience: 'staff',
      statusLabel: 'no message',
      reasons: [],
    };

    const derived = deriveMatchStatus({
      biometric: bio,
      whatsapp: waSlice,
      employeeKnownToAttendance: true,
      dateHasOtherStaffMessages: false,
      settings,
    });

    expect(derived.notificationStatus).toBe('not_notified');
    expect(derived.finalStatus).toBe('ABSENT - UNNOTIFIED');
    expect(['ABSENT_NOT_NOTIFIED', 'BIOMETRIC_ABSENCE_NO_REPORT']).toContain(derived.status);
  });

  // TEST 7: Employee has no punch. WhatsApp says: "Teacher X is sick today".
  // Expected: ABSENT, WHATSAPP NOTIFIED, SICK REPORTED, Administrative Status: PENDING REVIEW
  it('TEST 7: Employee with no punch and WhatsApp says "Teacher X is sick today" -> ABSENT, WHATSAPP NOTIFIED, SICK REPORTED, PENDING REVIEW', () => {
    const bio = evaluateBiometric({
      date: '2026-09-09',
      employeeName: 'Teacher X',
      record: null,
      settings,
      attendanceDataAvailable: true,
      employeeKnownToAttendance: true,
    });

    expect(bio.status).toBe('ABSENT');
    expect(bio.isAbsent).toBe(true);

    const waSlice: WhatsAppEvidenceSlice = {
      hasNotification: true,
      events: ['SICK'],
      senders: ['Admin'],
      times: ['06:30'],
      minutesOfDay: 6 * 60 + 30,
      originalMessages: ['Teacher X is sick today'],
      classificationReasons: ['Mentions sickness'],
      messageIds: ['msg-1'],
      confidence: 95,
      tier: 'matched',
      audience: 'staff',
      statusLabel: 'Sick reported',
      reasons: [],
    };

    const derived = deriveMatchStatus({
      biometric: bio,
      whatsapp: waSlice,
      employeeKnownToAttendance: true,
      dateHasOtherStaffMessages: true,
      settings,
    });

    expect(derived.notificationStatus).toBe('notified');
    expect(derived.status).toBe('SICK_NOTIFIED');
    expect(derived.finalStatus).toBe('SICK - NOTIFIED');
  });
});
