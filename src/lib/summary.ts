/**
 * Aggregation layer: turns the flat audit table into employee summaries and the
 * dashboard statistics. No new information is created here — everything is a
 * count over already-audited rows.
 */

import { compareIso } from './dates';
import { MATCH_STATUS_META, matchStatusMeta } from './statuses';
import type {
  AnalysisSummary,
  AuditRecord,
  EmployeeSummary,
  MatchStatus,
  NameMatch,
} from './types';

export function isNotifiedStatus(status: MatchStatus): boolean {
  return status.endsWith('_NOTIFIED') && status !== 'LATE_NOT_NOTIFIED' && status !== 'ABSENT_NOT_NOTIFIED' && status !== 'SICK_NOT_NOTIFIED' && status !== 'LEFT_EARLY_NOT_NOTIFIED';
}

export function buildEmployeeSummaries(
  records: AuditRecord[],
  nameMatches: NameMatch[],
): EmployeeSummary[] {
  const byEmployee = new Map<string, AuditRecord[]>();
  for (const record of records) {
    if (record.whatsappOnly) continue;
    const list = byEmployee.get(record.employeeId) ?? [];
    list.push(record);
    byEmployee.set(record.employeeId, list);
  }

  const namesByEmployee = new Map<string, string[]>();
  for (const match of nameMatches) {
    if (!match.employeeId) continue;
    const list = namesByEmployee.get(match.employeeId) ?? [];
    list.push(match.whatsappName);
    namesByEmployee.set(match.employeeId, list);
  }

  const summaries: EmployeeSummary[] = [];
  for (const [employeeId, list] of byEmployee.entries()) {
    const sorted = [...list].sort((a, b) => compareIso(b.date, a.date));
    const chronological = [...list].sort((a, b) => compareIso(a.date, b.date));
    const first = chronological[0];
    const last = chronological[chronological.length - 1];

    const workingRecords = sorted.filter((record) => record.biometric.isWorkingDay);
    const presentDays = sorted.filter(
      (record) =>
        record.biometric.status === 'PRESENT' ||
        record.biometric.status === 'LATE' ||
        record.biometric.status === 'PRESENT_LEFT_EARLY',
    ).length;
    const onTimeDays = sorted.filter(
      (record) =>
        (record.biometric.status === 'PRESENT' ||
          record.biometric.status === 'PRESENT_LEFT_EARLY') &&
        record.biometric.isLate !== true,
    ).length;
    const lateDays = sorted.filter((record) => record.biometric.isLate === true).length;
    const absentDays = sorted.filter((record) => record.biometric.status === 'ABSENT').length;
    const sickDays = sorted.filter(
      (record) =>
        record.biometric.status === 'SICK_LEAVE' ||
        record.whatsapp.events.includes('SICK') ||
        record.whatsapp.events.includes('HOSPITAL'),
    ).length;
    const leftEarlyDays = sorted.filter((record) => record.biometric.leftEarly === true).length;

    const unnotifiedLateDays = sorted.filter(
      (record) => record.biometric.isLate === true && matchStatusMeta(record.matchStatus).isUnnotified,
    ).length;
    const unnotifiedAbsenceDays = sorted.filter(
      (record) => record.biometric.status === 'ABSENT' && matchStatusMeta(record.matchStatus).isUnnotified,
    ).length;

    const notificationIds = new Set<string>();
    for (const record of sorted) {
      if (record.whatsapp.hasNotification) {
        record.whatsapp.messageIds.forEach((id) => notificationIds.add(id));
      }
    }

    const matchedDays = sorted.filter((record) => {
      const meta = matchStatusMeta(record.matchStatus);
      return meta.group === 'ok' || meta.group === 'late' || meta.group === 'absent' || meta.group === 'sick' || meta.group === 'early'
        ? !meta.isConflict && !meta.isUnnotified && record.matchStatus !== 'UNCERTAIN'
        : false;
    }).length;

    const conflictDays = sorted.filter(
      (record) => matchStatusMeta(record.matchStatus).isConflict,
    ).length;
    const uncertainDays = sorted.filter(
      (record) =>
        record.matchStatus === 'UNCERTAIN' ||
        record.matchStatus === 'BIOMETRIC_PARSE_ISSUE' ||
        record.matchStatus === 'WHATSAPP_UNMATCHED_NAME',
    ).length;

    const totalLateMinutes = sorted.reduce(
      (sum, record) => sum + (record.biometric.lateByMinutes ?? 0),
      0,
    );
    const excusedAbsenceDays = sorted.filter(
      (record) => record.biometric.status === 'EXCUSED',
    ).length;
    const unexcusedAbsenceDays = absentDays;
    const notifiedLateDays = sorted.filter(
      (record) => record.biometric.isLate === true && record.whatsapp.hasNotification,
    ).length;
    const notifiedAbsenceDays = sorted.filter(
      (record) => record.biometric.status === 'ABSENT' && record.whatsapp.hasNotification,
    ).length;

    const attendanceRate =
      workingRecords.length > 0
        ? Math.round((presentDays / workingRecords.length) * 1000) / 10
        : null;

    summaries.push({
      employeeId,
      name: first?.employeeName ?? employeeId,
      employeeCode: first?.employeeCode ?? null,
      department: first?.department ?? null,
      expectedWorkingDays: workingRecords.length,
      presentDays,
      lateDays,
      totalLateMinutes,
      absentDays,
      fullAbsenceDays: absentDays,
      excusedAbsenceDays,
      unexcusedAbsenceDays,
      sickDays,
      leftEarlyDays,
      earlyDepartureDays: leftEarlyDays,
      onTimeDays,
      notifiedLateDays,
      unnotifiedLateDays,
      notifiedAbsenceDays,
      unnotifiedAbsenceDays,
      whatsappNotificationCount: notificationIds.size,
      matchedDays,
      conflictDays,
      uncertainDays,
      workingDaysObserved: workingRecords.length,
      firstDate: first?.date ?? null,
      lastDate: last?.date ?? null,
      whatsappNames: [...new Set(namesByEmployee.get(employeeId) ?? [])],
      history: sorted,
      attendanceRate,
    });
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}

export function buildAnalysisSummary(params: {
  records: AuditRecord[];
  employeeSummaries: EmployeeSummary[];
  nameMatches: NameMatch[];
  messagesTotal: number;
  staffMessages: number;
  studentMessages: number;
  uncertainMessages: number;
  unmatchedMessages: number;
  workingDates: string[];
  employeesInAttendance: number;
  reviewItems: number;
}): AnalysisSummary {
  const {
    records,
    employeeSummaries,
    nameMatches,
    messagesTotal,
    staffMessages,
    studentMessages,
    uncertainMessages,
    unmatchedMessages,
    workingDates,
    employeesInAttendance,
    reviewItems,
  } = params;

  const employeeRecords = records.filter((record) => !record.whatsappOnly);

  const late = employeeRecords.filter((record) => record.biometric.isLate === true);
  const absent = employeeRecords.filter((record) => record.biometric.status === 'ABSENT');
  const sick = employeeRecords.filter(
    (record) =>
      record.biometric.status === 'SICK_LEAVE' ||
      record.whatsapp.events.includes('SICK') ||
      record.whatsapp.events.includes('HOSPITAL'),
  );
  const early = employeeRecords.filter((record) => record.biometric.leftEarly === true);

  const unnotifiedLate = employeeRecords.filter(
    (record) => record.biometric.isLate === true && matchStatusMeta(record.matchStatus).isUnnotified,
  );
  const unnotifiedAbsence = employeeRecords.filter(
    (record) => record.biometric.status === 'ABSENT' && matchStatusMeta(record.matchStatus).isUnnotified,
  );
  const conflicts = employeeRecords.filter(
    (record) => matchStatusMeta(record.matchStatus).isConflict,
  );

  const notificationIds = new Set<string>();
  for (const record of employeeRecords) {
    record.whatsapp.messageIds.forEach((id) => notificationIds.add(id));
  }

  const countByEmployee = (
    source: AuditRecord[],
    get: (record: AuditRecord) => boolean,
  ): { employeeId: string; name: string; count: number }[] => {
    const map = new Map<string, { name: string; count: number }>();
    for (const record of source) {
      if (!get(record)) continue;
      if (record.whatsappOnly) continue;
      const entry = map.get(record.employeeId) ?? { name: record.employeeName, count: 0 };
      entry.count += 1;
      map.set(record.employeeId, entry);
    }
    return [...map.entries()]
      .map(([employeeId, value]) => ({ employeeId, name: value.name, count: value.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  const dateKeys = new Set(employeeRecords.map((record) => record.date));
  const notificationsByDate = [...dateKeys]
    .sort()
    .map((date) => ({
      date,
      count: new Set(
        employeeRecords
          .filter((record) => record.date === date)
          .flatMap((record) => record.whatsapp.messageIds),
      ).size,
    }));

  const unnotifiedByDate = [...dateKeys].sort().map((date) => {
    const dayRecords = employeeRecords.filter((record) => record.date === date);
    return {
      date,
      notified: dayRecords.filter((record) => record.whatsapp.hasNotification).length,
      notNotified: dayRecords.filter((record) => matchStatusMeta(record.matchStatus).isUnnotified)
        .length,
    };
  });

  const attendanceTrend = [...dateKeys].sort().map((date) => {
    const dayRecords = employeeRecords.filter((record) => record.date === date);
    return {
      date,
      present: dayRecords.filter((record) => record.biometric.status === 'PRESENT').length,
      late: dayRecords.filter((record) => record.biometric.isLate === true).length,
      absent: dayRecords.filter((record) => record.biometric.status === 'ABSENT').length,
      sick: dayRecords.filter(
        (record) =>
          record.biometric.status === 'SICK_LEAVE' ||
          record.whatsapp.events.includes('SICK') ||
          record.whatsapp.events.includes('HOSPITAL'),
      ).length,
      notified: dayRecords.filter((record) => record.whatsapp.hasNotification).length,
      unnotified: dayRecords.filter((record) => matchStatusMeta(record.matchStatus).isUnnotified)
        .length,
    };
  });

  const statusCounts = new Map<MatchStatus, number>();
  for (const record of records) {
    statusCounts.set(record.matchStatus, (statusCounts.get(record.matchStatus) ?? 0) + 1);
  }
  const matchStatusCounts = [...statusCounts.entries()]
    .map(([code, count]) => ({
      code,
      label: matchStatusMeta(code).label,
      count,
      tone: matchStatusMeta(code).tone,
    }))
    .sort((a, b) => b.count - a.count);

  const discrepanciesByType = matchStatusCounts.filter((entry) => {
    const meta = MATCH_STATUS_META[entry.code];
    return meta.isConflict || meta.isUnnotified;
  });

  const unmatchedNames = nameMatches.filter(
    (match) => match.tier === 'unmatched' || match.tier === 'possible',
  ).length;

  const employeesInWhatsapp = new Set(
    nameMatches.filter((match) => match.employeeId).map((match) => match.employeeId as string),
  ).size;

  return {
    totalStaff: employeeSummaries.length,
    workingDays: workingDates.length,
    totalLateEvents: late.length,
    totalAbsenceEvents: absent.length,
    totalSickEvents: sick.length,
    totalEarlyDepartures: early.length,
    whatsappNotifications: notificationIds.size,
    unnotifiedLateArrivals: unnotifiedLate.length,
    unnotifiedAbsences: unnotifiedAbsence.length,
    lateNotified: late.length - unnotifiedLate.length,
    absentNotified: absent.length - unnotifiedAbsence.length,
    presentDays: employeeRecords.filter(
      (r) =>
        r.biometric.status === 'PRESENT' ||
        r.biometric.status === 'LATE' ||
        r.biometric.status === 'PRESENT_LEFT_EARLY',
    ).length,
    absentDays: absent.length,
    conflicts: conflicts.length,
    conflictingRecords: conflicts.length,
    unmatchedNames,

    reconciliation: {
      employees: employeesInAttendance,
      workingDays: workingDates.length,
      employeeDayCombinations: employeesInAttendance * workingDates.length,
      present: employeeRecords.filter(
        (r) =>
          r.biometric.status === 'PRESENT' ||
          r.biometric.status === 'LATE' ||
          r.biometric.status === 'PRESENT_LEFT_EARLY',
      ).length,
      late: late.length,
      absent: absent.length,
      lateNotified: late.length - unnotifiedLate.length,
      lateUnnotified: unnotifiedLate.length,
      absentNotified: absent.length - unnotifiedAbsence.length,
      absentUnnotified: unnotifiedAbsence.length,
      conflicts: conflicts.length,
      potentialReview: reviewItems,
    },

    totalMessages: messagesTotal,
    staffMessages,
    studentMessages,
    uncertainMessages,
    unmatchedMessages,

    employeesInAttendance,
    employeesInWhatsapp,
    employeesMatched: nameMatches.filter(
      (match) => match.employeeId && (match.tier === 'matched' || match.tier === 'manual'),
    ).length,
    employeesRequiringReview: nameMatches.filter(
      (match) => !match.manual && (match.tier === 'possible' || match.tier === 'unmatched'),
    ).length,
    auditRecords: records.length,
    workingDayCount: workingDates.length,
    reviewItems,

    lateByEmployee: countByEmployee(employeeRecords, (record) => record.biometric.isLate === true),
    absenceByEmployee: countByEmployee(
      employeeRecords,
      (record) => record.biometric.status === 'ABSENT',
    ),
    sickByEmployee: countByEmployee(employeeRecords, (record) =>
      record.biometric.status === 'SICK_LEAVE' ||
      record.whatsapp.events.includes('SICK') ||
      record.whatsapp.events.includes('HOSPITAL'),
    ),
    earlyByEmployee: countByEmployee(
      employeeRecords,
      (record) => record.biometric.leftEarly === true,
    ),
    notificationsByDate,
    unnotifiedByDate,
    discrepanciesByType,
    attendanceTrend,
    matchStatusCounts,
  };
}
