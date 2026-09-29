/**
 * Date parsing helpers.
 *
 * WhatsApp exports and attendance-machine reports both use ambiguous short
 * dates ("9/1/26"). We never guess silently: a caller supplies the resolved
 * day/month order (detected across the whole file, or set by the administrator)
 * and every parsed date keeps its original text for the evidence panel.
 */

import type { DateOrder } from './types';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const MONTH_ABBR: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface ParsedDate {
  /** ISO yyyy-MM-dd */
  iso: string;
  /** original text that was parsed */
  text: string;
  /** true when the year was missing from the source and a fallback was applied */
  yearInferred: boolean;
  /** true when the value only carried month + day information (no year at all) */
  warnings: string[];
}

export interface DateParseOptions {
  /** resolved order — callers pass 'auto' only when they accept the default */
  order: DateOrder;
  fallbackYear: number | null;
  /** used when order === 'auto' and the value is ambiguous */
  defaultOrder?: 'MDY' | 'DMY';
}

function isoFrom(year: number, month: number, day: number, warnings: string[]): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    warnings.push(`"${day}/${month}/${year}" is not a real calendar date.`);
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Expands a two-digit year the way Excel and WhatsApp do (26 -> 2026). */
export function expandYear(raw: number): number {
  if (raw >= 100) return raw;
  return raw < 70 ? 2000 + raw : 1900 + raw;
}

/**
 * Parses a single date-ish string. Returns null when the text is not a date.
 * Never throws.
 */
export function parseLooseDate(
  input: string | null | undefined,
  options: DateParseOptions,
): ParsedDate | null {
  if (input === null || input === undefined) return null;
  const text = String(input).trim();
  if (!text) return null;

  const warnings: string[] = [];
  const cleaned = text
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\[|\]$/g, '')
    .trim();

  if (!cleaned || /^[-–—.\s]*$/.test(cleaned)) return null;

  // 1. ISO: 2026-09-01 or 2026/09/01
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(cleaned);
  if (m) {
    const iso = isoFrom(Number(m[1]), Number(m[2]), Number(m[3]), warnings);
    return iso ? { iso, text: cleaned, yearInferred: false, warnings } : null;
  }

  // 2. Named month: "1-Sep-26", "Sep 1, 2026", "1 September 2026", "Sept 1"
  m = /^(\d{1,2})[-/\s]+([A-Za-z]{3,9})[-/\s,]+(\d{2,4})$/.exec(cleaned);
  if (!m) m = /^([A-Za-z]{3,9})[-/\s]+(\d{1,2})(?:[-/\s,]+(\d{2,4}))?$/.exec(cleaned);
  if (m) {
    let day: number, monthName: string, yearRaw: string | undefined;
    if (/^[A-Za-z]/.test(m[1])) {
      monthName = m[1];
      day = Number(m[2]);
      yearRaw = m[3];
    } else {
      day = Number(m[1]);
      monthName = m[2];
      yearRaw = m[3];
    }
    const key = monthName.toLowerCase().slice(0, 4).replace(/\.$/, '');
    const month =
      MONTH_ABBR[monthName.toLowerCase().slice(0, 3)] ??
      (key === 'sept' ? 9 : undefined) ??
      monthFromName(monthName);
    if (month) {
      let year: number;
      if (yearRaw === undefined) {
        if (options.fallbackYear === null) {
          warnings.push(`"${cleaned}" has no year and no fallback year is configured.`);
          return null;
        }
        year = options.fallbackYear;
        const iso = isoFrom(year, month, day, warnings);
        return iso
          ? {
              iso,
              text: cleaned,
              yearInferred: true,
              warnings: [...warnings, `Year not present in the source; assumed ${year}.`],
            }
          : null;
      }
      year = expandYear(Number(yearRaw));
      const iso = isoFrom(year, month, day, warnings);
      return iso ? { iso, text: cleaned, yearInferred: false, warnings } : null;
    }
  }

  // 3. Numeric: "9/1/26", "9-1-2026", "09.01.26", "9/1"
  m = /^(\d{1,4})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/.exec(cleaned);
  if (m) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    const third = m[3];
    let order: 'MDY' | 'DMY';

    if (options.order === 'auto') {
      if (first > 12 && second <= 12) order = 'DMY';
      else if (second > 12 && first <= 12) order = 'MDY';
      else order = options.defaultOrder ?? 'MDY';
    } else if (options.order === 'YMD') {
      order = 'MDY';
    } else {
      order = options.order;
    }

    // "9/1" (no year) — day/month only
    if (third === undefined) {
      const month = order === 'MDY' ? first : second;
      const day = order === 'MDY' ? second : first;
      const year = options.fallbackYear;
      const extra = [`Day/month order assumed to be ${order}.`];
      if (year === null) {
        extra.push(`"${cleaned}" has no year and no fallback year is configured.`);
        return null;
      }
      const iso = isoFrom(year, month, day, warnings);
      return iso
        ? {
            iso,
            text: cleaned,
            yearInferred: true,
            warnings: [...warnings, ...extra, `Year not present in the source; assumed ${year}.`],
          }
        : null;
    }

    const year = expandYear(Number(third));
    let month: number, day: number;
    if (options.order === 'YMD' && first > 31) {
      month = second;
      day = Number(third);
    } else if (order === 'MDY') {
      month = first;
      day = second;
    } else {
      month = second;
      day = first;
    }
    if (order === 'DMY' && first > 12 && second > 12) return null;
    const iso = isoFrom(year, month, day, warnings);
    return iso ? { iso, text: cleaned, yearInferred: false, warnings } : null;
  }

  return null;
}

function monthFromName(name: string): number | undefined {
  const key = name.toLowerCase().replace(/\./g, '');
  const idx = MONTHS.findIndex((full) => full === key || full.startsWith(key) || key.startsWith(full.slice(0, 3)));
  if (idx >= 0) return idx + 1;
  const abbr = MONTH_ABBR[key.slice(0, 4)] ?? MONTH_ABBR[key.slice(0, 3)];
  return abbr;
}

/**
 * Looks at every date-looking value in a file and decides whether the file uses
 * day-first or month-first ordering. Only unambiguous evidence is used.
 */
export function detectDateOrder(samples: string[]): {
  order: 'MDY' | 'DMY';
  evidence: string[];
  ambiguous: boolean;
} {
  let mdy = 0;
  let dmy = 0;
  const evidence: string[] = [];

  for (const sample of samples) {
    const text = String(sample ?? '').trim();
    const m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.]\d{2,4})?$/.exec(text);
    if (!m) continue;
    const first = Number(m[1]);
    const second = Number(m[2]);
    if (first > 12 && second <= 12) {
      dmy += 1;
      if (evidence.length < 5) evidence.push(`"${text}" can only be day-month.`);
    } else if (second > 12 && first <= 12) {
      mdy += 1;
      if (evidence.length < 5) evidence.push(`"${text}" can only be month-day.`);
    }
  }

  if (dmy > mdy) return { order: 'DMY', evidence, ambiguous: false };
  if (mdy > dmy) return { order: 'MDY', evidence, ambiguous: false };
  return { order: 'MDY', evidence, ambiguous: true };
}

/* ------------------------------------------------------------------ *
 * ISO date helpers (all timezone-safe: local midnight, no UTC drift)
 * ------------------------------------------------------------------ */

export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

export function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function todayIso(): string {
  return dateToIso(new Date());
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayIndex(iso: string): number {
  return isoToDate(iso).getDay();
}

export function weekdayName(iso: string): string {
  return WEEKDAY_NAMES[weekdayIndex(iso)];
}

export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT[weekdayIndex(iso)];
}

export function addDaysIso(iso: string, days: number): string {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + days);
  return dateToIso(d);
}

export function diffDaysIso(a: string, b: string): number {
  const ms = isoToDate(a).getTime() - isoToDate(b).getTime();
  return Math.round(ms / 86400000);
}

export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** "Sep 8, 2026" */
export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = isoToDate(iso);
  return `${MONTHS[d.getMonth()].slice(0, 3).replace(/^./, (c) => c.toUpperCase())} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Sep 8" */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = isoToDate(iso);
  return `${MONTHS[d.getMonth()].slice(0, 3).replace(/^./, (c) => c.toUpperCase())} ${d.getDate()}`;
}

/** "Sep" */
export function monthLabel(iso: string): string {
  const d = isoToDate(iso);
  return MONTHS[d.getMonth()].slice(0, 3).replace(/^./, (c) => c.toUpperCase());
}

/** Every date from first to last inclusive. */
export function enumerateDates(first: string, last: string): string[] {
  const out: string[] = [];
  let cursor = first;
  let guard = 0;
  while (compareIso(cursor, last) <= 0 && guard < 20000) {
    out.push(cursor);
    cursor = addDaysIso(cursor, 1);
    guard += 1;
  }
  return out;
}

export const MONTH_NAMES = MONTHS;
