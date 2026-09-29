import { describe, expect, it } from 'vitest';
import { buildEmployeeIndex, matchEmployeeName, resolveNameMatches } from '../src/lib/matcher';
import { DEFAULT_SETTINGS } from '../src/lib/rules';
import { jaroWinkler, normalizeName, nameVariants, tokenVariants } from '../src/lib/normalize';
import type { AttendanceEmployee } from '../src/lib/types';

function employee(id: string, name: string, code: string | null = null): AttendanceEmployee {
  return {
    id,
    employeeCode: code,
    name,
    nameNormalized: normalizeName(name),
    department: null,
    sourceFileIds: ['f1'],
    rawRow: {},
    rowNumbers: {},
  };
}

const employees = [
  employee('e1', 'Ikram Axmed', 'EMP001'),
  employee('e2', 'Nafiisa Xuseen', 'EMP002'),
  employee('e3', 'Ahmed Jaamac Ism', 'EMP003'),
  employee('e4', 'Xuseen Cabdi Ahmed', 'EMP004'),
  employee('e5', 'Huda Saeed', 'EMP005'),
];

const index = buildEmployeeIndex(employees);
const settings = {
  matchedThreshold: DEFAULT_SETTINGS.matchedThreshold,
  possibleThreshold: DEFAULT_SETTINGS.possibleThreshold,
  useTransliterationVariants: true,
};

describe('name normalization', () => {
  it('removes titles and punctuation', () => {
    expect(normalizeName('T. Axmed Jaamac')).toBe('axmed jaamac');
    expect(normalizeName('Teacher  Ikram')).toBe('ikram');
    expect(normalizeName('Mr. Xuseen Cabdi')).toBe('xuseen cabdi');
    expect(normalizeName('Mrs Huda, Saeed')).toBe('huda saeed');
  });

  it('produces spelling variants', () => {
    expect(nameVariants('T. Axmed Jaamac')).toContain('ahmed jaamac');
    expect(tokenVariants('Nafiisa')).toContain('nafisa');
    expect(jaroWinkler('axmed', 'ahmed')).toBeGreaterThan(0.8);
  });
});

describe('name matching', () => {
  it('matches the specification example with a high score', () => {
    const outcome = matchEmployeeName('T. Axmed jaamc', index, settings);
    expect(outcome.employeeName).toBe('Ahmed Jaamac Ism');
    expect(outcome.tier).toBe('matched');
    expect(outcome.confidence).toBeGreaterThanOrEqual(85);
    expect(outcome.method).toMatch(/first name/);
  });

  it('matches a first-name-only reference', () => {
    const outcome = matchEmployeeName('Ikram', index, settings);
    expect(outcome.employeeName).toBe('Ikram Axmed');
    expect(outcome.tier).toBe('matched');
  });

  it('treats a first-name-only reference to two people as ambiguous', () => {
    const ambiguousIndex = buildEmployeeIndex([
      employee('a', 'Xuseen Cabdi'),
      employee('b', 'Xuseen Axmed'),
    ]);
    const outcome = matchEmployeeName('Xuseen', ambiguousIndex, settings);
    expect(outcome.tier).toBe('possible');
    expect(outcome.alternatives.length).toBeGreaterThan(0);
  });

  it('does not merge unrelated people', () => {
    const outcome = matchEmployeeName('Maryan Warsame', index, settings);
    expect(outcome.tier).toBe('unmatched');
    expect(outcome.employeeId).toBeNull();
  });

  it('explains every decision', () => {
    const outcome = matchEmployeeName('Teacher Huda', index, settings);
    expect(outcome.reasons.length).toBeGreaterThan(0);
    expect(outcome.method).not.toBe('');
  });

  it('resolves a list of names and applies manual aliases first', () => {
    const matches = resolveNameMatches(
      [
        { name: 'Ikram', occurrences: 4 },
        { name: 'T. Axmed jaamc', occurrences: 2 },
        { name: 'T. Maryan', occurrences: 1 },
      ],
      employees,
      [{ whatsappName: 'T. Maryan', employeeId: 'e5', employeeName: 'Huda Saeed' }],
      DEFAULT_SETTINGS,
    );
    const maryan = matches.find((match) => match.whatsappName === 'T. Maryan');
    expect(maryan?.tier).toBe('manual');
    expect(maryan?.employeeId).toBe('e5');
    expect(matches.find((match) => match.whatsappName === 'Ikram')?.employeeId).toBe('e1');
    expect(matches.find((match) => match.whatsappName === 'T. Axmed jaamc')?.employeeId).toBe('e3');
  });
});
