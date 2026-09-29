# MBK Attendance Audit

A complete, offline-first staff attendance audit for **MBK School**. It cross-references the
school's WhatsApp attendance messages against the biometric (fingerprint) attendance exports and
answers, for every employee and every working day:

- who was **late, absent, sick or left early**;
- **who notified** the WhatsApp group, **when**, and **what the message said**;
- **what the biometric machine recorded** (first punch, last punch, punch count);
- whether the two **agree or conflict**, with a numbered verdict for every case;
- which biometric records have **no notification**, and which notifications have **no biometric
  evidence**;
- per-employee totals for lateness, absence, sickness, early departure and unnotified issues.

Every calculated status can be opened with **“View original evidence”**, which shows the exact
source message, the attendance cell it came from, and the rule that produced the verdict.

---

## Running the application

```bash
npm install

# development (hot reload)
npm run dev            # http://localhost:5173

# production build + local static server (no database, no API)
npm run build
npm start              # http://localhost:4173

# tests
npm test               # 130 tests: parsers, rules, matching, cross-reference, UI + store flow
npm run typecheck      # tsc -b
```

The application is **100 % client-side**. There is no backend, no database and no third-party
service: the files you open are parsed in the browser tab, the audit is computed there, and the
exports are generated locally. `server/index.mjs` only serves the built static files.

Everything is also importable without Node servers at all — any static host that serves
`dist/index.html` for unknown routes will do.

---

## How to run an audit

1. **Upload Files** — drag in the WhatsApp export (`chat.md`), the attendance export
   (`attendence.csv`) and/or a long-format export (`attendence11.csv.txt`). `.md`, `.txt`, `.csv`,
   `.tsv` and Excel (`.xlsx`/`.xls`) files are supported. The type of each file is detected from its
   content and can be corrected before analysing.
2. **Analyze attendance** — identification and parsing are reported as two separate operations for
   every file: a *Files Detected* card shows the detected type, the detection confidence, the record
   count and the staff / student / uncertain split, with **Raw** and **Parsed** previews and a
   **Re-analyze** button. A WhatsApp export that yields no messages says so explicitly, with the
   parser counters and the recognised/unrecognised sample lines behind a **PARSER FORMAT MISMATCH**
   verdict — never a silent “0 messages”.
3. **Check the parsing diagnostics and problems** — the counters (date headings, timestamps, sender
   patterns, message blocks, parsed, malformed, missing sender, multi-line recovered) sit above a
   **Parsing problems by category** panel where every item carries its file, line, raw content and a
   suggested correction.
4. **Choose the attendance source** — when two attendance files overlap, the app classifies the
   relationship (same data / different view / complementary / conflicting) and asks you to pick
   **Use both**, **CSV as primary** or **Report as primary**. Employees and days are never
   double-counted, and the app states which source was used for each overlapping day.
5. **Review the “Validation before analysis” screen** — messages (staff / student / uncertain),
   attendance employees, matched / requiring review / unmatched, records and punches read, coverage,
   working days, and critical vs. warning problems. **Proceed to Analyze** is disabled while critical
   problems remain, unless you explicitly choose **Proceed anyway** (the affected days stay marked as
   parsing problems and are never turned into absences).
6. **Work through the pages** — Dashboard, Attendance Audit, Employees (click any employee for the
   full profile), WhatsApp Reports, Unnotified, Discrepancies, Review Center (including the
   **Person matching** tab), Administrative Report.
7. **Record administrative decisions** — the Review button on any questionable record opens the
   administrative dialog (confirm excused / unexcused, mark as leave, correct attendance, add
   documentation, add an administrative action) and records the reviewer, the date and time, the
   decision and the notes.
8. **Export** — Excel / CSV / PDF / JSON for nine reports, plus the **MBK Attendance Administrative
   Report**: a six-section PDF (Teacher Summary, Itemized Absence & Late Log, Unnotified Attendance,
   Conflicting Records, Pending Administrative Review, Administrative Review Notes) and an equivalent
   multi-sheet Excel workbook.
6. **Delete the files** when you are done (Privacy page) — or leave local persistence on to continue
   later on the same computer.

### Default rules (all configurable in Settings)

| Rule | Default |
| --- | --- |
| Working days | Saturday – Thursday (Friday is the weekend) |
| Late after | **06:45** on ordinary working days — 06:45 exactly is **not** late |
| Thursday | late after **08:00** — 08:00 exactly is **not** late |
| Early departure | last punch before 13:00 |
| Valid punch window | 03:00 – 23:00 (values outside are reported, not used) |
| Minimum punches per day | 1 |
| Name matching | matched ≥ 85 %, possible ≥ 62 %, transliteration variants on |
| Attendance rate | present days ÷ expected working days × 100, with approved leave, excused absences, holidays, weekends and other approved exclusions toggleable |
| Late minutes | from the biometric punch only — never estimated from WhatsApp unless you enable estimation *and* no readable punch exists |
| Administrative status | Perfect (0 absences / 0 late) · Satisfactory (rate ≥ 90 % and late ≤ 2) · Verbal Notice (late ≥ 3) · Review Required (rate < 85 % or unexcused ≥ 1 or late ≥ 6) · Critical Review (rate < 75 % or unexcused ≥ 3) |

Holidays, extra working days, per-weekday cut-offs, thresholds, date orders and the “no punch =
absence” behaviour are all editable in **Settings** and re-applied by pressing *Apply & re-run
analysis*. Rules are never hard-coded.

---

## What the audit will *not* do

These are correctness guarantees built into the engine (see `src/lib/audit.ts`, `src/lib/analyze.ts`
and the tests):

- it never invents a notification — only a message in the uploaded export can mark someone notified;
- a **similar name alone never marks a person as notified**, and low-confidence matches are proposed
  in the Review Center instead of being merged;
- it never marks somebody absent just because a punch is missing when the file looks incomplete —
  that is reported as a parsing problem;
- it never converts a claim into a fact: “WhatsApp says late” with an on-time punch becomes
  *WhatsApp-reported lateness — not confirmed*, and “reported absent but present” becomes a **CONFLICT**;
- it never treats “on the way”, “will be back” or “went out” as an absence;
- student/bus messages are classified and kept (never deleted), and uncertain messages stay visible
  and can be corrected by hand;
- raw data is never hidden: original wording, punch text, source file and line number stay available
  everywhere, including in exports;
- a **WhatsApp notification is never an administrative excuse**: the two are separate fields, and the
  administrative excuse stays *Pending Review* until an administrator records it;
- reasons, medical certificates, HR forms, verbal warnings and administrative actions are **never
  invented** — if the sources do not contain them the report reads *Not provided* or *Pending
  administrative review*;
- an administrative status always names **the exact rule that produced it** — no subjective wording;
- administrative thresholds are configurable in Settings and are never hard-coded;
- a teacher who appears only in WhatsApp (with no attendance record at all) is reported with an
  explicit identity verdict and a blank attendance rate instead of a fabricated 0 %.

---

## Architecture

```
src/lib/detect.ts             structural file-type identification with per-file confidence and reasons
src/lib/parsers/whatsapp.ts   WhatsApp export parser (formats A–F, markdown date headings, multi-line
                              bodies kept as one message, per-file parse diagnostics)
src/lib/parsers/attendance.ts matrix + long-format attendance parser (multiple punches per cell,
                              ABSENT/LEAVE markers, Excel serial times, malformed values)
src/lib/time.ts               clock/date-value parsing (06:38, 6.38, 0.2764, 6:38:00 AM, 638)
src/lib/dates.ts              loose date parsing with MDY/DMY/YMD detection
src/lib/classify.ts           staff vs student classification, event detection, mentions, bus/grade info
src/lib/normalize.ts          name canonicalisation, titles, transliteration variants, similarity
src/lib/matcher.ts            employee matching with confidence tiers and alternatives
src/lib/rules.ts              working days, late cut-offs, early departure, evaluation with evidence
src/lib/audit.ts              message → employee resolution, daily audit rows, numbered verdicts
src/lib/analyze.ts            orchestrator: parse → classify → match → evaluate → cross-reference
src/lib/summary.ts            per-employee and dashboard summaries
src/lib/sources.ts            duplicate/overlapping attendance files: relationship, no double-counting,
                              which source was used for each overlapping day
src/lib/admin.ts              administrative layer: late-minute provenance, excuse status, attendance
                              rate with exclusions, configurable status ladder with the exact rule
src/lib/adminReport.ts        six-section administrative report (PDF + multi-sheet Excel)
src/lib/reports.ts            9 report datasets, CSV/JSON/XLSX/PDF exporters, executive summary
src/lib/store.tsx             React state: uploads, settings, aliases, corrections, analysis
src/components/*              UI primitives, tables, charts, status badges, evidence panel,
                              administrative review dialog
src/pages/*                   Dashboard, Upload & validation, Audit, Employees, WhatsApp, Unnotified,
                              Discrepancies, Review Center, Administrative Report, Reports, Settings,
                              Privacy
```

### The thirteen verdicts

`1` late + notified · `2` late + not notified · `3` absent + notified · `4` absent + not notified ·
`5` sick + notified · `6` sick + no biometric record · `7` left early + notified ·
`8` WhatsApp-reported lateness not confirmed by biometrics · `9` biometric lateness with no report ·
`10` WhatsApp absence but biometric present (conflict) · `11` WhatsApp present with no biometric
record · `12` both sources agree · `13` uncertain / needs review.

Practical extensions (also shown, never hidden): left early without notification, sick without
notification, biometric absence with no report, WhatsApp lateness with no biometric record,
biometric data unavailable, unmatched WhatsApp name, biometric parsing issue, report with no
biometric record, and “claim not confirmed”.

---

## Tests

```bash
npm test
```

170 tests across 12 files cover time parsing, date parsing, staff/student classification, attendance
parsing (matrix and long formats), all six WhatsApp export formats, the rules engine, name
normalization and matching (including the prefix, partial-name and “one shared name” cases), the
cross-reference engine, the administrative layer (late-minute provenance, excuse status, attendance
rate and exclusions, the status ladder, report sections and the “never invent” rules), the end-to-end
analysis of the three fixture files, and the UI: every page — including the upload/validation and
administrative report screens — is rendered against a real analysis result, and the store flow
(upload → detect → analyse → clear) is exercised with real `File` objects.

`tests/fixtures/` contains the three files in the formats the school actually uses: a WhatsApp chat
export with late/absent/sick/left-early/bus/student messages, a matrix attendance sheet with
multi-punch cells, `ABSENT` markers, placeholders and one malformed value, and a long-format export
covering overlapping employees and dates.

---

## Privacy

- No upload endpoint, no analytics, no external requests of any kind.
- Files are read with the browser File API and parsed in memory.
- Optional local persistence is off until you enable it and stores data in this browser only
  (`localStorage` key `mbk-attendance-audit-v1`); the Privacy page deletes it at any time.
- PDF exports carry a confidentiality footer; treat the exports like any staff record.
