/**
 * Application shell: sidebar navigation, top bar with global search, and the
 * shared layout used by every page.
 */

import {
  BarChart3,
  BellRing,
  CalendarCheck,
  FileSpreadsheet,
  Filter,
  LayoutDashboard,
  Lock,
  Menu,
  Moon,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  Sun,
  Upload,
  Users,
  X,
} from 'lucide-react';
import * as React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useStore } from '@/lib/store';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: (result: ReturnType<typeof useStore>['result']) => number | null;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/upload', label: 'Upload Files', icon: Upload },
  { to: '/audit', label: 'Attendance Audit', icon: CalendarCheck },
  { to: '/employees', label: 'Employees', icon: Users },
  { to: '/whatsapp', label: 'WhatsApp Reports', icon: BellRing },
  {
    to: '/unnotified',
    label: 'Unnotified',
    icon: BellRing,
    badge: (result) =>
      result ? result.summary.unnotifiedLateArrivals + result.summary.unnotifiedAbsences : null,
  },
  {
    to: '/discrepancies',
    label: 'Discrepancies',
    icon: ShieldAlert,
    badge: (result) => (result ? result.summary.conflictingRecords : null),
  },
  {
    to: '/review',
    label: 'Review Center',
    icon: Filter,
    badge: (result) => (result ? result.reviewIssues.length : null),
  },
  { to: '/reports', label: 'Reports', icon: FileSpreadsheet },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
  { to: '/privacy', label: 'Privacy', icon: Lock },
];

function useDarkMode() {
  const [dark, setDark] = React.useState(() => {
    const stored = window.localStorage.getItem('mbk-theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    window.localStorage.setItem('mbk-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, setDark };
}

export function AppShell() {
  const { result, files, settings, searchQuery, setSearchQuery, notice, error, dismissNotice } =
    useStore();
  const { dark, setDark } = useDarkMode();
  const [mobileNav, setMobileNav] = React.useState(false);
  const location = useLocation();

  React.useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Main navigation">
      <div className="flex items-center gap-2 px-2 py-3">
        <div className="grid size-9 place-items-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)]">
          <BarChart3 className="size-5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">MBK Attendance</p>
          <p className="text-xs text-[var(--muted-foreground)]">Audit &amp; cross-reference</p>
        </div>
      </div>

      {NAV.map((item) => {
        const Icon = item.icon;
        const badge = item.badge?.(result) ?? null;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[var(--primary)]/12 text-[var(--primary)]'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]',
              )
            }
          >
            <Icon className="size-4" />
            <span className="flex-1">{item.label}</span>
            {badge !== null && badge > 0 ? (
              <span className="rounded-full bg-[var(--accent)] px-1.5 text-xs tabular-nums">{badge}</span>
            ) : null}
          </NavLink>
        );
      })}

      <div className="mt-auto space-y-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-xs text-[var(--muted-foreground)]">
        <p className="flex items-center gap-2 font-medium text-[var(--foreground)]">
          <Lock className="size-3.5" /> Private by design
        </p>
        <p>
          Files are processed inside your browser tab ({files.length} loaded). Nothing is uploaded to a
          server.
        </p>
        <p>
          {settings.persistToBrowser
            ? 'Local persistence is ON — data is kept in this browser only.'
            : 'Local persistence is OFF — everything is discarded when the tab closes.'}
        </p>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-[var(--border)] bg-[var(--card)] lg:block">
        {sidebar}
      </aside>

      {mobileNav ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNav(false)} />
          <div className="animate-slide-in absolute left-0 top-0 h-full w-72 border-r border-[var(--border)] bg-[var(--card)]">
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="icon" onClick={() => setMobileNav(false)} aria-label="Close menu">
                <X />
              </Button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--card)]/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileNav(true)}
              aria-label="Open menu"
            >
              <Menu />
            </Button>

            <div className="relative min-w-[160px] flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Global search: employee, date, message, status…"
                className="pl-8"
                aria-label="Global search"
              />
            </div>

            <div className="flex items-center gap-2">
              {result ? (
                <>
                  <Badge tone="success" className="hidden sm:inline-flex">
                    Analysis ready
                  </Badge>
                  <Badge tone="neutral" className="hidden md:inline-flex">
                    {result.summary.auditRecords} audit rows
                  </Badge>
                </>
              ) : (
                <Badge tone="warning" className="hidden sm:inline-flex">
                  No analysis yet
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDark(!dark)}
                aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {dark ? <Sun /> : <Moon />}
              </Button>
            </div>
          </div>

          {error ? (
            <div className="border-t border-[var(--border)] bg-red-50 px-4 py-2 text-sm text-red-900 dark:bg-red-950/60 dark:text-red-100">
              <div className="flex items-start justify-between gap-4">
                <span>{error}</span>
                <button onClick={dismissNotice} className="text-xs underline" aria-label="Dismiss">
                  dismiss
                </button>
              </div>
            </div>
          ) : null}
          {notice ? (
            <div className="border-t border-[var(--border)] bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:bg-sky-950/60 dark:text-sky-100">
              <div className="flex items-start justify-between gap-4">
                <span>{notice}</span>
                <button onClick={dismissNotice} className="text-xs underline" aria-label="Dismiss">
                  dismiss
                </button>
              </div>
            </div>
          ) : null}
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>

        <footer className="border-t border-[var(--border)] px-4 py-4 text-xs text-[var(--muted-foreground)] sm:px-6">
          {settings.schoolName} — MBK Attendance Audit. Attendance and WhatsApp data are sensitive: keep exported
          files confidential. See the Privacy page for how data is handled.
        </footer>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function NoAnalysis({ what }: { what: string }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] p-10 text-center">
      <h2 className="text-lg font-semibold">No analysis available yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted-foreground)]">
        {what} is built from your uploaded files. Upload a WhatsApp export and the attendance
        file(s), then press “Analyze attendance”. Nothing is displayed until real data exists — this
        application never shows placeholder figures.
      </p>
      <Button className="mt-4" onClick={() => navigate('/upload')}>
        <Upload /> Go to Upload Files
      </Button>
    </div>
  );
}
