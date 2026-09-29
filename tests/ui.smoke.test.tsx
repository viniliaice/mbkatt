// @vitest-environment jsdom
/**
 * UI smoke test: every page must render with a real analysis result built from
 * the three fixture files. This catches broken props, missing exports and
 * undefined access that the engine tests cannot see.
 *
 * The store is mocked so the pages receive the genuine `analyze()` output.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '@/lib/analyze';
import { detectFileType } from '@/lib/detect';
import { emptyCorrections, type AnalysisInputFile, type AnalysisResult, type UploadedFileMeta } from '@/lib/types';
import { AppShell } from '@/components/AppShell';
import { AuditPage } from '@/pages/AuditPage';
import { DashboardPage } from '@/pages/Dashboard';
import { DiscrepanciesPage } from '@/pages/DiscrepanciesPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { PrivacyPage } from '@/pages/PrivacyPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ReviewPage } from '@/pages/ReviewPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UnnotifiedPage } from '@/pages/UnnotifiedPage';
import { UploadPage } from '@/pages/UploadPage';
import { WhatsAppPage } from '@/pages/WhatsAppPage';
import chatRaw from './fixtures/chat.md?raw';
import matrixRaw from './fixtures/attendence.csv?raw';
import longRaw from './fixtures/attendence11.csv.txt?raw';

const storeState = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/lib/store', () => ({
  useStore: () => storeState.value,
  StoreProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function toInputFile(name: string, text: string): AnalysisInputFile {
  const detection = detectFileType(name, text);
  const meta: UploadedFileMeta = {
    id: `file-${name}`,
    name,
    size: text.length,
    mimeType: 'text/plain',
    uploadedAt: '2026-09-16T08:00:00.000Z',
    kind: detection.kind,
    kindOverride: null,
    detection,
    preview: text.slice(0, 600),
    parseStatus: 'parsed',
  };
  return { meta, text };
}

const result: AnalysisResult = analyze({
  files: [
    toInputFile('chat.md', chatRaw),
    toInputFile('attendence.csv', matrixRaw),
    toInputFile('attendence11.csv.txt', longRaw),
  ],
  settings: null,
  aliases: [],
  corrections: emptyCorrections(),
});

function storeValue() {
  const base: Record<string, unknown> = {
    files: result.files.map((report) => report.file),
    settings: result.settings,
    aliases: [],
    corrections: emptyCorrections(),
    result,
    analyzing: false,
    progress: null,
    error: null,
    notice: null,
    searchQuery: '',
  };
  return new Proxy(base, {
    get: (target, property) => (property in target ? target[property as string] : () => undefined),
  }) as ReturnType<typeof import('@/lib/store').useStore>;
}

function render(element: React.ReactElement, path = '/'): string {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
}

// jsdom does not implement matchMedia; the app only uses it for the dark-mode default.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  storeState.value = storeValue();
  window.localStorage.clear();
});

describe('UI smoke tests with a real analysis result', () => {
  it('renders the dashboard with live counters', () => {
    const html = render(<DashboardPage />);
    expect(html).toContain('Unnotified late arrivals');
    expect(html).toContain('Conflicting records');
    expect(html).toContain(String(result.summary.totalLateEvents));
    expect(html).not.toContain('bootstrapping');
  });

  it('renders the upload/validation page with real parsed counts', () => {
    const html = render(<UploadPage />);
    expect(html).toContain('Analyze attendance');
    expect(html).toContain(String(result.validation.totals.whatsappMessages));
    expect(html).toContain(String(result.validation.totals.attendanceEmployees));
  });

  it('renders the daily audit table with employee names and verdicts', () => {
    const html = render(<AuditPage />);
    expect(html).toContain('Attendance audit');
    expect(html).toContain('Employee name');
    expect(html).toContain('WhatsApp original message');
    expect(html).toContain('Ikram');
  });

  it('renders the employee summaries', () => {
    const html = render(<EmployeesPage />);
    expect(html).toContain('Employees');
    expect(html).toContain('Unnotified');
  });

  it('renders the WhatsApp report with original messages', () => {
    const html = render(<WhatsAppPage />);
    expect(html).toContain('WhatsApp reports');
    expect(html).toContain('Match to attendance');
    expect(html).toContain('late');
  });

  it('renders the unnotified page with both lists', () => {
    const html = render(<UnnotifiedPage />);
    expect(html).toContain('Potential unnotified late arrivals');
    expect(html).toContain('Potential unnotified absences');
  });

  it('renders the discrepancy page with the conflict section', () => {
    const html = render(<DiscrepanciesPage />);
    expect(html).toContain('CONFLICT');
    expect(html).toContain('UNNOTIFIED LATE ARRIVAL');
    expect(html).toContain('not proof of lateness');
  });

  it('renders the review center with the detected issues', () => {
    const html = render(<ReviewPage />);
    expect(html).toContain('Review Center');
    expect(html).toContain('Uncertain name match');
  });

  it('renders the report library including the executive summary', () => {
    const html = render(<ReportsPage />);
    expect(html).toContain('Executive summary');
    expect(html).toContain('Full attendance audit');
    expect(html).toContain('Unnotified lateness report');
  });

  it('renders settings with the default rules and the school name field', () => {
    const html = render(<SettingsPage />);
    expect(html).toContain('Working days');
    expect(html).toContain('06:45');
    expect(html).toContain('MBK School');
    expect(html).toContain('Name aliases');
  });

  it('renders the privacy page', () => {
    const html = render(<PrivacyPage />);
    expect(html).toContain('How your data is handled');
    expect(html).toContain('No server transmission');
  });

  it('renders the app shell around a page (sidebar, search, route)', () => {
    const html = render(<AppShell />, '/audit');
    expect(html).toContain('Attendance Audit');
    expect(html).toContain('Upload Files');
    expect(html).toContain('Privacy');
  });

  it('never renders placeholder or dummy content', () => {
    const pages = [
      render(<DashboardPage />),
      render(<AuditPage />),
      render(<WhatsAppPage />),
      render(<ReportsPage />),
      render(<DiscrepanciesPage />),
    ];
    for (const html of pages) {
      expect(html.toLowerCase()).not.toContain('lorem ipsum');
      expect(html).not.toMatch(/\bTODO\b/);
      expect(html).not.toContain('Example Employee');
    }
  });
});
