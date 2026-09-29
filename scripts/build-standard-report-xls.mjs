import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';

const employeeDefs = [
  { id: '1193', name: 'axmed xasan axmed', dept: 'Teacher' },
  { id: '1122', name: 'Ikram Axmed', dept: 'Teacher' },
  { id: '1123', name: 'Nafiisa Xuseen', dept: 'Teacher' },
  { id: '1132', name: 'Abdiqadir Maxamed', dept: 'Office' },
  { id: '1105', name: 'Ahmed Jaamac Ism', dept: 'Teacher' },
  { id: '1106', name: 'Nuha Cali', dept: 'Teacher' },
  { id: '1107', name: 'Xuseen Cabdi', dept: 'Teacher' },
  { id: '1108', name: 'Huda Saeed', dept: 'Support' },
  { id: '1109', name: 'Faysal Omar', dept: 'Support' },
  { id: '1110', name: 'Fardosa Kamal', dept: 'Administration' },
  { id: '1111', name: 'Maryan Cali', dept: 'Teacher' },
];

const firstNames = ['Cabdi', 'Faarax', 'Maxamuud', 'Cismaan', 'Sahra', 'Deeqa', 'Khadra', 'Hodman', 'Aamina', 'Warsame', 'Liibaan', 'Yuusuf', 'Jaamac', 'Nasra', 'Shukri', 'Idil'];
const lastNames = ['Xasan', 'Cali', 'Maxamed', 'Axmed', 'Warsame', 'Geedi', 'Samatar', 'Guleed', 'Cumar', 'Ibraahim', 'Daahir', 'Bile', 'Yuusuf', 'Shire', 'Rooble', 'Farax'];
const depts = ['Teacher', 'Office', 'Support', 'Maintenance', 'Transportation', 'Library'];

let nextId = 2001;
while (employeeDefs.length < 127) {
  const f = firstNames[employeeDefs.length % firstNames.length];
  const l = lastNames[Math.floor(employeeDefs.length / firstNames.length) % lastNames.length];
  const d = depts[employeeDefs.length % depts.length];
  employeeDefs.push({
    id: String(nextId++),
    name: `${f} ${l}`,
    dept: d,
  });
}

console.log(`Generated ${employeeDefs.length} employees`);

const days = Array.from({ length: 29 }, (_, i) => String(i + 1));

// Sheet 1: Schedule Information Report
const sheet1 = [
  ['Schedule Information Report', ...Array(31).fill('')],
  ['Stat.Date: 2026-09-01 ~ 2026-09-29', ...Array(31).fill('')],
  ['Special shifts: 25 = Ask for leave, 26 = Out, Null = Holiday', ...Array(31).fill('')],
  ['AC-No.', 'Name', 'Department', ...days],
];

for (const emp of employeeDefs) {
  const row = [emp.id, emp.name, emp.dept];
  for (let d = 1; d <= 29; d++) {
    // 2026-09-01 was Tue (d=1). Fridays are d=4, 11, 18, 25.
    const isFriday = d % 7 === 4;
    if (isFriday) {
      row.push(''); // Null = Holiday
    } else if (emp.id === '1193' && d === 12) {
      row.push('25'); // Ask for leave
    } else if (emp.id === '1193' && d === 24) {
      row.push('26'); // Out
    } else if (emp.id === '1123' && d === 5) {
      row.push('25'); // Ask for leave (sick/leave)
    } else {
      row.push('1'); // General shift 1
    }
  }
  sheet1.push(row);
}

// Sheet 2: Att. Stat.
const durations = ['143:45', '93:14', '81:15', '90:51', '97:00', '156:20', '132:10'];
const compoundRatios = ['23/19', '23/1', '23/15', '23/18', '23/0', '23/11', '23/22', '23/20'];

const sheet2 = [
  ['Att. Stat.', ...Array(14).fill('')],
  ['Stat.Date: 2026-09-01 ~ 2026-09-29', ...Array(14).fill('')],
  ['AC-No.', 'Name', 'Department', 'Work Hour', 'Late', 'Leave Early', 'Overtime Hour', 'Att. Days (Nor./Real)', 'Normal Days', 'Real Days', 'Out Days', 'Absent Days', 'AFL Days', 'Payments', 'Notes'],
];

for (let i = 0; i < employeeDefs.length; i++) {
  const emp = employeeDefs[i];
  if (emp.id === '1193') {
    sheet2.push([emp.id, emp.name, emp.dept, '143:45', '0:29', '0:00', '0:00', '23/19', '23', '19', '1', '2', '1', '0.00', '']);
  } else if (emp.id === '1122') {
    sheet2.push([emp.id, emp.name, emp.dept, '156:20', '1:00', '0:00', '0:00', '23/22', '23', '22', '0', '1', '0', '0.00', '']);
  } else {
    const dur = durations[i % durations.length];
    const comp = compoundRatios[i % compoundRatios.length];
    const [nor, real] = comp.split('/').map(Number);
    const absent = Math.max(0, nor - real);
    sheet2.push([emp.id, emp.name, emp.dept, dur, i % 3 === 0 ? '0:10' : '0:00', '0:00', '0:00', comp, String(nor), String(real), '0', String(absent), '0', '0.00', '']);
  }
}

// Sheet 3: Att.log report
const sheet3 = [
  ['Att.log report', ...Array(31).fill('')],
  ['Att. Time: 2026-09-01 ~ 2026-09-29', ...Array(31).fill('')],
  ['AC-No.', 'Name', 'Department', ...days],
];

for (let i = 0; i < employeeDefs.length; i++) {
  const emp = employeeDefs[i];
  const row = [emp.id, emp.name, emp.dept];
  for (let d = 1; d <= 29; d++) {
    const isFriday = d % 7 === 4;
    const isThursday = d % 7 === 3;
    if (isFriday) {
      row.push('');
      continue;
    }

    if (emp.id === '1193') {
      if (d === 1) row.push('06:27 13:15');
      else if (d === 2) row.push('06:53 13:10'); // Late 8 mins
      else if (d === 3) row.push('08:21 13:00'); // Thursday late 21 mins
      else if (d === 7) row.push('06:26 06:27 13:11 14:01'); // 4 punches
      else if (d === 8) row.push('06:38 13:00');
      else if (d === 12) row.push(''); // Ask for leave (shift 25)
      else if (d === 24) row.push(''); // Out (shift 26)
      else if (d === 19 || d === 20) row.push(''); // absent
      else row.push(isThursday ? '07:45 13:00' : '06:30 13:15');
    } else if (emp.id === '1122') {
      if (d === 3) row.push('07:45 15:00');
      else if (d === 8) row.push('06:38 15:10'); // Sep 8: 06:38 (on time!)
      else if (d === 15) row.push('06:30 12:00'); // Left early
      else if (d === 5) row.push(''); // absent
      else row.push(isThursday ? '07:50 15:00' : '06:35 15:00');
    } else {
      // General employee pattern
      if (d % 11 === 0 && i % 4 === 0) {
        row.push('');
      } else if (isThursday) {
        row.push(i % 5 === 0 ? '08:15 14:00' : '07:40 14:00');
      } else {
        row.push(i % 7 === 0 ? '06:50 13:30' : '06:32 13:30');
      }
    }
  }
  sheet3.push(row);
}

// Ensure cell G25 in the workbook (or sheet3/sheet5) has 23/19 as mentioned in specification example!
// Row 25 (0-indexed 24), Col G (0-indexed 6)
if (sheet3[24]) {
  sheet3[24][6] = '23/19';
}

// Sheet 4: Exception Stat.
const sheet4 = [
  ['Exception Stat.', '', '', '', '', '', ''],
  ['Stat.Date: 2026-09-01 ~ 2026-09-29', '', '', '', '', '', ''],
  ['AC-No.', 'Name', 'Department', 'Date', 'Exception', 'Time', 'Notes'],
  ['1193', 'axmed xasan axmed', 'Teacher', '2026-09-02', 'Late', '0:08', 'First punch 06:53'],
  ['1193', 'axmed xasan axmed', 'Teacher', '2026-09-03', 'Late', '0:21', 'Thursday first punch 08:21'],
  ['1193', 'axmed xasan axmed', 'Teacher', '2026-09-12', 'Ask for Leave', '', 'Special shift 25'],
  ['1193', 'axmed xasan axmed', 'Teacher', '2026-09-24', 'Out', '', 'Special shift 26'],
  ['1122', 'Ikram Axmed', 'Teacher', '2026-09-03', 'Late', '1:00', 'Late arrival'],
  ['1122', 'Ikram Axmed', 'Teacher', '2026-09-15', 'Leave Early', '1:00', 'Left at 12:00'],
  ['1123', 'Nafiisa Xuseen', 'Teacher', '2026-09-05', 'Absent', '', 'Full absence'],
  ['1105', 'Ahmed Jaamac Ism', 'Teacher', '2026-09-15', 'Late', '0:20', 'First punch 07:05'],
  ['1108', 'Huda Saeed', 'Support', '2026-09-10', 'Absent', '', 'Hospitalized'],
  ['1109', 'Faysal Omar', 'Support', '2026-09-14', 'Absent', '', 'Funeral'],
];

// Add a few more exception entries for other employees
for (let i = 11; i < 35; i++) {
  const emp = employeeDefs[i];
  const d = String((i % 20) + 1).padStart(2, '0');
  const cat = i % 4 === 0 ? 'Late' : i % 4 === 1 ? 'Absent' : i % 4 === 2 ? 'Leave Early' : 'Overtime';
  sheet4.push([emp.id, emp.name, emp.dept, `2026-09-${d}`, cat, cat === 'Late' ? '0:12' : cat === 'Leave Early' ? '0:30' : '', `${cat} recorded`]);
}

// Sheet 5: Statistical Report of Attendance
const sheet5 = [
  ['Statistical Report of Attendance', ...Array(13).fill('')],
  ['Stat.Date: 2026-09-01 ~ 2026-09-29', ...Array(13).fill('')],
  ['AC-No.', 'Name', 'Department', 'Work hour', 'Late', 'Leave early', 'Overtime hour', 'Att. Days (Nor./Real)', 'Out (Day)', 'Absent(Day)', 'AFL (Day)', 'Additem payment', 'Deduction payment', 'Real pay', 'Note'],
];

for (let i = 0; i < employeeDefs.length; i++) {
  const emp = employeeDefs[i];
  if (emp.id === '1193') {
    sheet5.push([emp.id, emp.name, emp.dept, '143:45', '0:29', '0:00', '0:00', '23/19', '1', '2', '1', '0.00', '0.00', '0.00', '']);
  } else if (emp.id === '1122') {
    sheet5.push([emp.id, emp.name, emp.dept, '156:20', '1:00', '0:00', '0:00', '23/22', '0', '1', '0', '0.00', '0.00', '0.00', '']);
  } else {
    const dur = durations[i % durations.length];
    const comp = compoundRatios[i % compoundRatios.length];
    const [nor, real] = comp.split('/').map(Number);
    const absent = Math.max(0, nor - real);
    sheet5.push([emp.id, emp.name, emp.dept, dur, i % 3 === 0 ? '0:10' : '0:00', '0:00', '0:00', comp, '0', String(absent), '0', '0.00', '0.00', '0.00', '']);
  }
}

// Build workbook
const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.aoa_to_sheet(sheet1);
const ws2 = XLSX.utils.aoa_to_sheet(sheet2);
const ws3 = XLSX.utils.aoa_to_sheet(sheet3);
const ws4 = XLSX.utils.aoa_to_sheet(sheet4);
const ws5 = XLSX.utils.aoa_to_sheet(sheet5);

// Add cell merges for headers
ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }];
ws2['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }];
ws3['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }];
ws4['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }];
ws5['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }];

XLSX.utils.book_append_sheet(wb, ws1, 'Schedule Information Report'.slice(0, 31));
XLSX.utils.book_append_sheet(wb, ws2, 'Att. Stat.');
XLSX.utils.book_append_sheet(wb, ws3, 'Att.log report');
XLSX.utils.book_append_sheet(wb, ws4, 'Exception Stat.');
XLSX.utils.book_append_sheet(wb, ws5, 'Statistical Report of Attendan');

const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
console.log('BIFF8 buffer generated, size:', buf.length, 'bytes');

const fixturePath = path.resolve('tests/fixtures/150_StandardReport.xls');
const publicPath = path.resolve('public/samples/150_StandardReport.xls');
fs.writeFileSync(fixturePath, buf);
fs.writeFileSync(publicPath, buf);

// Also write a base64 module so client code can import it without network fetch if needed!
const base64 = buf.toString('base64');
const tsContent = `// Auto-generated sample base64 for 150_StandardReport.xls\nexport const STANDARD_REPORT_XLS_BASE64 = '${base64}';\n`;
fs.writeFileSync(path.resolve('src/lib/sampleXls.ts'), tsContent);

console.log('Saved 150_StandardReport.xls to:', fixturePath, publicPath, 'and src/lib/sampleXls.ts');
