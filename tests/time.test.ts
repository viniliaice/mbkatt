import { describe, expect, it } from 'vitest';
import {
  extractClockTokens,
  formatDuration,
  minutesToClock,
  minutesToClock12,
  parseClockValue,
} from '../src/lib/time';

describe('time parsing', () => {
  it('reads plain HH:MM values', () => {
    expect(extractClockTokens('06:38')[0].minutes).toBe(6 * 60 + 38);
    expect(extractClockTokens('6:38')[0].minutes).toBe(6 * 60 + 38);
    expect(extractClockTokens('18:05')[0].minutes).toBe(18 * 60 + 5);
  });

  it('reads HH:MM:SS values', () => {
    const token = extractClockTokens('06:38:12')[0];
    expect(token.minutes).toBe(6 * 60 + 38);
    expect(token.second).toBe(12);
    expect(token.form).toBe('HH:MM:SS');
  });

  it('reads meridiem notation', () => {
    expect(extractClockTokens('6:38 AM')[0].minutes).toBe(398);
    expect(extractClockTokens('6:38 PM')[0].minutes).toBe(1118);
    expect(extractClockTokens('12:05 AM')[0].minutes).toBe(5);
    expect(extractClockTokens('12:05 PM')[0].minutes).toBe(725);
  });

  it('converts Excel time serials', () => {
    const token = extractClockTokens('0.2763888')[0];
    expect(token.form).toBe('serial');
    expect(token.minutes).toBe(398); // 06:38
  });

  it('reads several punches inside one cell', () => {
    const tokens = extractClockTokens('06:38, 12:15,15:02');
    expect(tokens.map((token) => token.minutes)).toEqual([398, 735, 902]);
  });

  it('reads punches split by newlines and dashes', () => {
    expect(
      extractClockTokens('06:38\n15:02').map((token) => token.minutes),
    ).toEqual([398, 902]);
    expect(extractClockTokens('06:38 - 15:02').map((token) => token.minutes)).toEqual([398, 902]);
  });

  it('reads H.MM notation', () => {
    expect(extractClockTokens('6.45')[0].minutes).toBe(405);
    expect(extractClockTokens('18.30')[0].minutes).toBe(1110);
  });

  it('ignores decimals that are not times', () => {
    expect(extractClockTokens('1.5')).toHaveLength(0);
    expect(extractClockTokens('12,5')).toHaveLength(0);
  });

  it('rejects impossible clock values', () => {
    expect(extractClockTokens('25:99')).toHaveLength(0);
    expect(extractClockTokens('10:75')).toHaveLength(0);
  });

  it('parses a 4-digit compact time only as a last resort', () => {
    const tokens = extractClockTokens('0638');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].minutes).toBe(398);
    // …but never when a proper time is already present in the field
    expect(extractClockTokens('06:38 0638').map((token) => token.minutes)).toEqual([398]);
  });

  it('parses settings values', () => {
    expect(parseClockValue('06:45')).toBe(405);
    expect(parseClockValue('8:00')).toBe(480);
    expect(parseClockValue('not a time')).toBeNull();
  });

  it('formats clock values', () => {
    expect(minutesToClock(398)).toBe('06:38');
    expect(minutesToClock12(398)).toBe('6:38 AM');
    expect(minutesToClock12(1118)).toBe('6:38 PM');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(90)).toBe('1 h 30 min');
  });
});
