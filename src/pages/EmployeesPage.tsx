import { ArrowUpDown, Download, Users } from 'lucide-react';
import * as React from 'react';
import { PageHeader } from '@/components/AppShell';
import { DataTable, tableToCsv, type Column } from '@/components/DataTable';
import { EmployeeDrawer } from '@/components/EmployeeDrawer';
import { Alert, Badge, Button, Card, CardContent, Select } from '@/components/ui';
import { download } from '@/lib/reports';
import { useStore } from '@/lib/store';
import { formatDisplayDate } from '@/lib/dates';
import type { EmployeeSummary } from '@/lib/types';

type SortKey = 'late' | 'absent' | 'sick' | 'early' | 'notifications' | 'unnotified' | 'conflicts';

export function EmployeesPage() {
  const { result } = useStore();
  const [employeeId, setEmployeeId] = React.useState<string | null>(null);
  const [sortKey, setSortKey] = React.useState<SortKey>('late');
  const [department, setDepartment] = React.useState('');

  if (!result) {
    return (
      <>
        <PageHeader title="Employees" description="Per-employee attendance, notification and discrepancy summary." />
        <Alert tone="info" title="No analysis yet">
          <p>Upload files and run the analysis to see the employee summaries.</p>
        </Alert>
      </>
    );
  }

  const departments = Array.from(
    new Set(result.employeeSummaries.map((entry) => entry.department ?? 'Not recorded')),
  ).sort();

  const value = (summary: EmployeeSummary): number => {
    switch (sortKey) {
      case 'late':
        return summary.lateDays;
      case 'absent':
        return summary.absentDays;
      case 'sick':
        return summary.sickDays;
      case 'early':
        return summary.leftEarlyDays;
      case 'notifications':
        return summary.whatsappNotificationCount;
      case 'unnotified':
        return summary.unnotifiedLateDays + summary.unnotifiedAbsenceDays;
      case 'conflicts':
        return summary.conflictDays;
      default:
        return 0;
    }
  };

  const filtered = result.employeeSummaries
    .filter((entry) => !department || (entry.department ?? 'Not recorded') === department)
    .sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name));

  const columns: Column<EmployeeSummary>[] = [
    {
      key: 'name',
      header: 'Employee',
      value: (row) => row.name,
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium underline-offset-2 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            setEmployeeId(row.employeeId);
          }}
        >
          {row.name}
          {row.whatsappNames.length > 0 ? (
            <span className="block text-xs font-normal text-[var(--muted-foreground)]">
              in chat as: {row.whatsappNames.join(', ')}
            </span>
          ) : null}
        </button>
      ),
    },
    { key: 'code', header: 'ID', value: (row) => row.employeeCode ?? '—', hideOnMobile: true },
    { key: 'department', header: 'Department', value: (row) => row.department ?? '—' },
    {
      key: 'present',
      header: 'Present',
      value: (row) => row.presentDays,
      render: (row) => <span className="tabular-nums">{row.presentDays}</span>,
    },
    {
      key: 'late',
      header: 'Late',
      value: (row) => row.lateDays,
      render: (row) => (
        <span className={`tabular-nums ${row.lateDays > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}`}>
          {row.lateDays}
        </span>
      ),
    },
    {
      key: 'absent',
      header: 'Absent',
      value: (row) => row.absentDays,
      render: (row) => (
        <span className={`tabular-nums ${row.absentDays > 0 ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>
          {row.absentDays}
        </span>
      ),
    },
    { key: 'sick', header: 'Sick', value: (row) => row.sickDays, hideOnMobile: true },
    { key: 'early', header: 'Left early', value: (row) => row.leftEarlyDays, hideOnMobile: true },
    {
      key: 'notifications',
      header: 'Notifications',
      value: (row) => row.whatsappNotificationCount,
    },
    {
      key: 'unnotified',
      header: 'Unnotified',
      value: (row) => row.unnotifiedLateDays + row.unnotifiedAbsenceDays,
      render: (row) => {
        const total = row.unnotifiedLateDays + row.unnotifiedAbsenceDays;
        return total === 0 ? (
          <Badge tone="success">none</Badge>
        ) : (
          <Badge tone="danger">
            {total} ({row.unnotifiedLateDays} late / {row.unnotifiedAbsenceDays} absent)
          </Badge>
        );
      },
    },
    {
      key: 'conflicts',
      header: 'Conflicts',
      value: (row) => row.conflictDays,
      render: (row) => (row.conflictDays === 0 ? <span className="text-[var(--muted-foreground)]">—</span> : <Badge tone="danger">{row.conflictDays}</Badge>),
      hideOnMobile: true,
    },
    {
      key: 'rate',
      header: 'Attendance',
      value: (row) => row.attendanceRate ?? -1,
      render: (row) => (row.attendanceRate === null ? '—' : `${Math.round(row.attendanceRate * 100)}%`),
      hideOnMobile: true,
    },
    {
      key: 'period',
      header: 'Period',
      value: (row) => row.firstDate ?? '',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-[var(--muted-foreground)]">
          {formatDisplayDate(row.firstDate)} – {formatDisplayDate(row.lastDate)}
        </span>
      ),
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${result.employeeSummaries.length} employee(s) after merging the attendance files. Select a row for the full profile and chronological history.`}
        actions={
          <Button
            variant="outline"
            onClick={() =>
              download('mbk-employee-summary.csv', tableToCsv(columns, filtered), 'text/csv;charset=utf-8')
            }
          >
            <Download /> Export summary
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]" htmlFor="emp-sort">
              <ArrowUpDown className="mr-1 inline size-3.5" /> Order by
            </label>
            <Select id="emp-sort" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="late">Most late days</option>
              <option value="absent">Most absences</option>
              <option value="sick">Most sick days</option>
              <option value="early">Most early departures</option>
              <option value="notifications">Most WhatsApp notifications</option>
              <option value="unnotified">Most unnotified days</option>
              <option value="conflicts">Most conflicts</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]" htmlFor="emp-dept">
              Department
            </label>
            <Select id="emp-dept" value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="">All departments</option>
              {departments.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <p className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Users className="size-3.5" /> Click any row to open the employee profile.
          </p>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={filtered}
        getRowId={(row) => row.employeeId}
        initialSort={{ key: 'late', direction: 'desc' }}
        pageSize={25}
        onRowClick={(row) => setEmployeeId(row.employeeId)}
        searchPlaceholder="Search employee, ID, department…"
        emptyMessage="No employees match the current filter."
      />

      <EmployeeDrawer employeeId={employeeId} open={employeeId !== null} onClose={() => setEmployeeId(null)} />
    </>
  );
}
