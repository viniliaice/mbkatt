/**
 * WhatsApp export format coverage — specification items 39–45.
 *
 * Every format the school may export must be recognised, independently of any
 * employee roster: parsing happens first, name matching happens later.
 */

import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from '@/lib/parsers/whatsapp';
import { detectFileType } from '@/lib/detect';

const options = (fileName = 'chat.md') => ({
  fileId: 'f1',
  fileName,
  dateOrder: 'auto' as const,
  fallbackYear: 2026,
});

const FORMAT_A = `[9/1/26, 5:17:33 AM] Fardosa Kamal: I'll be in late
[9/1/26, 6:07:15 AM] Fardosa Kamal: Ikram will be late`;

const FORMAT_B = `[5:17] **Fardosa Kamal:** I'll be in late
[6:07] **Fardosa Kamal:** Ikram will be late
[6:13] **Cali KAMAL:** Maxamed siyaad
He is sick today`;

const FORMAT_C = `[2026-09-01 05:17] Fardosa Kamal: I'll be in late
[2026-09-01 06:07] Fardosa Kamal: Ikram will be late`;

// the 15th forces day-first interpretation from the data itself (no hard coding)
const FORMAT_D = `01/09/2026, 05:17 - Fardosa Kamal: I'll be in late
15/09/2026, 06:07 - Fardosa Kamal: Ikram will be late`;

const FORMAT_E = `01/09/2026, 05:17:33 - Fardosa Kamal: I'll be in late
01/09/2026, 06:07:12 - Fardosa Kamal: Ikram will be late
16/09/2026, 06:11:05 - Fardosa Kamal: Nuha is sick`;

const FORMAT_F = `## 1 September 2026

[5:17] **Fardosa Kamal:** I'll be in late

[6:07] **Fardosa Kamal:** Ikram will be late

[6:13] **Cali KAMAL:** Maxamed siyaad
He is sick today

## 2 September 2026

[7:02] **c\\wasac:** Bus 2 is late, grade 5 students are waiting`;

describe('WhatsApp export formats (spec 39–41)', () => {
  it('FORMAT A — [9/1/26, 5:17:33 AM] Sender: message', () => {
    const result = parseWhatsAppExport(FORMAT_A, options());
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].date).toBe('2026-09-01');
    expect(result.messages[0].minutesOfDay).toBe(5 * 60 + 17);
    expect(result.messages[0].sender).toBe('Fardosa Kamal');
    expect(result.messages[0].raw).toBe("I'll be in late");
  });

  it('FORMAT B — [5:17] **Sender:** message (markdown bold sender, no date)', () => {
    const result = parseWhatsAppExport(FORMAT_B, options());
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].minutesOfDay).toBe(5 * 60 + 17);
    expect(result.messages[0].sender).toBe('Fardosa Kamal');
    expect(result.messages[0].raw).toBe("I'll be in late");
    expect(result.messages[2].sender).toBe('Cali KAMAL');
    expect(result.messages[2].raw).toBe('Maxamed siyaad\nHe is sick today');
    expect(result.diagnostics.timestamps).toBe(3);
    expect(result.diagnostics.parsedMessages).toBe(3);
  });

  it('FORMAT C — [2026-09-01 05:17] Sender: message', () => {
    const result = parseWhatsAppExport(FORMAT_C, options());
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].date).toBe('2026-09-01');
    expect(result.messages[0].minutesOfDay).toBe(5 * 60 + 17);
    expect(result.messages[0].sender).toBe('Fardosa Kamal');
  });

  it('FORMAT D — 01/09/2026, 05:17 - Sender: message', () => {
    const result = parseWhatsAppExport(FORMAT_D, options());
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].date).toBe('2026-09-01');
    expect(result.messages[1].date).toBe('2026-09-15');
    expect(result.messages[0].minutesOfDay).toBe(5 * 60 + 17);
  });

  it('FORMAT E — 01/09/2026, 05:17:33 - Sender: message', () => {
    const result = parseWhatsAppExport(FORMAT_E, options());
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].date).toBe('2026-09-01');
    expect(result.messages[1].minutesOfDay).toBe(6 * 60 + 7);
    expect(result.messages[2].date).toBe('2026-09-16');
  });

  it('FORMAT F — markdown date headings apply to the messages below them', () => {
    const result = parseWhatsAppExport(FORMAT_F, options());
    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((message) => message.date)).toEqual([
      '2026-09-01',
      '2026-09-01',
      '2026-09-01',
      '2026-09-02',
    ]);
    expect(result.diagnostics.dateHeadings).toBe(2);
    expect(result.messages[3].sender).toBe('c\\wasac');
  });

  it('keeps a multi-line message as ONE message (spec 41)', () => {
    const text = `## 6 September 2026

[16:20] **Fardosa Kamal:** Assalamu alaikum wa rahmatullahi wa barakatuh,

Sultan's mom called me just now and informed me that he is unable to open his eye.

She is taking him to the hospital for further examination.

[16:31] **Fardosa Kamal:** Jazakallah khair`;

    const result = parseWhatsAppExport(text, options());
    expect(result.messages).toHaveLength(2);
    const first = result.messages[0];
    expect(first.date).toBe('2026-09-06');
    expect(first.minutesOfDay).toBe(16 * 60 + 20);
    expect(first.sender).toBe('Fardosa Kamal');
    expect(first.raw).toContain('Assalamu alaikum');
    expect(first.raw).toContain('unable to open his eye');
    expect(first.raw).toContain('further examination');
    expect(first.rawLines.length).toBeGreaterThanOrEqual(5);
    expect(result.diagnostics.recoveredMultiline).toBe(2);
  });

  it('parses partial names without any employee roster (spec 42)', () => {
    const text = `## 1 September 2026
[5:17] **Fardosa:** I'll be in late
[6:07] **Ikram:** Ikram will be late
[6:09] **T. Axmed Jaamac:** coming in 10 minutes
[6:11] **c\\wasac:** Bus 2 left`;
    const result = parseWhatsAppExport(text, options());
    // no roster, no name matching: every message is still parsed
    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((message) => message.sender)).toEqual([
      'Fardosa',
      'Ikram',
      'T. Axmed Jaamac',
      'c\\wasac',
    ]);
    expect(result.messages.every((message) => message.date === '2026-09-01')).toBe(true);
  });

  it('reports diagnostics that match the file contents (spec 45)', () => {
    const result = parseWhatsAppExport(FORMAT_F, options());
    expect(result.diagnostics.dateHeadings).toBe(2);
    expect(result.diagnostics.timestamps).toBe(4);
    expect(result.diagnostics.senderPatterns).toBe(4);
    expect(result.diagnostics.messageBlocks).toBe(4);
    expect(result.diagnostics.parsedMessages).toBe(4);
    expect(result.diagnostics.malformed).toBe(0);
    expect(result.diagnostics.missingSender).toBe(0);
    expect(result.diagnostics.formatMismatch).toBe(false);
    expect(result.diagnostics.sampleLines.length).toBeGreaterThan(0);
  });

  it('flags a parser format mismatch instead of silently returning zero (spec 45)', () => {
    // timestamps are present but no supported sender pattern is used
    const text = `5:17 | Fardosa Kamal => I'll be in late
6:07 | Ikram => late again`;
    const result = parseWhatsAppExport(text, options());
    expect(result.messages.length).toBe(0);
    expect(result.diagnostics.formatMismatch).toBe(true);
    expect(result.diagnostics.timestamps).toBeGreaterThan(0);
    expect(result.diagnostics.unrecognisedSamples.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/no messages|format mismatch/i);
  });

  it('detects a markdown chat export as WhatsApp, not as attendance (spec 50)', () => {
    const detection = detectFileType('chat.md', FORMAT_F);
    expect(detection.kind).toBe('whatsapp');
    expect(detection.confidence).toBeGreaterThan(0.8);
  });

  it('keeps the original message text untouched', () => {
    const result = parseWhatsAppExport(FORMAT_F, options());
    expect(result.messages[0].raw).toBe("I'll be in late");
    expect(result.messages[2].raw).toBe('Maxamed siyaad\nHe is sick today');
  });
});
