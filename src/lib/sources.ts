/**
 * Attendance source comparison (specification item 48).
 *
 * `attendence.csv` and `attendence11.csv.txt` may be two views of the same
 * attendance information. Before anything is counted, the app works out what
 * the relationship between the uploaded files actually is, explains it in plain
 * language, and lets the administrator decide which source is authoritative.
 * Employees and days are never double-counted.
 */

import { formatDisplayDate } from './dates';
import type {
  AttendanceFileSummary,
  AttendanceRecord,
  SourceComparison,
} from './types';

const RELATION_LABELS: Record<SourceComparison['relation'], string> = {
  'same-data': 'These files appear to describe the same attendance period.',
  'different-view': 'These files are two views of the same period (same days, differently laid out).',
  complementary: 'These files contain complementary information (each one has data the other does not).',
  conflicting: 'These files contain conflicting values for the same employee and day.',
  unrelated: 'These files describe different periods or different employees.',
};

/** Punch signature used to decide whether two records say the same thing. */
function punchSignature(record: AttendanceRecord): string {
  return [...record.punches]
    .map((punch) => punch.minutesOfDay)
    .sort((a, b) => a - b)
    .join(',');
}

export interface SourceComparisonInput {
  summaries: AttendanceFileSummary[];
  /** canonical records grouped by the file they came from */
  perFileRecords: Map<string, AttendanceRecord[]>;
}

export function compareAttendanceSources(input: SourceComparisonInput): SourceComparison[] {
  const { summaries, perFileRecords: byFile } = input;

  const comparisons: SourceComparison[] = [];

  for (let first = 0; first < summaries.length; first += 1) {
    for (let second = first + 1; second < summaries.length; second += 1) {
      const summaryA = summaries[first];
      const summaryB = summaries[second];
      const recordsA = byFile.get(summaryA.fileId) ?? [];
      const recordsB = byFile.get(summaryB.fileId) ?? [];

      const keysA = new Set(recordsA.map((record) => `${record.employeeId}__${record.date}`));
      const keysB = new Set(recordsB.map((record) => `${record.employeeId}__${record.date}`));
      const overlap = [...keysA].filter((key) => keysB.has(key));
      const onlyInFirst = [...keysA].filter((key) => !keysB.has(key)).length;
      const onlyInSecond = [...keysB].filter((key) => !keysA.has(key)).length;

      const signatureA = new Map(recordsA.map((record) => [`${record.employeeId}__${record.date}`, punchSignature(record)]));
      const signatureB = new Map(recordsB.map((record) => [`${record.employeeId}__${record.date}`, punchSignature(record)]));
      let conflictingValues = 0;
      for (const key of overlap) {
        if ((signatureA.get(key) ?? '') !== (signatureB.get(key) ?? '')) conflictingValues += 1;
      }

      const employeesA = new Set(recordsA.map((record) => record.employeeId));
      const employeesB = new Set(recordsB.map((record) => record.employeeId));
      const employeeOverlap = [...employeesA].filter((id) => employeesB.has(id)).length;

      const datesA = new Set(recordsA.map((record) => record.date));
      const datesB = new Set(recordsB.map((record) => record.date));
      const dateOverlapDays = [...datesA].filter((date) => datesB.has(date)).length;

      const smaller = Math.max(1, Math.min(keysA.size, keysB.size));
      const overlapRatio = overlap.length / smaller;
      const sameLayout = summaryA.format === summaryB.format;

      let relation: SourceComparison['relation'];
      if (keysA.size === 0 || keysB.size === 0) {
        relation = 'unrelated';
      } else if (conflictingValues > 0 && conflictingValues > overlap.length * 0.2) {
        relation = 'conflicting';
      } else if (overlapRatio >= 0.8) {
        relation = sameLayout ? 'same-data' : 'different-view';
      } else if (overlap.length > 0) {
        relation = 'complementary';
      } else if (employeeOverlap > 0 || dateOverlapDays > 0) {
        relation = 'complementary';
      } else {
        relation = 'unrelated';
      }

      const pieces = [
        `${summaryA.fileName} (${summaryA.format}): ${recordsA.length} record(s), ${employeesA.size} employee(s).`,
        `${summaryB.fileName} (${summaryB.format}): ${recordsB.length} record(s), ${employeesB.size} employee(s).`,
        `${overlap.length} employee-day(s) appear in both files, ${onlyInFirst} only in the first and ${onlyInSecond} only in the second.`,
        `${employeeOverlap} employee(s) and ${dateOverlapDays} date(s) overlap.`,
      ];
      if (conflictingValues > 0) {
        pieces.push(
          `${conflictingValues} shared day(s) have different punch values — the difference is shown per day so nothing is silently overwritten.`,
        );
      }
      if (relation === 'complementary') {
        pieces.push(
          'Using both files adds days/employees that would otherwise be missing; shared days keep the more complete record.',
        );
      }
      if (dateOverlapDays === 0) {
        pieces.push('The two files cover different date ranges.');
      } else {
        pieces.push(
          `These files appear to describe the same attendance period (${dateOverlapDays} shared date(s)). Nothing is double-counted: each employee-day is counted once and the file used for it is stated per day.`,
        );
      }

      comparisons.push({
        fileIds: [summaryA.fileId, summaryB.fileId],
        fileNames: [summaryA.fileName, summaryB.fileName],
        formats: [summaryA.format, summaryB.format],
        relation,
        relationLabel: RELATION_LABELS[relation],
        overlapRecords: overlap.length,
        onlyInFirst,
        onlyInSecond,
        conflictingValues,
        employeeOverlap,
        dateOverlapDays,
        explanation: pieces.join(' '),
        recommendation:
          relation === 'same-data' || relation === 'different-view' ? 'use-one' : 'use-both',
      });
    }
  }

  return comparisons;
}

/* ------------------------------------------------------------------ *
 * Merging with a source preference (spec 48)
 * ------------------------------------------------------------------ */

export interface MergePreference {
  /** 'auto' | 'both' | a concrete file id that must win */
  primaryAttendanceSource: string;
}

export interface MergeDecision {
  key: string;
  employeeId: string;
  date: string;
  usedFileId: string;
  usedFileName: string;
  otherFileIds: string[];
  reason: string;
}

/**
 * Chooses the winning record for one employee/day. The rule is deliberately
 * simple and explainable:
 *  - a file chosen by the administrator always wins;
 *  - otherwise the record with more punches (then more readable data) wins;
 *  - ties go to the file that was uploaded first.
 */
export function chooseRecord(
  candidates: { record: AttendanceRecord; fileId: string; fileName: string; fileIndex: number }[],
  preference: MergePreference,
): MergeDecision {
  const sorted = [...candidates].sort((a, b) => {
    if (preference.primaryAttendanceSource !== 'auto' && preference.primaryAttendanceSource !== 'both') {
      const aPrimary = a.fileId === preference.primaryAttendanceSource ? 1 : 0;
      const bPrimary = b.fileId === preference.primaryAttendanceSource ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
    }
    if (b.record.punches.length !== a.record.punches.length) {
      return b.record.punches.length - a.record.punches.length;
    }
    if (b.record.markers.length !== a.record.markers.length) {
      return b.record.markers.length - a.record.markers.length;
    }
    return a.fileIndex - b.fileIndex;
  });

  const winner = sorted[0];
  const losers = sorted.slice(1);
  const reason =
    preference.primaryAttendanceSource === winner.fileId
      ? `${winner.fileName} is the source you selected as primary.`
      : `Most complete record (${winner.record.punches.length} punch(es)) among ${sorted.length} sources.`;

  return {
    key: `${winner.record.employeeId}__${winner.record.date}`,
    employeeId: winner.record.employeeId,
    date: winner.record.date,
    usedFileId: winner.fileId,
    usedFileName: winner.fileName,
    otherFileIds: losers.map((entry) => entry.fileId),
    reason,
  };
}

export function describeSourceNotes(decisions: MergeDecision[]): string[] {
  const byDate = new Map<string, MergeDecision[]>();
  for (const decision of decisions) {
    const list = byDate.get(decision.date) ?? [];
    list.push(decision);
    byDate.set(decision.date, list);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => {
      const files = [...new Set(list.flatMap((decision) => [decision.usedFileName, ...decision.otherFileIds.map(() => decision.usedFileName)]))];
      const used = [...new Set(list.map((decision) => decision.usedFileName))].join(', ');
      return `${formatDisplayDate(date)}: ${list.length} employee-day(s) appear in more than one attendance file (${files.join(', ')}) — ${used} was used for the calculation. ${list[0].reason}`;
    });
}
