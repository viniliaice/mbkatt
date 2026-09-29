/**
 * WhatsApp export parser.
 *
 * Accepts the formats produced by WhatsApp "Export chat":
 *
 *   [9/1/26, 5:17:33 AM] Fardosa Kamal: I'll be in late
 *   [09/01/2026, 05:17:33] Fardosa Kamal: I'll be in late
 *   9/1/26, 5:17:33 AM - Fardosa Kamal: I'll be in late
 *   [9/1/26, 5:17:33 AM] ~ Fardosa Kamal: I'll be in late
 *   Messages and calls are end-to-end encrypted.            (system message)
 *   9/1/26, 5:17:33 AM - Fardosa Kamal changed the group name
 *
 * The parser is lossless: every message keeps its raw lines, the exact date and
 * time text, its line number in the file, and every problem it ran into.
 * Classification (staff/student, event type) happens here in a first pass and is
 * refined later by the analysis pipeline once the employee roster is known.
 */

import { detectDateOrder, parseLooseDate } from '../dates';
import { parseWhatsAppTime } from '../time';
import type { DateOrder, WhatsAppMessage } from '../types';
import {
  reclassifyMessage,
  emptyClassifierContext,
  type ClassifyContext,
} from '../classify';

export interface WhatsAppParseOptions {
  fileId: string;
  fileName: string;
  dateOrder: DateOrder;
  fallbackYear: number | null;
  classifier?: ClassifyContext;
  idPrefix?: string;
}

/**
 * Structural evidence about how the file was parsed. Shown in the upload
 * screen so "0 messages" can always be explained (spec 45/50).
 */
export interface WhatsAppParseDiagnostics {
  totalLines: number;
  /** markdown/explicit date headings found (spec 39 format F) */
  dateHeadings: number;
  /** timestamp headers recognised (one per message block) */
  timestamps: number;
  /** blocks where a sender could be identified */
  senderPatterns: number;
  messageBlocks: number;
  /** messages kept for the audit (system lines excluded) */
  parsedMessages: number;
  malformed: number;
  missingSender: number;
  /** continuation lines appended to the previous message (spec 41) */
  recoveredMultiline: number;
  strayLines: number;
  /** which export shapes were recognised in this file */
  formatsDetected: string[];
  sampleLines: string[];
  /** lines that contain a timestamp but were not recognised as headers */
  unrecognisedSamples: string[];
  /** true when timestamps exist but no message could be built */
  formatMismatch: boolean;
}

export interface WhatsAppParseResult {
  messages: WhatsAppMessage[];
  detectedDateOrder: 'MDY' | 'DMY';
  dateOrderEvidence: string[];
  orderAmbiguous: boolean;
  senders: string[];
  parsedDates: number;
  unparsed: { lineNumber: number; raw: string; reason: string }[];
  warnings: string[];
  totalLines: number;
  diagnostics: WhatsAppParseDiagnostics;
}

/* ------------------------------------------------------------------ *
 * Header patterns
 * ------------------------------------------------------------------ */

/** [9/1/26, 5:17:33 AM] Fardosa Kamal: message */
const BRACKET_HEADER =
  /^\s*[\u200e\u200f]?\[([^,\]]+),\s*([^\]\u200e\u200f]+)\]\s*\*{0,2}([^*:]{0,80}?)\*{0,2}\s*[:：]\s?([\s\S]*)$/;

/** [9/1/26, 5:17:33 AM] system text without author */
const BRACKET_SYSTEM_HEADER =
  /^\s*[\u200e\u200f]?\[([^,\]]+),\s*([^\]\u200e\u200f]+)\]\s*([\s\S]*)$/;

/** YYYY-MM-DD, HH:MM - Name: message */
const ISO_DASH_HEADER =
  /^\s*(\d{4}-\d{2}-\d{2}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*\*{0,2}([^*:]{0,80}?)\*{0,2}\s*[:：]\s?([\s\S]*)$/;

/** 9/1/26, 5:17:33 AM - Fardosa Kamal: message */
const DASH_HEADER =
  /^\s*[\u200e\u200f]?(\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/.]\d{1,2}),\s*(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?)\s*[-–—]\s*\*{0,2}([^*:]{0,80}?)\*{0,2}\s*[:：]\s?([\s\S]*)$/;

/** 9/1/26, 5:17:33 AM - Some system text without a colon */
const SYSTEM_DASH =
  /^\s*[\u200e\u200f]?(\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/.]\d{1,2}),\s*(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?)\s*[-–—]\s*([\s\S]*)$/;

/** [2026-09-01 05:17] Fardosa Kamal: message  (spec 39 format C) */
const ISO_BRACKET_HEADER =
  /^\s*[\u200e\u200f]?\[\s*(\d{4}-\d{2}-\d{2})[ T]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?)\s*\]\s*\*{0,2}([^*:]{0,80}?)\*{0,2}\s*[:：]\s?([\s\S]*)$/;

/** [5:17] **Fardosa Kamal:** message  — markdown export, date comes from the heading (spec 39 format B/F) */
const TIME_ONLY_HEADER =
  /^\s*[\u200e\u200f]?\[\s*(\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?)\s*\]\s*\*{0,2}([^*:]{0,80}?)\*{0,2}\s*[:：]\s?([\s\S]*)$/;

/** `## 1 September 2026` / `**September 1, 2026**` / a bare date line (spec 39 format F) */
const HEADING_MARKERS = /^\s*(?:#{1,6}\s*|\*\*|__|\*|_)?([\s\S]*?)(?:\*\*|__|\*|_)?\s*$/;

/** lines that carry a clock time but are not a supported header — used for diagnostics */
const ANY_CLOCK = /\b\d{1,2}[:.]\d{2}(?::\d{2})?\b/;

/**
 * Loose "this line looks like a chat timestamp header" detector, deliberately
 * separate from the strict header parser: when it finds headers that the parser
 * cannot read, the upload screen reports a PARSER FORMAT MISMATCH instead of
 * silently reporting zero messages (spec 45).
 */
const LOOSE_TIMESTAMP = [
  /^\s*[\u200e\u200f]?\[?\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}\s*,\s*\d{1,2}[:.]\d{2}/,
  /^\s*[\u200e\u200f]?\[\s*\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?\s*\]/,
  /^\s*[\u200e\u200f]?\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?\s*(?:\||\||-|–|—|>|=>)/,
  /^\s*\[?\s*\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/,
];

function looksLikeTimestampLine(line: string): boolean {
  return LOOSE_TIMESTAMP.some((pattern) => pattern.test(line));
}

/**
 * Strips a leading markdown emphasis run from a message body. In markdown
 * exports the closing `**` of the sender lands after the separating colon
 * (`[5:17] **Name:** text`), so the body would otherwise start with `**`.
 * Only bold/underline runs are removed — a genuine `* bullet` line is kept.
 */
function stripLeadingEmphasis(body: string): string {
  return body.replace(/^\s*(?:\*\*|__|``)\s*/, '');
}

/** strips markdown emphasis and WhatsApp's invisible direction marks from a sender name */
function cleanAuthor(value: string): string {
  return String(value ?? '')
    .replace(/^[\u200e\u200f~\s]+/, '')
    .replace(/[*_`~]+/g, '')
    .replace(/[\u200e\u200f\s]+$/, '')
    .trim();
}

/** true when a line is *only* a date (a heading), not a message */
function headingDateText(line: string, fallbackYear: number | null): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes(':') || trimmed.includes('[')) return null;
  const match = HEADING_MARKERS.exec(trimmed);
  if (!match) return null;
  const candidate = match[1].trim();
  if (!candidate || candidate.length > 40) return null;
  // must look like a date: digits, or a month name
  if (!/(\d{1,4}[-/.]\d{1,2}|\d{1,2}\s+[A-Za-z]{3,}|[A-Za-z]{3,}\s+\d{1,2})/.test(candidate)) {
    return null;
  }
  const parsed = parseLooseDate(candidate, { order: 'auto', fallbackYear, defaultOrder: 'MDY' });
  return parsed ? candidate : null;
}

const SYSTEM_MARKERS = [
  'messages and calls are end-to-end encrypted',
  'changed the group icon',
  'changed the subject',
  'changed this group',
  'created group',
  'joined using this group',
  'changed their phone number',
  'deleted this message',
  'this message was deleted',
  'you created group',
  'security code changed',
  'disappearing messages',
  'pinned a message',
  'added you',
  'you were added',
];

function looksLikeSystem(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return true;
  return SYSTEM_MARKERS.some((marker) => t.includes(marker));
}

interface RawEntry {
  lineNumber: number;
  rawLines: string[];
  /** date exactly as written, or the heading text the message inherits */
  dateText: string | null;
  timeText: string;
  authorText: string | null;
  body: string;
  system: boolean;
  /** which export shape produced this entry, for the diagnostics panel */
  format: string;
}

function parseHeader(line: string): Omit<RawEntry, 'rawLines' | 'lineNumber'> | null {
  // 1. [date, time] / [date, time] author: body   (formats A, B-with-date)
  let m = BRACKET_HEADER.exec(line);
  if (m) {
    const author = cleanAuthor(m[3]);
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: author || null,
      body: m[4],
      system: !author,
      format: 'bracket-date-time',
    };
  }
  // 2. [2026-09-01 05:17] author: body            (format C)
  m = ISO_BRACKET_HEADER.exec(line);
  if (m) {
    const author = cleanAuthor(m[3]);
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: author || null,
      body: m[4],
      system: !author,
      format: 'iso-bracket',
    };
  }
  // 3. [5:17] **author:** body                    (format B — date inherited from the heading)
  m = TIME_ONLY_HEADER.exec(line);
  if (m) {
    const author = cleanAuthor(m[2]);
    return {
      dateText: null,
      timeText: m[1].trim(),
      authorText: author || null,
      body: m[3],
      system: !author,
      format: 'bracket-time-only',
    };
  }
  // 4. YYYY-MM-DD, HH:MM - author: body
  m = ISO_DASH_HEADER.exec(line);
  if (m) {
    const author = cleanAuthor(m[3]);
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: author || null,
      body: m[4],
      system: !author,
      format: 'iso-dash',
    };
  }
  // 5. 9/1/26, 5:17:33 AM - author: body          (formats D, E)
  m = DASH_HEADER.exec(line);
  if (m) {
    const author = cleanAuthor(m[3]);
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: author || null,
      body: m[4],
      system: !author,
      format: 'dash-date-time',
    };
  }
  // 6. 9/1/26, 5:17 - system text without a colon
  m = SYSTEM_DASH.exec(line);
  if (m) {
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: null,
      body: m[3],
      system: true,
      format: 'dash-system',
    };
  }
  // 7. [date, time] system text without an author
  m = BRACKET_SYSTEM_HEADER.exec(line);
  if (m) {
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: null,
      body: m[3],
      system: true,
      format: 'bracket-system',
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Main entry point
 * ------------------------------------------------------------------ */

export function parseWhatsAppExport(
  text: string,
  options: WhatsAppParseOptions,
): WhatsAppParseResult {
  const warnings: string[] = [];
  const unparsed: { lineNumber: number; raw: string; reason: string }[] = [];
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const prefix = options.idPrefix ?? options.fileId;

  // Pass 1 — collect entries (a message spans every continuation line).
  // Markdown date headings set the date for every message beneath them (format F).
  const entries: RawEntry[] = [];
  const formats = new Set<string>();
  const sampleLines: string[] = [];
  const unrecognisedSamples: string[] = [];
  let current: RawEntry | null = null;
  let strayLines = 0;
  let dateHeadings = 0;
  let recoveredMultiline = 0;
  let missingSender = 0;
  let looseTimestamps = 0;
  let currentDate: string | null = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (looksLikeTimestampLine(line)) looseTimestamps += 1;
    const header = parseHeader(line);
    if (header) {
      if (current) entries.push(current);
      formats.add(header.format);
      if (sampleLines.length < 8 && header.authorText) sampleLines.push(line.trim().slice(0, 160));
      current = { ...header, lineNumber, rawLines: [line], dateText: header.dateText ?? currentDate };
      return;
    }

    // markdown / plain date heading
    const heading = headingDateText(line, options.fallbackYear);
    if (heading) {
      if (current) {
        entries.push(current);
        current = null;
      }
      currentDate = heading;
      dateHeadings += 1;
      formats.add('markdown-date-heading');
      return;
    }

    if (current) {
      current.rawLines.push(line);
      current.body += `\n${line}`;
      if (line.trim() !== '') recoveredMultiline += 1;
      return;
    }

    if (line.trim() !== '') {
      strayLines += 1;
      if (ANY_CLOCK.test(line) && unrecognisedSamples.length < 8) {
        unrecognisedSamples.push(line.trim().slice(0, 160));
      }
    }
  });
  if (current) entries.push(current);

  if (strayLines > 0) {
    warnings.push(
      `${strayLines} line(s) could not be attached to a message — they appear before the first timestamped message, or use a format the parser does not recognise.`,
    );
  }
  if (dateHeadings > 0) {
    warnings.push(
      `${dateHeadings} date heading(s) were used to date the messages that follow them (markdown export).`,
    );
  }

  // Pass 2 — decide the day/month order across every timestamp in the file
  const samples = entries
    .map((entry) => entry.dateText)
    .filter((value): value is string => Boolean(value));
  const detected = detectDateOrder(samples);
  const effectiveOrder: DateOrder =
    options.dateOrder === 'auto' ? detected.order : options.dateOrder;
  if (detected.ambiguous && options.dateOrder === 'auto') {
    warnings.push(
      `Every timestamp in "${options.fileName}" is ambiguous (both parts ≤ 12). Month-first (M/D/Y) was assumed — change it in Settings if that is wrong.`,
    );
  }

  // Pass 3 — build messages
  const classifier = options.classifier ?? emptyClassifierContext();
  const messages: WhatsAppMessage[] = [];
  const senderCount = new Map<string, number>();
  let parsedDates = 0;

  let malformed = 0;

  entries.forEach((entry, index) => {
    const parseWarnings: string[] = [];
    const parsed = parseLooseDate(entry.dateText ?? '', {
      order: effectiveOrder,
      fallbackYear: options.fallbackYear,
      defaultOrder: detected.order,
    });
    if (parsed) {
      parsedDates += 1;
      parseWarnings.push(...parsed.warnings);
    } else if (entry.dateText) {
      malformed += 1;
      parseWarnings.push(`Could not read the date "${entry.dateText}".`);
      unparsed.push({
        lineNumber: entry.lineNumber,
        raw: entry.rawLines[0] ?? '',
        reason: `Unreadable date "${entry.dateText}"`,
      });
    } else {
      parseWarnings.push(
        'No date on this message and no date heading above it — the message is kept and shown, but it cannot be linked to an attendance day.',
      );
    }

    const timeMatch = /(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?)/.exec(
      entry.timeText ?? '',
    );
    let minutesOfDay: number | null = null;
    let timeText: string | null = entry.timeText || null;
    if (timeMatch) {
      const t = parseWhatsAppTime(timeMatch[1]);
      if (t) {
        minutesOfDay = t.minutes;
        timeText = t.timeText;
      } else {
        malformed += 1;
        parseWarnings.push(`Could not read the time "${entry.timeText}".`);
        unparsed.push({
          lineNumber: entry.lineNumber,
          raw: entry.rawLines[0] ?? '',
          reason: `Unreadable time "${entry.timeText}"`,
        });
      }
    } else if (entry.timeText) {
      malformed += 1;
      parseWarnings.push(`Could not read the time "${entry.timeText}".`);
    }

    const body = stripLeadingEmphasis(entry.body).trim();
    const isSystem =
      entry.system || !entry.authorText || (looksLikeSystem(body) && !entry.authorText);
    if (!entry.authorText && !isSystem) missingSender += 1;

    const message: WhatsAppMessage = {
      id: `${prefix}-m${index + 1}`,
      fileId: options.fileId,
      fileName: options.fileName,
      lineNumber: entry.lineNumber,
      rawLines: entry.rawLines,
      raw: body,
      dateText: entry.dateText || null,
      date: parsed?.iso ?? null,
      timeText,
      minutesOfDay,
      sender: entry.authorText,
      isSystem,
      parseWarnings,
      classification: {
        audience: 'uncertain',
        audienceConfidence: 0,
        audienceReasons: [],
        audienceSignals: [],
        events: [],
        mentions: [],
        studentInfo: [],
        busInfo: [],
        notes: [],
      },
    };

    if (!isSystem) {
      if (entry.authorText) {
        senderCount.set(entry.authorText, (senderCount.get(entry.authorText) ?? 0) + 1);
      }
      message.classification = reclassifyMessage(message.raw, entry.authorText, classifier);
    } else {
      message.classification.notes.push('System/administrative line — excluded from the audit.');
      message.classification.audienceReasons.push('System message');
    }

    messages.push(message);
  });

  const parsedMessages = messages.filter((message) => !message.isSystem).length;
  const formatMismatch = parsedMessages === 0 && (looseTimestamps > 0 || entries.length > 0);

  if (messages.length === 0) {
    warnings.push(
      `WhatsApp parsing failed or no messages were recognised in "${options.fileName}" — the file was identified as a chat export but none of the supported formats matched.`,
    );
  }
  if (formatMismatch) {
    warnings.push(
      `PARSER FORMAT MISMATCH: ${looseTimestamps} timestamp-like line(s) were detected inside "${options.fileName}" but not one message could be built from them. Supported formats: [9/1/26, 5:17:33 AM] Name: text · [5:17] **Name:** text · [2026-09-01 05:17] Name: text · 01/09/2026, 05:17 - Name: text · markdown date headings followed by [time] **Name:** lines.`,
    );
  }

  const senders = [...senderCount.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

  const diagnostics: WhatsAppParseDiagnostics = {
    totalLines: lines.length,
    dateHeadings,
    timestamps: Math.max(looseTimestamps, entries.length),
    senderPatterns: entries.filter((entry) => Boolean(entry.authorText)).length,
    messageBlocks: entries.length,
    parsedMessages,
    malformed,
    missingSender,
    recoveredMultiline,
    strayLines,
    formatsDetected: [...formats],
    sampleLines,
    unrecognisedSamples,
    formatMismatch,
  };

  return {
    messages,
    detectedDateOrder: detected.order,
    dateOrderEvidence: detected.evidence,
    orderAmbiguous: detected.ambiguous,
    senders,
    parsedDates,
    unparsed,
    warnings,
    totalLines: lines.length,
    diagnostics,
  };
}
