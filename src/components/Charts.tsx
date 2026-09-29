/**
 * Chart components (Recharts).
 *
 * Every chart is fed straight from the analysis result — there is no placeholder
 * data anywhere. When a series is empty the chart says so instead of drawing a
 * meaningless shape.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { formatShortDate } from '@/lib/dates';

export const CHART_COLORS = {
  primary: '#4f46e5',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#0284c7',
  neutral: '#94a3b8',
  purple: '#7c3aed',
  teal: '#0d9488',
};

const axisProps = {
  stroke: 'currentColor',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  className: 'text-[var(--muted-foreground)]',
} as const;

function ChartFrame({
  title,
  description,
  empty,
  height = 260,
  children,
}: {
  title: string;
  description?: string;
  empty: boolean;
  height?: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {empty ? (
          <div
            className="flex items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--muted-foreground)]"
            style={{ height }}
          >
            Not enough data for this chart.
          </div>
        ) : (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              {children as never}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EmployeeBarChart({
  title,
  description,
  data,
  color = CHART_COLORS.primary,
  maxItems = 12,
}: {
  title: string;
  description?: string;
  data: { name: string; count: number }[];
  color?: string;
  maxItems?: number;
}) {
  const shown = data.slice(0, maxItems);
  return (
    <ChartFrame title={title} description={description} empty={shown.length === 0}>
      <BarChart data={shown} margin={{ top: 8, right: 12, bottom: 46, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" {...axisProps} angle={-32} textAnchor="end" interval={0} height={60} />
        <YAxis allowDecimals={false} {...axisProps} width={30} />
        <Tooltip
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--foreground)',
          }}
        />
        <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} name="Days" />
      </BarChart>
    </ChartFrame>
  );
}

export function NotificationsByDateChart({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  return (
    <ChartFrame
      title="WhatsApp notifications by date"
      description="How many notification messages were sent each day in the audited period."
      empty={data.length === 0}
    >
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(value: string) => formatShortDate(value)} {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} width={30} />
        <Tooltip
          labelFormatter={(value) => formatShortDate(String(value))}
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--foreground)',
          }}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke={CHART_COLORS.primary}
          strokeWidth={2}
          dot={{ r: 3 }}
          name="Notifications"
        />
      </LineChart>
    </ChartFrame>
  );
}

export function NotifiedVsUnnotifiedChart({
  data,
}: {
  data: { date: string; notified: number; notNotified: number }[];
}) {
  return (
    <ChartFrame
      title="Notified vs unnotified attendance events"
      description="Per day: how many events had a WhatsApp notification and how many did not."
      empty={data.every((entry) => entry.notified === 0 && entry.notNotified === 0)}
    >
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(value: string) => formatShortDate(value)} {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} width={30} />
        <Tooltip
          labelFormatter={(value) => formatShortDate(String(value))}
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--foreground)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="notified" stackId="a" fill={CHART_COLORS.success} name="Notified" radius={[0, 0, 0, 0]} />
        <Bar dataKey="notNotified" stackId="a" fill={CHART_COLORS.danger} name="Not notified" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

export function AttendanceTrendChart({
  data,
}: {
  data: { date: string; present: number; late: number; absent: number; sick: number }[];
}) {
  return (
    <ChartFrame
      title="Attendance trend"
      description="Daily counts of present (on time), late, absent and sick employees from the biometric files."
      empty={data.length === 0}
      height={300}
    >
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(value: string) => formatShortDate(value)} {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} width={30} />
        <Tooltip
          labelFormatter={(value) => formatShortDate(String(value))}
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--foreground)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="present" stackId="a" fill={CHART_COLORS.success} name="Present" />
        <Bar dataKey="late" stackId="a" fill={CHART_COLORS.warning} name="Late" />
        <Bar dataKey="absent" stackId="a" fill={CHART_COLORS.danger} name="Absent" />
        <Bar dataKey="sick" stackId="a" fill={CHART_COLORS.info} name="Sick" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

export function DiscrepancyPieChart({
  data,
}: {
  data: { label: string; count: number; tone: string }[];
}) {
  const palette: Record<string, string> = {
    success: CHART_COLORS.success,
    warning: CHART_COLORS.warning,
    danger: CHART_COLORS.danger,
    info: CHART_COLORS.info,
    neutral: CHART_COLORS.neutral,
    primary: CHART_COLORS.primary,
  };
  return (
    <ChartFrame
      title="WhatsApp vs biometric — discrepancies"
      description="How the audited rows fall across the cross-reference verdicts (conflicts and unnotified issues are the ones that need attention)."
      empty={data.length === 0}
      height={300}
    >
      <PieChart>
        <Tooltip
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--foreground)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Pie
          data={data}
          dataKey="count"
          nameKey="label"
          outerRadius={95}
          innerRadius={45}
          paddingAngle={2}
        >
          {data.map((entry) => (
            <Cell key={entry.label} fill={palette[entry.tone] ?? CHART_COLORS.neutral} />
          ))}
        </Pie>
      </PieChart>
    </ChartFrame>
  );
}

export function MessageClassificationChart({
  staff,
  student,
  uncertain,
}: {
  staff: number;
  student: number;
  uncertain: number;
}) {
  const data = [
    { label: 'Staff messages', count: staff, tone: 'primary' },
    { label: 'Student messages', count: student, tone: 'info' },
    { label: 'Uncertain', count: uncertain, tone: 'warning' },
  ];
  return (
    <ChartFrame
      title="WhatsApp message classification"
      description="Staff, student and uncertain messages detected in the chat export."
      empty={staff + student + uncertain === 0}
      height={260}
    >
      <PieChart>
        <Tooltip
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--foreground)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Pie data={data} dataKey="count" nameKey="label" outerRadius={90}>
          {data.map((entry) => (
            <Cell
              key={entry.label}
              fill={
                entry.tone === 'primary'
                  ? CHART_COLORS.primary
                  : entry.tone === 'info'
                    ? CHART_COLORS.info
                    : CHART_COLORS.warning
              }
            />
          ))}
        </Pie>
      </PieChart>
    </ChartFrame>
  );
}
