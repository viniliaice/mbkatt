import { Database, Eye, FileWarning, Lock, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator, Switch } from '@/components/ui';
import { FILE_KIND_LABELS } from '@/lib/detect';
import { useStore } from '@/lib/store';

export function PrivacyPage() {
  const { files, settings, updateSettings, removeFile, clearAll, clearAnalysis, result } = useStore();

  return (
    <>
      <PageHeader
        title="Privacy & data handling"
        description="This application was built so that staff attendance data never has to leave the school."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="size-4" /> How your data is handled
            </CardTitle>
            <CardDescription>The short version: everything happens inside this browser tab.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="list-disc space-y-2 pl-5 text-[var(--muted-foreground)]">
              <li>
                <span className="font-medium text-[var(--foreground)]">No server transmission.</span> Files are read with
                the browser's File API and parsed in JavaScript on this device. There is no upload endpoint and no
                analytics or tracking script of any kind.
              </li>
              <li>
                <span className="font-medium text-[var(--foreground)]">No third-party services.</span> The WhatsApp
                parser, attendance parser, name matcher and rules engine are all part of this application. Charts and
                PDFs are produced locally.
              </li>
              <li>
                <span className="font-medium text-[var(--foreground)]">Session-based by default.</span> If “keep uploads
                in this browser” is off, the files live in memory only and disappear when the tab is closed.
              </li>
              <li>
                <span className="font-medium text-[var(--foreground)]">Local storage is your choice.</span> When enabled,
                the uploaded files, your settings, aliases and corrections are stored in this browser's local storage
                under the key <code className="rounded bg-[var(--muted)] px-1">mbk-attendance-audit-v1</code> — on this
                device only. Anybody with access to this browser profile could read it, so use the delete buttons on a
                shared computer.
              </li>
              <li>
                <span className="font-medium text-[var(--foreground)]">Exports are confidential.</span> Every PDF carries
                a confidentiality footer; treat exported files as you treat any staff record.
              </li>
            </ul>
            <Separator />
            <Switch
              label="Keep uploads and decisions in this browser"
              description="Turn this off to keep everything in memory for the current session only."
              checked={settings.persistToBrowser}
              onCheckedChange={(value) => updateSettings({ persistToBrowser: value })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" /> Stored files
            </CardTitle>
            <CardDescription>
              {files.length === 0
                ? 'No files are currently loaded.'
                : `${files.length} file(s) loaded in this session.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {files.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                Nothing stored. Use the{' '}
                <Link to="/upload" className="underline">
                  Upload Files
                </Link>{' '}
                page to add the WhatsApp export and the attendance files.
              </p>
            ) : (
              <ul className="space-y-2">
                {files.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-3">
                    <div>
                      <p className="text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {FILE_KIND_LABELS[file.kindOverride ?? file.kind]} · {(file.size / 1024).toFixed(1)} KB · added{' '}
                        {new Date(file.uploadedAt).toLocaleString()}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeFile(file.id)}>
                      <Trash2 /> Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={clearAll} disabled={files.length === 0}>
                <Trash2 /> Delete all uploaded files
              </Button>
              <Button variant="outline" onClick={clearAnalysis} disabled={!result}>
                <FileWarning /> Clear the analysis
              </Button>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              “Delete all uploaded files” removes the file contents and the analysis from memory and from local storage.
              “Clear the analysis” keeps the files so you can re-run with different rules.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-4" /> Transparency rules used by the engine
            </CardTitle>
            <CardDescription>These are correctness guarantees, not settings — they cannot be switched off.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--muted-foreground)]">
              <li>A notification is never invented: only a message in the uploaded export can mark someone notified.</li>
              <li>
                A similar name alone never marks a person as notified — the match has to be approved or score above the
                configured threshold, and possible matches are shown separately.
              </li>
              <li>
                Nobody is marked absent merely because a punch is missing when the file itself looks incomplete —
                parsing problems are reported as problems.
              </li>
              <li>
                Messages are never deleted: student and uncertain messages stay visible in the WhatsApp report, and
                uncertain ones can be corrected and will be kept.
              </li>
              <li>
                Every calculated status can be opened with “View original evidence”, showing the exact source message
                and attendance cell.
              </li>
              <li>
                Raw data is never hidden: the original wording, the exact punch text and the source file/line are always
                available in the tables and exports.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" /> Recommended practices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[var(--muted-foreground)]">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Run the audit on the school's own computer rather than a shared or public device, and delete the files
                when you are finished.
              </li>
              <li>
                Keep the app available offline if possible — because it makes no network requests, it works without an
                internet connection once loaded.
              </li>
              <li>
                Share exported reports only with the people who need them (typically the head teacher and the staff
                files), and store them in the school's protected area.
              </li>
              <li>
                Notify staff that attendance data and the WhatsApp group are used for this audit, as required by your
                local policy.
              </li>
            </ul>
            <Alert tone="info" title="What this app cannot know">
              <ul className="list-disc space-y-1 pl-5">
                <li>Notifications that were made in person, by phone or in another group.</li>
                <li>Whether a missing punch was approved leave, a machine fault or an absence.</li>
                <li>Whether a message refers to a person with the same first name but a different family name.</li>
              </ul>
            </Alert>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={settings.persistToBrowser ? 'warning' : 'success'}>
                {settings.persistToBrowser ? 'Local persistence: on' : 'Local persistence: off (session only)'}
              </Badge>
              <Link
                to="/upload"
                className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-medium hover:bg-[var(--accent)]"
              >
                <Upload className="size-4" /> Manage uploads
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
