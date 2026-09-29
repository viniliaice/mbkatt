// @vitest-environment jsdom
/**
 * End-to-end flow test through the real store: the files a user drags into the
 * Upload page are read with FileReader, detected, parsed and analysed exactly as
 * they are in the browser. Nothing is mocked here.
 */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '@/lib/store';
import type { MatchStatus } from '@/lib/types';
import chatRaw from './fixtures/chat.md?raw';
import matrixRaw from './fixtures/attendence.csv?raw';
import longRaw from './fixtures/attendence11.csv.txt?raw';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let store: ReturnType<typeof useStore> | null = null;

function Probe() {
  store = useStore();
  return null;
}

async function mountStore() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
  });
  return { root, container };
}

async function act<T>(callback: () => Promise<T> | T): Promise<T> {
  let value: T;
  await React.act(async () => {
    value = await callback();
  });
  return value!;
}

describe('upload → analyse flow through the store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    store = null;
  });

  it('reads the three uploaded files, detects their types and produces a real audit', async () => {
    const { root, container } = await mountStore();
    const current = () => store!;

    await act(async () => {
      await current().addFiles([
        new File([chatRaw], 'chat.md', { type: 'text/markdown' }),
        new File([matrixRaw], 'attendence.csv', { type: 'text/csv' }),
        new File([longRaw], 'attendence11.csv.txt', { type: 'text/plain' }),
      ]);
    });

    expect(current().files).toHaveLength(3);
    expect(current().files.map((file) => file.kind).sort()).toEqual([
      'attendance',
      'attendance',
      'whatsapp',
    ]);
    expect(current().files.every((file) => file.preview.length > 0)).toBe(true);

    await act(async () => {
      await current().runAnalysis();
    });

    const result = current().result;
    expect(result).not.toBeNull();
    if (!result) throw new Error('analysis did not produce a result');

    // the numbers the Validation panel shows
    expect(result.validation.totals.attendanceEmployees).toBeGreaterThan(0);
    expect(result.validation.totals.staffMessages).toBeGreaterThan(0);
    expect(result.validation.totals.attendanceRecords).toBeGreaterThan(100);
    expect(result.auditRecords.length).toBeGreaterThan(50);
    expect(result.employeeSummaries.length).toBeGreaterThan(0);
    expect(result.whatsappEvents.length).toBeGreaterThan(0);

    // the audit is evidence-based: every row carries evidence and a verdict
    for (const record of result.auditRecords.slice(0, 40)) {
      expect(record.evidence.length).toBeGreaterThan(0);
      expect(record.matchLabel.length).toBeGreaterThan(3);
    }

    // the spec's critical distinction is present in the real data
    const statuses = new Set<MatchStatus>(result.auditRecords.map((record) => record.matchStatus));
    expect(statuses.has('WHATSAPP_LATE_NOT_CONFIRMED')).toBe(true);
    expect(statuses.has('WHATSAPP_ABSENT_BUT_PRESENT')).toBe(true);
    expect(statuses.has('LATE_NOT_NOTIFIED')).toBe(true);

    // a file can be removed and re-analysis still works
    await act(async () => {
      current().removeFile(current().files[2].id);
    });
    expect(current().files).toHaveLength(2);

    await act(async () => {
      await current().runAnalysis();
    });
    expect(current().result).not.toBeNull();

    await act(async () => {
      current().clearAll();
    });
    expect(current().files).toHaveLength(0);
    expect(current().result).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  }, 30000);

  it('loads the built-in sample files without inventing employees', async () => {
    const { root, container } = await mountStore();
    const current = () => store!;

    await act(async () => {
      await current().loadSamples();
    });
    expect(current().files.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      await current().runAnalysis();
    });
    const result = current().result!;
    expect(result).not.toBeNull();
    // every employee in the summary comes from the attendance file
    const knownNames = new Set(result.attendanceEmployees.map((employee) => employee.id));
    for (const summary of result.employeeSummaries) {
      expect(knownNames.has(summary.employeeId)).toBe(true);
    }

    await act(async () => {
      root.unmount();
    });
    container.remove();
  }, 30000);
});
