/**
 * Time parsing helpers.
 *
 * Biometric machines and hand-made reports are messy: a cell can hold
 * "06:38", "6:38:00 AM", "18.38", "0.2763" (an Excel serial fraction), or
 * several of those separated by commas / spaces / newlines. Everything in this
 * module is deliberately conservative: if a token cannot be read with
 * confidence it is reported as a problem instead of being guessed.
 */

export interface ClockToken {
  /** minutes since midnight (0..1439) */
  minutes: number;
  hour: number;
  minute: number;
  second: number;
  /** the exact substring that was matched */
  text: string;
  /** index inside the scanned string */
  offset: number;
  /** how the value was interpreted — shown in the evidence panel */
  form: 'HH:MM' | 'HH:MM:SS' | 'H.MM' | 'serial' | 'compact';
  /** true when an AM/PM marker was present */
  meridiem: boolean;
  warnings: string[];
}

/** 0 -> "00:00", 385 -> "06:25" */
export function minutesToClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** 385 -> "6:25 AM" */
export function minutesToClock12(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

/**
 * Parses a settings value such as "06:45", "6:45", "6.45" or "8:00 am".
 * Returns minutes since midnight or null.
 */
export function parseClockValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const tokens = extractClockTokens(String(value));
  if (tokens.length === 0) return null;
  return tokens[0].minutes;
}

/** Normalises any accepted clock notation to "HH:MM" (for display/settings round-trips). */
export function normalizeClockString(value: string): string | null {
  const minutes = parseClockValue(value);
  return minutes === null ? null : minutesToClock(minutes);
}

function applyMeridiem(hour: number, meridiem: string | null): number {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase().startsWith('p');
  if (hour === 12) return pm ? 12 : 0;
  if (pm) return hour + 12;
  return hour;
}

/**
 * Extracts every clock-like token from an arbitrary string.
 *
 * Supported forms:
 *  06:38        18:38       6:38:00     06.38      6.38.00
 *  6:38 AM      06:38:12 PM  6:38a
 *  0.2763888    (Excel time serial stored as a decimal fraction)
 *  0638         (compact, flagged with a warning because it is ambiguous)
 */
export function extractClockTokens(input: string): ClockToken[] {
  const text = String(input ?? '');
  if (!text.trim()) return [];
  const tokens: ClockToken[] = [];
  const taken: [number, number][] = [];

  const overlaps = (start: number, end: number) =>
    taken.some(([s, e]) => start < e && end > s);

  const push = (token: ClockToken) => {
    taken.push([token.offset, token.offset + token.text.length]);
    tokens.push(token);
  };

  // 1. HH:MM / HH:MM:SS / H.MM / H.MM.SS (with optional meridiem)
  const separated =
    /(?<![\d.])(\d{1,2})\s*[:.]\s*(\d{1,2})(?:\s*[:.]\s*(\d{1,2}))?(?![\d])(\s*[AaPp]\.?\s?[Mm]\.?)?/g;
  let match: RegExpExecArray | null;
  while ((match = separated.exec(text)) !== null) {
    const [full, hRaw, mRaw, sRaw, meridiemRaw] = match;
    const warnings: string[] = [];
    const hour = Number(hRaw);
    const minute = Number(mRaw);
    const second = sRaw === undefined ? 0 : Number(sRaw);
    const meridiem = meridiemRaw?.trim() || null;

    if (hour > 23 || minute > 59 || second > 59) {
      // Looks like a date or something else entirely; do not treat as a time.
      continue;
    }
    // "6.45" is accepted, but a 1-3 digit fraction is more likely a decimal
    // quantity than a clock reading — keep it, but flag it.
    const dotted = !full.trim().includes(':');
    if (dotted && minute < 10) {
      // e.g. "1.5" — too ambiguous, skip (it is almost certainly a decimal).
      continue;
    }

    const resolvedHour = applyMeridiem(hour, meridiem);
    if (meridiem && (hour === 0 || hour > 12)) {
      warnings.push(`Hour ${hour} cannot be combined with ${meridiem.toUpperCase()}; used as written.`);
    }
    const finalHour = resolvedHour > 23 ? hour : resolvedHour;
    const form: ClockToken['form'] =
      sRaw !== undefined ? 'HH:MM:SS' : dotted ? 'H.MM' : 'HH:MM';

    push({
      minutes: finalHour * 60 + minute + 0,
      hour: finalHour,
      minute,
      second,
      text: full.trim(),
      offset: match.index,
      form,
      meridiem: Boolean(meridiem),
      warnings: dotted ? [...warnings, 'Interpreted "H.MM" as a clock time (H:MM).'] : warnings,
    });
  }

  // 2. Excel serial fractions: a decimal with a fractional part of >= 4 digits
  //    between 0 and 1, e.g. 0.27638888 -> 06:38.
  const serial = /(?<![\d.,:])([01])\.(\d{4,})(?![\d])/g;
  while ((match = serial.exec(text)) !== null) {
    const [, whole, fraction] = match;
    const start = match.index;
    if (overlaps(start, match.index + match[0].length)) continue;
    const value = Number(`${whole}.${fraction}`);
    if (!Number.isFinite(value) || value < 0 || value >= 1) continue;
    const totalSeconds = Math.round(value * 86400);
    const hour = Math.floor(totalSeconds / 3600) % 24;
    const minute = Math.floor(totalSeconds / 60) % 60;
    const second = totalSeconds % 60;
    push({
      minutes: hour * 60 + minute,
      hour,
      minute,
      second,
      text: match[0],
      offset: start,
      form: 'serial',
      meridiem: false,
      warnings: ['Converted an Excel time serial to a clock time.'],
    });
  }

  // 3. Compact 4-digit (HHMM), e.g. "0638". Only used when nothing else was
  //    found in this field, because lone numbers are usually IDs/counts.
  if (tokens.length === 0) {
    const compact = /(?<![\d.,:])(\d{4})(?![\d])/g;
    while ((match = compact.exec(text)) !== null) {
      const hour = Number(match[1].slice(0, 2));
      const minute = Number(match[1].slice(2));
      if (hour > 23 || minute > 59) continue;
      push({
        minutes: hour * 60 + minute,
        hour,
        minute,
        second: 0,
        text: match[0],
        offset: match.index,
        form: 'compact',
        meridiem: false,
        warnings: ['A 4-digit number was read as a clock time (HHMM) — verify this value.'],
      });
    }
  }

  return tokens.sort((a, b) => a.offset - b.offset);
}

/** True when the field contains any clock-like token. */
export function containsTime(input: string): boolean {
  return extractClockTokens(input).length > 0;
}

/**
 * Parses the time portion of a WhatsApp export timestamp
 * ("5:17:33 AM", "17:17", "9:03 pm").
 */
export function parseWhatsAppTime(text: string): { minutes: number; timeText: string } | null {
  const clean = String(text ?? '').trim();
  if (!clean) return null;
  const tokens = extractClockTokens(clean);
  if (tokens.length === 0) return null;
  const token = tokens[0];
  // Guard: WhatsApp always writes a meridiem in 12-hour locales; accept 24h too.
  return { minutes: token.minutes, timeText: clean };
}

export function minutesOfDayToDate(base: Date, minutes: number): Date {
  const d = new Date(base.getTime());
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/** Formats a signed difference in minutes: 12 -> "12 min", -90 -> "1 h 30 min" */
export function formatDuration(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  if (abs < 60) return `${abs} min`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
