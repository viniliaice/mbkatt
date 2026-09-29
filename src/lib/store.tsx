/**
 * Application state: uploaded files, settings, manual corrections and the
 * analysis result.
 *
 * Privacy: everything stays in this browser tab. Files are read locally with the
 * FileReader API, the analysis runs in-page and nothing is uploaded anywhere.
 * Persistence to localStorage is opt-in (Settings → Privacy) and only ever
 * stores the data on this device.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as XLSX from 'xlsx';
import { analyze } from '@/lib/analyze';
import { detectFileType } from '@/lib/detect';
import { DEFAULT_SETTINGS, settingsWithDefaults } from '@/lib/rules';
import { emptyCorrections } from '@/lib/types';
import type {
  AliasRule,
  AnalysisInputFile,
  AnalysisResult,
  Audience,
  Corrections,
  FileKind,
  Settings,
  StaffEventType,
  UploadedFileMeta,
} from '@/lib/types';

const STORAGE_KEY = 'mbk-attendance-audit-v1';
const MAX_PERSISTED_BYTES = 3 * 1024 * 1024;

interface PersistedState {
  files: { meta: UploadedFileMeta; text: string; rows?: string[][] }[];
  settings: Settings;
  aliases: AliasRule[];
  corrections: Corrections;
}

export interface ProgressState {
  step: string;
  ratio: number;
}

interface StoreValue {
  files: UploadedFileMeta[];
  settings: Settings;
  aliases: AliasRule[];
  corrections: Corrections;
  result: AnalysisResult | null;
  analyzing: boolean;
  progress: ProgressState | null;
  error: string | null;
  notice: string | null;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  addFiles: (list: File[] | FileList) => Promise<void>;
  removeFile: (id: string) => void;
  setFileKind: (id: string, kind: FileKind) => void;
  clearAll: () => void;
  clearAnalysis: () => void;
  runAnalysis: () => Promise<void>;
  loadSamples: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  addAlias: (alias: AliasRule) => void;
  removeAlias: (whatsappName: string) => void;
  setAudience: (messageId: string, audience: Audience) => void;
  setEvents: (messageId: string, events: StaffEventType[]) => void;
  removeMention: (messageId: string, mention: string) => void;
  setNameOverride: (whatsappName: string, employeeId: string | 'reject' | null) => void;
  dismissRecord: (auditId: string) => void;
  resetCorrections: () => void;
  dismissNotice: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function readXlsx(buffer: ArrayBuffer): { text: string; rows: string[][] } {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: '',
  }) as unknown as string[][];
  const cleaned = rows.map((row) =>
    (row ?? []).map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
  );
  // Text form is still produced so the preview and detection work unchanged
  const text = cleaned.map((row) => row.join(',')).join('\n');
  return { text, rows: cleaned };
}

function fileKindFromName(name: string): 'xlsx' | 'text' {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')) return 'xlsx';
  return 'text';
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<UploadedFileMeta[]>([]);
  const [settings, setSettings] = useState<Settings>(() => settingsWithDefaults(DEFAULT_SETTINGS));
  const [aliases, setAliases] = useState<AliasRule[]>([]);
  const [corrections, setCorrections] = useState<Corrections>(() => emptyCorrections());
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const contents = useRef<Map<string, AnalysisInputFile>>(new Map());
  const [restored, setRestored] = useState(false);

  /* ------------------------------------------------------------- restore */
  useEffect(() => {
    if (restored) return;
    setRestored(true);
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.settings) setSettings(settingsWithDefaults(parsed.settings));
      if (parsed.aliases) setAliases(parsed.aliases);
      if (parsed.corrections) setCorrections({ ...emptyCorrections(), ...parsed.corrections });
      if (parsed.files?.length) {
        const metas: UploadedFileMeta[] = [];
        for (const entry of parsed.files) {
          contents.current.set(entry.meta.id, {
            meta: entry.meta,
            text: entry.text,
            rows: entry.rows,
          });
          metas.push(entry.meta);
        }
        setFiles(metas);
        setNotice(
          `Restored ${metas.length} file(s) from this browser. Click "Analyze attendance" to re-run the audit.`,
        );
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [restored]);

  /* ------------------------------------------------------------- persist */
  useEffect(() => {
    if (!restored) return;
    if (!settings.persistToBrowser) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const timeout = window.setTimeout(() => {
      const payload: PersistedState = {
        files: files
          .map((meta) => {
            const input = contents.current.get(meta.id);
            return input ? { meta, text: input.text, rows: input.rows } : null;
          })
          .filter(Boolean) as PersistedState['files'],
        settings,
        aliases,
        corrections,
      };
      try {
        const serialized = JSON.stringify(payload);
        if (serialized.length > MAX_PERSISTED_BYTES) {
          // Too large to keep the raw files — keep the configuration only.
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ files: [], settings, aliases, corrections }),
          );
          return;
        }
        window.localStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        /* storage full or unavailable — analysis still works in-memory */
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [files, settings, aliases, corrections, restored]);

  /* ----------------------------------------------------------- file input */
  const addFiles = useCallback(
    async (list: File[] | FileList) => {
      const incoming = Array.from(list);
      if (incoming.length === 0) return;
      setError(null);
      const added: UploadedFileMeta[] = [];
      const problems: string[] = [];

      for (const file of incoming) {
        try {
          let text = '';
          let rows: string[][] | undefined;
          if (fileKindFromName(file.name) === 'xlsx') {
            const buffer = await file.arrayBuffer();
            const parsed = readXlsx(buffer);
            text = parsed.text;
            rows = parsed.rows;
          } else {
            text = await file.text();
          }
          if (!text.trim()) {
            problems.push(`"${file.name}" is empty.`);
            continue;
          }
          const detection = detectFileType(file.name, text);
          const meta: UploadedFileMeta = {
            id: `file-${Date.now().toString(36)}-${added.length}-${Math.random()
              .toString(36)
              .slice(2, 7)}`,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'text/plain',
            uploadedAt: new Date().toISOString(),
            kind: detection.kind,
            kindOverride: null,
            detection,
            preview: text.slice(0, 600),
            parseStatus: 'parsed',
          };
          contents.current.set(meta.id, { meta, text, rows });
          added.push(meta);
        } catch (cause) {
          problems.push(
            `"${file.name}" could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }

      if (added.length > 0) {
        setFiles((current) => {
          // Replace a file with the same name so re-uploading is intuitive
          const names = new Set(added.map((meta) => meta.name));
          for (const meta of current) {
            if (names.has(meta.name)) contents.current.delete(meta.id);
          }
          return [...current.filter((meta) => !names.has(meta.name)), ...added];
        });
      }
      if (problems.length > 0) setError(problems.join(' '));
    },
    [],
  );

  const removeFile = useCallback((id: string) => {
    contents.current.delete(id);
    setFiles((current) => current.filter((meta) => meta.id !== id));
  }, []);

  const setFileKind = useCallback((id: string, kind: FileKind) => {
    setFiles((current) =>
      current.map((meta) => {
        if (meta.id !== id) return meta;
        const updated: UploadedFileMeta = { ...meta, kindOverride: kind };
        const input = contents.current.get(id);
        if (input) contents.current.set(id, { ...input, meta: updated });
        return updated;
      }),
    );
  }, []);

  const clearAll = useCallback(() => {
    contents.current.clear();
    setFiles([]);
    setResult(null);
    setError(null);
    setNotice('All uploaded files and the analysis have been deleted from this browser.');
  }, []);

  const clearAnalysis = useCallback(() => {
    setResult(null);
    setNotice('The analysis result was cleared. Your uploaded files are still loaded.');
  }, []);

  /* -------------------------------------------------------------- analysis */
  const runAnalysis = useCallback(async () => {
    if (files.length === 0) {
      setError('Upload at least one file before running the analysis.');
      return;
    }
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    setProgress({ step: 'Preparing', ratio: 0.02 });
    // let the progress overlay paint before the (synchronous) pipeline starts
    await new Promise((resolve) => window.setTimeout(resolve, 60));

    try {
      const inputs: AnalysisInputFile[] = files
        .map((meta) => contents.current.get(meta.id))
        .filter((input): input is AnalysisInputFile => Boolean(input))
        .map((input) => ({
          ...input,
          meta: files.find((meta) => meta.id === input.meta.id) ?? input.meta,
        }));

      const analysis = analyze({
        files: inputs,
        settings,
        aliases,
        corrections,
        onProgress: (step, ratio) => setProgress({ step, ratio }),
      });
      setResult(analysis);
      setNotice(
        `Analysis finished in ${analysis.durationMs} ms — ${analysis.summary.auditRecords} audit row(s) across ${analysis.summary.workingDays} working day(s).`,
      );
    } catch (cause) {
      setResult(null);
      setError(
        `The analysis failed: ${cause instanceof Error ? cause.message : String(cause)}. No data was changed — check the file types and try again.`,
      );
    } finally {
      setAnalyzing(false);
      setProgress(null);
    }
  }, [aliases, corrections, files, settings]);

  const loadSamples = useCallback(async () => {
    const sampleFiles: { name: string; text: string }[] = [
      { name: 'chat.md', text: SAMPLE_CHAT },
      { name: 'attendence.csv', text: SAMPLE_MATRIX },
      { name: 'attendence11.csv.txt', text: SAMPLE_LONG },
    ];
    const added: UploadedFileMeta[] = [];
    for (const sample of sampleFiles) {
      const detection = detectFileType(sample.name, sample.text);
      const meta: UploadedFileMeta = {
        id: `sample-${sample.name}`,
        name: sample.name,
        size: sample.text.length,
        mimeType: 'text/plain',
        uploadedAt: new Date().toISOString(),
        kind: detection.kind,
        kindOverride: null,
        detection,
        preview: sample.text.slice(0, 600),
        parseStatus: 'parsed',
      };
      contents.current.set(meta.id, { meta, text: sample.text });
      added.push(meta);
    }
    setFiles(added);
    setSettings((current) => ({ ...current, fallbackYear: 2026 }));
    setNotice(
      'Sample files loaded (the example chat and attendance exports used to demonstrate the audit). Replace them with your own files before relying on the result.',
    );
  }, []);

  /* -------------------------------------------------------------- settings */
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => settingsWithDefaults({ ...current, ...patch }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(settingsWithDefaults(DEFAULT_SETTINGS));
    setNotice('Settings restored to the defaults (Saturday–Wednesday late after 06:45, Thursday after 08:00, Friday weekend).');
  }, []);

  const addAlias = useCallback((alias: AliasRule) => {
    setAliases((current) => {
      const rest = current.filter(
        (rule) => rule.whatsappName.toLowerCase() !== alias.whatsappName.toLowerCase(),
      );
      return [...rest, alias];
    });
  }, []);

  const removeAlias = useCallback((whatsappName: string) => {
    setAliases((current) =>
      current.filter((rule) => rule.whatsappName.toLowerCase() !== whatsappName.toLowerCase()),
    );
  }, []);

  /* ----------------------------------------------------------- corrections */
  const patchCorrections = useCallback((patch: Partial<Corrections>) => {
    setCorrections((current) => ({ ...current, ...patch }));
  }, []);

  const setAudience = useCallback(
    (messageId: string, audience: Audience) => {
      setCorrections((current) => ({
        ...current,
        audience: { ...current.audience, [messageId]: audience },
      }));
    },
    [],
  );

  const setEvents = useCallback((messageId: string, events: StaffEventType[]) => {
    setCorrections((current) => ({ ...current, events: { ...current.events, [messageId]: events } }));
  }, []);

  const removeMention = useCallback((messageId: string, mention: string) => {
    setCorrections((current) => {
      const existing = current.removedMentions[messageId] ?? [];
      return {
        ...current,
        removedMentions: {
          ...current.removedMentions,
          [messageId]: [...new Set([...existing, mention])],
        },
      };
    });
  }, []);

  const setNameOverride = useCallback(
    (whatsappName: string, employeeId: string | 'reject' | null) => {
      setCorrections((current) => {
        const next = { ...current.nameOverrides };
        if (employeeId === null) delete next[whatsappName];
        else next[whatsappName] = employeeId;
        return { ...current, nameOverrides: next };
      });
    },
    [],
  );

  const dismissRecord = useCallback((auditId: string) => {
    setCorrections((current) => ({
      ...current,
      dismissedRecords: [...new Set([...current.dismissedRecords, auditId])],
    }));
  }, []);

  const resetCorrections = useCallback(() => {
    setCorrections(emptyCorrections());
    setNotice('All manual corrections were reset. The audit will use the automatic results again.');
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      files,
      settings,
      aliases,
      corrections,
      result,
      analyzing,
      progress,
      error,
      notice,
      searchQuery,
      setSearchQuery,
      addFiles,
      removeFile,
      setFileKind,
      clearAll,
      clearAnalysis,
      runAnalysis,
      loadSamples,
      updateSettings,
      resetSettings,
      addAlias,
      removeAlias,
      setAudience,
      setEvents,
      removeMention,
      setNameOverride,
      dismissRecord,
      resetCorrections,
      dismissNotice: () => setNotice(null),
    }),
    [
      addAlias,
      addFiles,
      aliases,
      analyzing,
      clearAll,
      clearAnalysis,
      corrections,
      dismissRecord,
      error,
      files,
      loadSamples,
      notice,
      progress,
      removeAlias,
      removeFile,
      removeMention,
      resetCorrections,
      resetSettings,
      result,
      runAnalysis,
      searchQuery,
      setAudience,
      setEvents,
      setFileKind,
      setNameOverride,
      settings,
      updateSettings,
      patchCorrections,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used inside <StoreProvider>');
  return context;
}

/* ------------------------------------------------------------------ *
 * Sample files (clearly labelled as examples, loaded on demand only)
 * ------------------------------------------------------------------ */

const SAMPLE_CHAT = `[9/1/26, 5:17:33 AM] Fardosa Kamal: I'll be in late
[9/1/26, 6:07:15 AM] Fardosa Kamal: Ikram will be late
[9/1/26, 6:09:02 AM] c\\wasac: Bus 2 is late today, grade 5 students are waiting
[9/2/26, 7:14:41 AM] Fardosa Kamal: T. Nafiisa is on the way
[9/3/26, 7:48:10 AM] c\\wasac: Grade 3 has no teacher yet, T. Nafiisa is coming
[9/5/26, 5:58:13 AM] Fardosa Kamal: Ikram is absent
[9/5/26, 6:00:19 AM] Fardosa Kamal: T nafiisa is sick
[9/6/26, 7:02:18 AM] c\\wasac: T. Axmed jaamc 5min late
[9/6/26, 6:40:05 AM] Fardosa Kamal: Ikram will not be in today, he has a family matter
[9/8/26, 5:59:00 AM] Fardosa Kamal: Ikram will be late
[9/9/26, 6:10:00 AM] Teacher Xuseen: I will be late today
[9/10/26, 8:02:00 AM] Fardosa Kamal: Teacher Huda Saeed is in hospital
[9/13/26, 6:44:00 AM] Fardosa Kamal: T. Maryan is sick
[9/14/26, 6:30:00 AM] Fardosa Kamal: Teacher Faysal has gone to a funeral
[9/15/26, 6:40:00 AM] Fardosa Kamal: T. Ikram left early today
`;

const SAMPLE_MATRIX = `Employee ID,Employee Name,Department,1-Sep-26,2-Sep-26,3-Sep-26,4-Sep-26,5-Sep-26,6-Sep-26,7-Sep-26,8-Sep-26,9-Sep-26,10-Sep-26,11-Sep-26,12-Sep-26,13-Sep-26,14-Sep-26,15-Sep-26
EMP001,Ikram Axmed,Teaching,"06:28,15:02","06:40,15:05","07:45,15:00",,ABSENT,"06:35,15:00","07:10,15:00","06:38,15:10","06:44,15:00","08:00,15:00",,"06:45,15:00","06:46,15:00","06:50,15:00","06:30,12:00"
EMP002,Nafiisa Xuseen,Teaching,"06:29,15:00",-,"07:52,15:00",,ABSENT,"06:31,15:00","06:33,15:00","06:37,15:00",6,"07:55,15:00",,"06:40,15:00","06:42,15:00","06:41,15:00","06:39,15:00"
EMP003,Ahmed Jaamac Ism,Teaching,"06:30,15:00","06:32,15:00","07:40,15:00",,"06:36,15:00","07:10,15:00","06:38,15:00","06:39,15:00",6.3B,"07:58,15:00",,"06:44,15:00","06:45,15:00","06:47,15:00","07:05,15:00"
EMP004,Abdiqadir Maxamed,Administration,"06:25,15:00","06:27,15:00","07:30,15:00",,"06:29,15:00","06:30,15:00","06:31,15:00","06:33,15:00","06:35,15:00","07:45,15:00",,"06:37,15:00","06:39,15:00","06:40,15:00",
EMP005,Nuha Cali,Teaching,"06:20,15:00","06:22,15:00","07:20,15:00",,ABSENT,"06:25,15:00","06:26,15:00","06:28,11:30","06:50,15:00","07:30,15:00",,"06:30,15:00","06:32,15:00","06:33,15:00","06:34,15:00"
EMP006,Xuseen Cabdi,Teaching,"06:35,12:10,15:02","06:35,12:10,15:02","07:15,15:00",,ABSENT,"06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02","06:52,15:00","07:44,15:00",,"06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02"
EMP007,Huda Saeed,Support,"06:35,12:10,15:02","06:35,12:10,15:02","07:55,15:00",,"06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02","06:58,15:00",ABSENT,,"06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02"
EMP008,Faysal Omar,Support,"06:35,12:10,15:02","06:35,12:10,15:02","07:50,15:00",,"06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02","06:35,12:10,15:02","07:59,15:00",,"06:35,12:10,15:02","06:35,12:10,15:02",ABSENT,"06:36,15:00"
EMP009,Fardosa Kamal,Administration,"06:28,15:00","06:15,15:00","07:10,15:00",,"06:10,15:00","06:12,15:00","06:14,15:00","06:16,15:00","06:18,15:00","07:20,15:00",,ABSENT,"06:20,15:00","06:21,15:00","06:22,15:00"
`;

const SAMPLE_LONG = `Employee,Date,Clock In,Clock Out,Total Hours,Status
Abdiqadir Maxamed,2026-09-14,06:40,15:05,8:25,Present
Abdiqadir Maxamed,2026-09-15,06:48,15:02,8:14,Late
Fardosa Kamal,2026-09-14,06:21,15:00,8:39,Present
Fardosa Kamal,2026-09-15,06:22,15:01,8:39,Present
Ikram Axmed,2026-09-15,06:30,12:00,5:30,Present
Ahmed Jaamac Ism,2026-09-15,07:05,15:00,7:55,Late
Nuha Cali,2026-09-14,n/a,,,Absent
`;
