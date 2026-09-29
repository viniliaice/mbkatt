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
}

/* ------------------------------------------------------------------ *
 * Header patterns
 * ------------------------------------------------------------------ */

/** [9/1/26, 5:17:33 AM] Fardosa Kamal: message */
const BRACKET_HEADER =
  /^\s*[\u200e\u200f]?\[([^,\]]+),\s*([^\]\u200e\u200f]+)\]\s*([^:]{0,80}?)\s*[:：]\s?([\s\S]*)$/;

/** [9/1/26, 5:17:33 AM] system text without author */
const BRACKET_SYSTEM_HEADER =
  /^\s*[\u200e\u200f]?\[([^,\]]+),\s*([^\]\u200e\u200f]+)\]\s*([\s\S]*)$/;

/** YYYY-MM-DD, HH:MM - Name: message */
const ISO_DASH_HEADER =
  /^\s*(\d{4}-\d{2}-\d{2}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*([^:]{0,80}?)\s*[:：]\s?([\s\S]*)$/;

/** 9/1/26, 5:17:33 AM - Fardosa Kamal: message */
const DASH_HEADER =
  /^\s*[\u200e\u200f]?(\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/.]\d{1,2}),\s*(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?)\s*[-–—]\s*([^:]{0,80}?)\s*[:：]\s?([\s\S]*)$/;

/** 9/1/26, 5:17:33 AM - Some system text without a colon */
const SYSTEM_DASH =
  /^\s*[\u200e\u200f]?(\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/.]\d{1,2}),\s*(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?)\s*[-–—]\s*([\s\S]*)$/;

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
  dateText: string;
  timeText: string;
  authorText: string | null;
  body: string;
  system: boolean;
}

function parseHeader(line: string): Omit<RawEntry, 'rawLines' | 'lineNumber'> | null {
  let m = BRACKET_HEADER.exec(line);
  if (m) {
    const author = m[3].replace(/^[\u200e\u200f~\s]+/, '').trim();
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: author || null,
      body: m[4],
      system: !author,
    };
  }
  m = BRACKET_SYSTEM_HEADER.exec(line);
  if (m) {
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: null,
      body: m[3],
      system: true,
    };
  }
  m = ISO_DASH_HEADER.exec(line);
  if (m) {
    const author = m[3].replace(/^[\u200e\u200f~\s]+/, '').trim();
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: author || null,
      body: m[4],
      system: !author,
    };
  }
  m = DASH_HEADER.exec(line);
  if (m) {
    const author = m[3].replace(/^[\u200e\u200f~\s]+/, '').trim();
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: author || null,
      body: m[4],
      system: !author,
    };
  }
  m = SYSTEM_DASH.exec(line);
  if (m) {
    return {
      dateText: m[1].trim(),
      timeText: m[2].trim(),
      authorText: null,
      body: m[3],
      system: true,
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

  // Pass 1 — collect entries (a message spans every continuation line)
  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;
  let strayLines = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const header = parseHeader(line);
    if (header) {
      if (current) entries.push(current);
      current = { ...header, lineNumber, rawLines: [line] };
    } else if (current) {
      current.rawLines.push(line);
      current.body += `\n${line}`;
    } else if (line.trim()) {
      strayLines += 1;
    }
  });
  if (current) entries.push(current);

  if (strayLines > 0) {
    warnings.push(
      `${strayLines} line(s) appear before the first timestamped message — typical for exported chat headers.`,
    );
  }

  // Pass 2 — decide the day/month order across every timestamp in the file
  const samples = entries.map((e) => e.dateText).filter(Boolean);
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

  entries.forEach((entry, index) => {
    const parseWarnings: string[] = [];
    const parsed = parseLooseDate(entry.dateText, {
      order: effectiveOrder,
      fallbackYear: options.fallbackYear,
      defaultOrder: detected.order,
    });
    if (parsed) {
      parsedDates += 1;
      parseWarnings.push(...parsed.warnings);
    } else if (entry.dateText) {
      parseWarnings.push(`Could not read the date "${entry.dateText}".`);
      unparsed.push({
        lineNumber: entry.lineNumber,
        raw: entry.rawLines[0] ?? '',
        reason: `Unreadable date "${entry.dateText}"`,
      });
    } else {
      parseWarnings.push('No timestamp on this line.');
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
        parseWarnings.push(`Could not read the time "${entry.timeText}".`);
        unparsed.push({
          lineNumber: entry.lineNumber,
          raw: entry.rawLines[0] ?? '',
          reason: `Unreadable time "${entry.timeText}"`,
        });
      }
    } else if (entry.timeText) {
      parseWarnings.push(`Could not read the time "${entry.timeText}".`);
    }

    const body = entry.body.trim();
    const isSystem =
      entry.system || !entry.authorText || (looksLikeSystem(body) && !entry.authorText);

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

  if (messages.length === 0) {
    warnings.push(
      `No WhatsApp messages could be recognised in "${options.fileName}". Check that this is a plain-text WhatsApp export.`,
    );
  }

  const senders = [...senderCount.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

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
  };
}
