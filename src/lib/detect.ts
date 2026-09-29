/**
 * File type detection.
 *
 * Names lie (e.g. "attendence11.csv.txt"), so detection is driven by the
 * content and only *supported* by the extension. The user can always override
 * the detected type before running the analysis.
 */

import type { DetectionResult, FileKind } from './types';

const WHATSAPP_LINE =
  /^\s*[\u200e\u200f]?(?:\[[^,\]]+,\s*[^\]\u200e\u200f]+\]|\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4},\s*\d{1,2}[:.]\d{2})/;

const WHATSAPP_AUTHOR = /^\s*(?:\[[^\]]+\]|\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4},\s*\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?)\s*[-–—]?\s*[^:]{1,60}:\s?\S/;

/**
 * Markdown chat exports (spec 39 formats B/F) look nothing like a raw WhatsApp
 * .txt export, so they get their own structural patterns. Detection looks at
 * the *shape* of the file, never at stray words such as "date" or "late".
 */
const MD_TIME_SENDER = /^\s*\[\s*\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?\s*\]\s*\*{0,2}[^*:]{1,60}\*{0,2}\s*[:：]/;

const MD_DATE_HEADING =
  /^\s*(?:#{1,6}\s+)?(?:\*\*|__)?\s*(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s*(?:\*\*|__)?\s*$/;

const ISO_CHAT_HEADER = /^\s*\[\s*\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/;

const ATTENDANCE_MARKERS = [
  'clock in',
  'clock out',
  'check in',
  'check out',
  'checkin',
  'checkout',
  'punch',
  'employee id',
  'employee name',
  'emp id',
  'emp no',
  'staff id',
  'department',
  'attendance',
  'time in',
  'time out',
  'sign in',
  'sign out',
  'date',
  'total hours',
  'late',
  'early',
];

export function countLines(text: string, limit = 4000): string[] {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, limit);
}

function countMatches(lines: string[], ratioOf: (line: string) => boolean, sample = 600): number {
  const considered = lines.filter((line) => line.trim() !== '').slice(0, sample);
  if (considered.length === 0) return 0;
  const hits = considered.filter(ratioOf).length;
  return hits / considered.length;
}

function firstRowDelimiterScore(text: string): { delimiter: string | null; columns: number } {
  const lines = countLines(text, 40).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { delimiter: null, columns: 0 };
  const candidates = [',', ';', '\t', '|'];
  let best = { delimiter: null as string | null, columns: 0, score: 0 };
  for (const delimiter of candidates) {
    const counts = lines.slice(0, 20).map((line) => line.split(delimiter).length);
    if (counts.length === 0) continue;
    const average = counts.reduce((sum, value) => sum + value, 0) / counts.length;
    const consistent =
      counts.filter((value) => Math.abs(value - average) <= 1).length / counts.length;
    if (average > 1 && consistent >= 0.8 && average * consistent > best.score) {
      best = { delimiter, columns: Math.round(average), score: average * consistent };
    }
  }
  return { delimiter: best.delimiter, columns: best.columns };
}

export function detectFileType(fileName: string, text: string): DetectionResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const lowerName = String(fileName ?? '').toLowerCase();
  const extension = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : '';
  const lines = countLines(text, 1500);
  const nonEmpty = lines.filter((line) => line.trim() !== '');

  const isXlsx = extension === '.xlsx' || extension === '.xls' || extension === '.xlsm';

  const whatsappHeaderRatio = countMatches(lines, (line) => WHATSAPP_LINE.test(line));
  const whatsappAuthorRatio = countMatches(lines, (line) => WHATSAPP_AUTHOR.test(line));
  const mdTimeSenderRatio = countMatches(lines, (line) => MD_TIME_SENDER.test(line));
  const mdHeadingCount = lines.filter((line) => MD_DATE_HEADING.test(line)).length;
  const isoChatRatio = countMatches(lines, (line) => ISO_CHAT_HEADER.test(line));

  const dateLikeHeaders = lines
    .slice(0, 8)
    .filter((line) =>
      /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b\s*[,]?\s*\d{1,2}[-/.]\d{1,2}/i.test(
        line,
      ),
    ).length;

  const markerHits = ATTENDANCE_MARKERS.filter((marker) =>
    text.slice(0, 4000).toLowerCase().includes(marker),
  );

  const timeRatio = countMatches(lines, (line) => /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(line));
  const { delimiter, columns } = firstRowDelimiterScore(text);

  let whatsappScore = whatsappHeaderRatio * 2 + whatsappAuthorRatio * 2;
  let attendanceScore = 0;

  if (mdTimeSenderRatio > 0.15) {
    whatsappScore += mdTimeSenderRatio * 3;
    reasons.push(
      `${Math.round(mdTimeSenderRatio * 100)}% of lines match the markdown chat pattern "[time] **Sender:** message".`,
    );
  }
  if (mdHeadingCount >= 2) {
    whatsappScore += 1;
    reasons.push(`${mdHeadingCount} date heading(s) in markdown style (e.g. "## 1 September 2026").`);
  }
  if (isoChatRatio > 0.15) {
    whatsappScore += isoChatRatio * 2;
    reasons.push(`${Math.round(isoChatRatio * 100)}% of lines start with an ISO chat timestamp ([YYYY-MM-DD HH:MM]).`);
  }

  if (isXlsx) {
    attendanceScore += 3;
    reasons.push('Excel workbook (.xlsx/.xls) — treated as attendance data.');
  }

  if (delimiter && columns >= 3) {
    attendanceScore += 1.2;
    reasons.push(
      `Consistent "${delimiter === '\t' ? 'TAB' : delimiter}" separated rows with ~${columns} columns.`,
    );
  }
  if (markerHits.length >= 2) {
    attendanceScore += Math.min(markerHits.length, 5) * 0.35;
    reasons.push(`Attendance column headers found: ${markerHits.slice(0, 6).join(', ')}.`);
  }
  if (dateLikeHeaders > 0) {
    attendanceScore += 0.6;
    reasons.push('First rows contain date-like column headings.');
  }
  if (timeRatio > 0.25 && whatsappHeaderRatio < 0.2) {
    attendanceScore += 0.5;
    reasons.push(
      `${Math.round(timeRatio * 100)}% of lines contain a clock time without a chat timestamp.`,
    );
  }
  if (/^[\s\d]*$/.test(nonEmpty[0] ?? '') && nonEmpty.length > 1) {
    // headless CSV with numbers only — often a machine export
    attendanceScore += 0.2;
  }

  const chatShaped =
    whatsappHeaderRatio > 0.3 ||
    mdTimeSenderRatio > 0.15 ||
    isoChatRatio > 0.15 ||
    (mdHeadingCount >= 3 && mdTimeSenderRatio > 0.05);
  if (chatShaped && markerHits.length > 0) {
    warnings.push(
      'The file contains chat timestamps *and* spreadsheet-like words — the chat structure was given priority. Check the detected type if this is wrong.',
    );
  }
  if (whatsappHeaderRatio > 0.3) {
    reasons.push(
      `${Math.round(whatsappHeaderRatio * 100)}% of lines start with a WhatsApp timestamp header.`,
    );
  }
  if (whatsappAuthorRatio > 0.25) {
    reasons.push(
      `${Math.round(whatsappAuthorRatio * 100)}% of lines match "Sender: message".`,
    );
  }
  if (extension === '.md') {
    whatsappScore += 0.4;
    reasons.push('Markdown (.md) export — typical for WhatsApp chat exports.');
  }
  if (lowerName.includes('chat') || lowerName.includes('whatsapp') || lowerName.includes('whats')) {
    whatsappScore += 0.6;
    reasons.push('File name suggests a chat export.');
  }
  if (lowerName.includes('attend') || lowerName.includes('attendance') || lowerName.includes('report')) {
    attendanceScore += 0.5;
    reasons.push('File name suggests attendance data.');
  }

  if (whatsappHeaderRatio > 0 && timeRatio > 0.5 && dateLikeHeaders > 0) {
    warnings.push(
      'This file contains both chat timestamps and tabular times — check the detected type before analysing.',
    );
  }

  let kind: FileKind = 'unknown';
  let confidence = 0;

  if (whatsappScore >= attendanceScore && whatsappScore > 0.6) {
    kind = 'whatsapp';
    confidence = Math.min(1, whatsappScore / 3);
  } else if (attendanceScore > whatsappScore && attendanceScore > 0.8) {
    kind = 'attendance';
    confidence = Math.min(1, attendanceScore / 4);
  } else {
    kind = 'unknown';
    confidence = 0.2;
    warnings.push(
      'The file could not be identified with confidence. Choose the type manually (WhatsApp export or attendance file).',
    );
  }

  if (nonEmpty.length === 0) {
    kind = 'unknown';
    confidence = 0;
    warnings.push('The file appears to be empty.');
  }

  return { kind, confidence, reasons, warnings, delimiter: delimiter ?? undefined };
}

/** Short label used in the UI. */
export const FILE_KIND_LABELS: Record<FileKind, string> = {
  whatsapp: 'WhatsApp chat export',
  attendance: 'Attendance file',
  unknown: 'Unrecognised file',
};
