import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  detectDateOrder,
  enumerateDates,
  expandYear,
  formatDisplayDate,
  isIsoDate,
  parseLooseDate,
  weekdayIndex,
  weekdayName,
} from '../src/lib/dates';

const opts = { order: 'auto' as const, fallbackYear: 2026 as number | null };

describe('date parsing', () => {
  it('parses month-first dates (WhatsApp default)', () => {
    const parsed = parseLooseDate('9/1/26', { order: 'MDY', fallbackYear: null });
    expect(parsed?.iso).toBe('2026-09-01');
    const parsed2 = parseLooseDate('9/15/26', { order: 'MDY', fallbackYear: null });
    expect(parsed2?.iso).toBe('2026-09-15');
  });

  it('parses day-first dates', () => {
    expect(parseLooseDate('15/9/26', { order: 'DMY', fallbackYear: null })?.iso).toBe('2026-09-15');
  });

  it('auto-detects order from unambiguous values', () => {
    expect(parseLooseDate('9/15/26', opts)?.iso).toBe('2026-09-15');
    expect(parseLooseDate('15/9/26', opts)?.iso).toBe('2026-09-15');
  });

  it('parses ISO dates', () => {
    expect(parseLooseDate('2026-09-01', opts)?.iso).toBe('2026-09-01');
    expect(parseLooseDate('2026/09/01', opts)?.iso).toBe('2026-09-01');
  });

  it('parses named months', () => {
    expect(parseLooseDate('1-Sep-26', opts)?.iso).toBe('2026-09-01');
    expect(parseLooseDate('Sep 1, 2026', opts)?.iso).toBe('2026-09-01');
    expect(parseLooseDate('1 September 2026', opts)?.iso).toBe('2026-09-01');
    expect(parseLooseDate('Sept 3', opts)?.iso).toBe('2026-09-03');
  });

  it('rejects impossible dates instead of guessing', () => {
    expect(parseLooseDate('2026-02-30', opts)).toBeNull();
    expect(parseLooseDate('not a date', opts)).toBeNull();
    expect(parseLooseDate('', opts)).toBeNull();
  });

  it('expands two digit years like spreadsheets do', () => {
    expect(expandYear(26)).toBe(2026);
    expect(expandYear(99)).toBe(1999);
    expect(expandYear(2026)).toBe(2026);
  });

  it('reports when the year had to be assumed', () => {
    const parsed = parseLooseDate('9/1', opts);
    expect(parsed?.iso).toBe('2026-09-01');
    expect(parsed?.yearInferred).toBe(true);
    expect(parseLooseDate('9/1', { order: 'auto', fallbackYear: null })).toBeNull();
  });

  it('detects the day/month order of a file', () => {
    expect(detectDateOrder(['9/1/26', '9/13/26', '9/15/26']).order).toBe('MDY');
    expect(detectDateOrder(['1/9/26', '13/9/26']).order).toBe('DMY');
    expect(detectDateOrder(['9/1/26', '9/2/26']).ambiguous).toBe(true);
  });

  it('handles weekday helpers', () => {
    expect(weekdayIndex('2026-09-03')).toBe(4);
    expect(weekdayName('2026-09-03')).toBe('Thursday');
    expect(weekdayName('2026-09-04')).toBe('Friday');
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(enumerateDates('2026-09-01', '2026-09-03')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(isIsoDate('2026-09-01')).toBe(true);
    expect(isIsoDate('9/1/26')).toBe(false);
    expect(formatDisplayDate('2026-09-08')).toBe('Sep 8, 2026');
  });
});
