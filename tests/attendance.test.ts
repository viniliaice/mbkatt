import { describe, expect, it } from 'vitest';
import { parseAttendanceFile, parseAttendanceCell } from '../src/lib/parsers/attendance';

const matrixCsv = [
  'Employee ID,Employee Name,Department,1-Sep-26,2-Sep-26,3-Sep-26',
  'EMP001,Ikram Axmed,Teaching,"06:28,15:02","07:10,15:00",ABSENT',
  'EMP002,Nafiisa Xuseen,Teaching,"06:29,12:15,15:00",-,"6.3B"',
].join('\n');

const longCsv = [
  'Employee,Date,Clock In,Clock Out,Status',
  'Ikram Axmed,2026-09-01,06:28,15:02,Present',
  'Ikram Axmed,2026-09-02,07:10,15:00,Late',
  'Nafiisa Xuseen,2026-09-02,06:30,15:00,Present',
].join('\n');

describe('attendance parsing', () => {
  it('reads a matrix layout with a column per date', () => {
    const result = parseAttendanceFile(matrixCsv, {
      fileId: 'f1',
      fileName: 'attendence.csv',
      dateOrder: 'auto',
      fallbackYear: null,
    });
    expect(result.summary.format).toBe('matrix');
    expect(result.summary.dateColumns).toHaveLength(3);
    expect(result.employees).toHaveLength(2);
    expect(result.records).toHaveLength(6);
    const ikramSep1 = result.records.find(
      (record) => record.date === '2026-09-01' && record.employeeId === result.employees[0].id,
    );
    expect(ikramSep1?.punches.map((punch) => punch.minutesOfDay)).toEqual([388, 902]);
    expect(ikramSep1?.firstPunch).toBe(388);
    expect(ikramSep1?.lastPunch).toBe(902);
  });

  it('recognises explicit ABSENT markers', () => {
    const result = parseAttendanceFile(matrixCsv, {
      fileId: 'f1',
      fileName: 'attendence.csv',
      dateOrder: 'auto',
      fallbackYear: null,
    });
    const absent = result.records.find((record) => record.markers.includes('ABSENT'));
    expect(absent?.date).toBe('2026-09-03');
    expect(absent?.punchCount).toBe(0);
  });

  it('keeps multi-punch cells intact', () => {
    const result = parseAttendanceFile(matrixCsv, {
      fileId: 'f1',
      fileName: 'attendence.csv',
      dateOrder: 'auto',
      fallbackYear: null,
    });
    const three = result.records.find(
      (record) => record.date === '2026-09-01' && record.employeeId === result.employees[1].id,
    );
    expect(three?.punches.map((punch) => punch.minutesOfDay)).toEqual([389, 735, 900]);
  });

  it('reports unreadable cells as a parsing problem instead of a punch', () => {
    const result = parseAttendanceFile(matrixCsv, {
      fileId: 'f1',
      fileName: 'attendence.csv',
      dateOrder: 'auto',
      fallbackYear: null,
    });
    const broken = result.records.find((record) => record.date === '2026-09-03' && record.cells[0].raw === '6.3B');
    expect(broken?.punchCount).toBe(0);
  });

  it('reads a long/transactional layout', () => {
    const result = parseAttendanceFile(longCsv, {
      fileId: 'f2',
      fileName: 'attendence11.csv.txt',
      dateOrder: 'auto',
      fallbackYear: null,
    });
    expect(result.summary.format).toBe('long');
    expect(result.employees).toHaveLength(2);
    expect(result.records).toHaveLength(3);
    const ikram = result.records.filter((record) => record.employeeId === result.employees[0].id);
    expect(ikram.map((record) => record.date).sort()).toEqual(['2026-09-01', '2026-09-02']);
  });

  it('tracks the source cell for every punch (evidence trail)', () => {
    const result = parseAttendanceFile(matrixCsv, {
      fileId: 'f1',
      fileName: 'attendence.csv',
      dateOrder: 'auto',
      fallbackYear: null,
    });
    const punch = result.records[0].punches[0];
    expect(punch.fileName).toBe('attendence.csv');
    expect(punch.columnLabel).toBe('1-Sep-26');
    expect(punch.rowNumber).toBe(2);
    expect(punch.rawCell).toBe('06:28,15:02');
  });

  it('skips empty placeholders', () => {
    for (const value of ['', '-', '--', '0', 'N/A']) {
      const cell = parseAttendanceCell(value, {
        fileId: 'f',
        fileName: 'f.csv',
        rowNumber: 1,
        columnLabel: '1-Sep-26',
      });
      expect(cell.punches, value).toHaveLength(0);
    }
  });

  it('drops punches outside the plausible window with a warning', () => {
    const cell = parseAttendanceCell('02:15,06:40', {
      fileId: 'f',
      fileName: 'f.csv',
      rowNumber: 1,
      columnLabel: '1-Sep-26',
      earliestPlausiblePunch: 180,
      latestPlausiblePunch: 1380,
    });
    expect(cell.punches.map((punch) => punch.minutesOfDay)).toEqual([400]);
    expect(cell.parseWarnings.join(' ')).toMatch(/outside the plausible/);
  });

  it('handles a file with no usable date columns without crashing', () => {
    const result = parseAttendanceFile('Name,Age\nIkram,30\n', {
      fileId: 'f3',
      fileName: 'odd.csv',
      dateOrder: 'auto',
      fallbackYear: null,
    });
    expect(result.warnings.join(' ')).toMatch(/No usable date columns/);
    expect(result.records).toHaveLength(0);
  });
});
