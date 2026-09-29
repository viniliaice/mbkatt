import { CalendarOff, Clock, Link2, Plus, RefreshCw, RotateCcw, Save, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import * as React from 'react';
import { PageHeader } from '@/components/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Input, Select, Separator, Switch } from '@/components/ui';
import { WEEKDAY_NAMES } from '@/lib/dates';
import { DEFAULT_SETTINGS } from '@/lib/rules';
import { useStore } from '@/lib/store';
import type { DateOrder, Settings } from '@/lib/types';

const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Saturday … Friday, matching the school week

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

export function SettingsPage() {
  const { settings, updateSettings, resetSettings, result, runAnalysis, analyzing, aliases, addAlias, removeAlias } = useStore();
  const [aliasName, setAliasName] = React.useState('');
  const [aliasEmployee, setAliasEmployee] = React.useState('');
  const [holiday, setHoliday] = React.useState('');
  const [extraDay, setExtraDay] = React.useState('');
  const [savedNotice, setSavedNotice] = React.useState(false);

  const employees = result?.attendanceEmployees ?? [];

  const patch = (values: Partial<Settings>) => {
    updateSettings(values);
    setSavedNotice(false);
  };

  const toggleWeekend = (day: number, isWeekend: boolean) => {
    const next = isWeekend
      ? [...new Set([...settings.weekendDays, day])].sort((a, b) => a - b)
      : settings.weekendDays.filter((value) => value !== day);
    patch({ weekendDays: next });
  };

  const setCutoff = (day: number, value: string) => {
    const next = { ...settings.lateCutoffByWeekday };
    if (value.trim() === '') delete next[day];
    else next[day] = value;
    patch({ lateCutoffByWeekday: next });
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Every rule the audit uses is configured here — no rule is hidden in the code. Changing a rule only affects the next analysis run."
        actions={
          <>
            <Button variant="outline" onClick={resetSettings}>
              <RotateCcw /> Restore defaults
            </Button>
            <Button
              onClick={async () => {
                await runAnalysis();
                setSavedNotice(true);
              }}
              disabled={analyzing}
            >
              <RefreshCw className={analyzing ? 'animate-spin' : ''} />
              {analyzing ? 'Analyzing…' : 'Apply & re-run analysis'}
            </Button>
          </>
        }
      />

      {savedNotice ? (
        <Alert tone="success" title="Analysis re-run with the current settings" className="mb-4">
          <p>All pages and reports now use these rules.</p>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" /> Working days &amp; lateness rules
            </CardTitle>
            <CardDescription>
              Default for this school: Saturday–Wednesday are working days with a 06:45 cut-off; Thursday starts late
              (08:00); Friday is the weekend. A punch exactly at the cut-off is <span className="font-medium">not</span>{' '}
              late.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Weekend days"
              hint="Days excluded from the audit unless listed as extra working days below."
            >
              <div className="flex flex-wrap gap-3">
                {WEEK_ORDER.map((day) => (
                  <label key={day} className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={settings.weekendDays.includes(day)}
                      onChange={(event) => toggleWeekend(day, event.target.checked)}
                    />
                    {WEEKDAY_NAMES[day]}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Default late cut-off" hint="Applies to every working day without its own cut-off.">
              <Input
                type="time"
                value={settings.defaultLateCutoff}
                onChange={(event) => patch({ defaultLateCutoff: event.target.value })}
                className="w-40"
              />
            </Field>

            <Field
              label="Per-weekday cut-off overrides"
              hint="Leave empty to use the default cut-off. Thursday is pre-filled with 08:00."
            >
              <div className="space-y-2">
                {WEEK_ORDER.map((day) => (
                  <div key={day} className="flex items-center gap-3">
                    <span className="w-24 text-sm">{WEEKDAY_NAMES[day]}</span>
                    <Input
                      type="time"
                      value={settings.lateCutoffByWeekday[day] ?? ''}
                      onChange={(event) => setCutoff(day, event.target.value)}
                      className="w-40"
                    />
                    {settings.lateCutoffByWeekday[day] ? (
                      <Badge tone="primary">override</Badge>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">
                        default ({settings.defaultLateCutoff})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Field>

            <Separator />

            <Switch
              label="Flag early departures"
              description={`A last punch before ${settings.earlyLeaveThreshold} is reported as leaving early.`}
              checked={settings.earlyLeaveEnabled}
              onCheckedChange={(value) => patch({ earlyLeaveEnabled: value })}
            />
            <Field label="Early-departure threshold" hint="Only used when early departures are enabled.">
              <Input
                type="time"
                value={settings.earlyLeaveThreshold}
                onChange={(event) => patch({ earlyLeaveThreshold: event.target.value })}
                className="w-40"
                disabled={!settings.earlyLeaveEnabled}
              />
            </Field>

            <Field
              label="Minimum valid punches per day"
              hint="A day needs at least this many readable punches to count as attended. Default 1."
            >
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.minValidPunches}
                onChange={(event) => patch({ minValidPunches: Number(event.target.value) || 1 })}
                className="w-24"
              />
            </Field>

            <Field
              label="Plausible punch window"
              hint="Values outside this window are ignored as machine noise (they are listed as parsing warnings, never as absences)."
            >
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={settings.earliestPlausiblePunch}
                  onChange={(event) => patch({ earliestPlausiblePunch: event.target.value })}
                  className="w-32"
                />
                <span className="text-sm text-[var(--muted-foreground)]">to</span>
                <Input
                  type="time"
                  value={settings.latestPlausiblePunch}
                  onChange={(event) => patch({ latestPlausiblePunch: event.target.value })}
                  className="w-32"
                />
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarOff className="size-4" /> Holidays &amp; extra working days
            </CardTitle>
            <CardDescription>
              Dates listed as holidays are excluded entirely; extra working days are audited even if they fall on a
              weekend.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Holiday / closure dates">
              <div className="flex gap-2">
                <Input type="date" value={holiday} onChange={(event) => setHoliday(event.target.value)} className="w-44" />
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!holiday) return;
                    patch({ holidayDates: [...new Set([...settings.holidayDates, holiday])].sort() });
                    setHoliday('');
                  }}
                >
                  <Plus /> Add
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {settings.holidayDates.length === 0 ? (
                  <span className="text-xs text-[var(--muted-foreground)]">No holidays configured.</span>
                ) : (
                  settings.holidayDates.map((date) => (
                    <span key={date} className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs">
                      {date}
                      <button
                        type="button"
                        aria-label={`Remove ${date}`}
                        onClick={() => patch({ holidayDates: settings.holidayDates.filter((value) => value !== date) })}
                        className="text-red-600 hover:underline dark:text-red-400"
                      >
                        remove
                      </button>
                    </span>
                  ))
                )}
              </div>
            </Field>

            <Field label="Extra working days">
              <div className="flex gap-2">
                <Input type="date" value={extraDay} onChange={(event) => setExtraDay(event.target.value)} className="w-44" />
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!extraDay) return;
                    patch({ extraWorkingDates: [...new Set([...settings.extraWorkingDates, extraDay])].sort() });
                    setExtraDay('');
                  }}
                >
                  <Plus /> Add
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {settings.extraWorkingDates.length === 0 ? (
                  <span className="text-xs text-[var(--muted-foreground)]">None configured.</span>
                ) : (
                  settings.extraWorkingDates.map((date) => (
                    <span key={date} className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs">
                      {date}
                      <button
                        type="button"
                        aria-label={`Remove ${date}`}
                        onClick={() =>
                          patch({ extraWorkingDates: settings.extraWorkingDates.filter((value) => value !== date) })
                        }
                        className="text-red-600 hover:underline dark:text-red-400"
                      >
                        remove
                      </button>
                    </span>
                  ))
                )}
              </div>
            </Field>

            <Switch
              label="Treat “no valid punch” as absence"
              description="When off, a day with no readable punch is only reported (as a potential issue) and never called absent — useful while the export is incomplete."
              checked={settings.treatNoPunchAsAbsent}
              onCheckedChange={(value) => patch({ treatNoPunchAsAbsent: value })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="size-4" /> Parsing &amp; name matching
            </CardTitle>
            <CardDescription>
              How dates are read, how strictly names must match, and how far apart a message and a punch may be.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="WhatsApp date order">
                <Select
                  value={settings.whatsappDateOrder}
                  onChange={(event) => patch({ whatsappDateOrder: event.target.value as DateOrder })}
                >
                  <option value="auto">Detect automatically</option>
                  <option value="MDY">Month/Day/Year (US)</option>
                  <option value="DMY">Day/Month/Year</option>
                  <option value="YMD">Year-Month-Day</option>
                </Select>
              </Field>
              <Field label="Attendance date order">
                <Select
                  value={settings.attendanceDateOrder}
                  onChange={(event) => patch({ attendanceDateOrder: event.target.value as DateOrder })}
                >
                  <option value="auto">Detect automatically</option>
                  <option value="MDY">Month/Day/Year (US)</option>
                  <option value="DMY">Day/Month/Year</option>
                  <option value="YMD">Year-Month-Day</option>
                </Select>
              </Field>
            </div>
            <Field label="Fallback year" hint="Used when a date has no year (e.g. “9/1” in a column header).">
              <Input
                type="number"
                min={2000}
                max={2100}
                value={settings.fallbackYear ?? ''}
                placeholder="not set"
                onChange={(event) =>
                  patch({ fallbackYear: event.target.value === '' ? null : Number(event.target.value) })
                }
                className="w-32"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Matched threshold"
                hint="Confidence (%) at or above which a name is treated as matched."
              >
                <Input
                  type="number"
                  min={50}
                  max={100}
                  value={settings.matchedThreshold}
                  onChange={(event) => patch({ matchedThreshold: Number(event.target.value) || 85 })}
                />
              </Field>
              <Field
                label="Possible-match threshold"
                hint="Below the matched threshold but at or above this, a match is only proposed for review."
              >
                <Input
                  type="number"
                  min={20}
                  max={99}
                  value={settings.possibleThreshold}
                  onChange={(event) => patch({ possibleThreshold: Number(event.target.value) || 62 })}
                />
              </Field>
            </div>

            <Switch
              label="Consider spelling variants (Axmed ↔ Ahmed)"
              description="Uses transliteration-aware comparison for Somali/Arabic name spellings. Disambiguating surnames still has to agree."
              checked={settings.useTransliterationVariants}
              onCheckedChange={(value) => patch({ useTransliterationVariants: value })}
            />

            <Field
              label="Notification tolerance (days)"
              hint="How far before/after an attendance day a message may be and still be linked to it (e.g. “I'll be late tomorrow”)."
            >
              <Input
                type="number"
                min={0}
                max={7}
                value={settings.notificationDateToleranceDays}
                onChange={(event) => patch({ notificationDateToleranceDays: Number(event.target.value) || 0 })}
                className="w-24"
              />
            </Field>

            <Switch
              label="Include uncertain messages in the audit"
              description="When off, messages that could not be classified as staff or student stay visible in the WhatsApp report but are not cross-referenced."
              checked={settings.includeUncertainMessagesInAudit}
              onCheckedChange={(value) => patch({ includeUncertainMessagesInAudit: value })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4" /> Name aliases
            </CardTitle>
            <CardDescription>
              A manual alias always wins over automatic matching. Add one for every nickname the chat uses (for example
              “Fardosa” → EMP001).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name used in WhatsApp">
                <Input
                  value={aliasName}
                  onChange={(event) => setAliasName(event.target.value)}
                  placeholder="e.g. Fardosa"
                />
              </Field>
              <Field label="Employee">
                <Select value={aliasEmployee} onChange={(event) => setAliasEmployee(event.target.value)}>
                  <option value="">Select an employee…</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                      {employee.employeeCode ? ` (${employee.employeeCode})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button
              variant="outline"
              disabled={!aliasName.trim() || !aliasEmployee}
              onClick={() => {
                const employee = employees.find((entry) => entry.id === aliasEmployee);
                if (!employee) return;
                addAlias({ whatsappName: aliasName.trim(), employeeId: employee.id, employeeName: employee.name });
                setAliasName('');
                setAliasEmployee('');
              }}
            >
              <Plus /> Add alias
            </Button>
            {employees.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                Aliases can be added once the attendance files are uploaded and analysed.
              </p>
            ) : null}

            <Separator />

            {aliases.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No aliases yet. Approved matches from the Review Center can also be saved here.
              </p>
            ) : (
              <ul className="space-y-2">
                {aliases.map((alias) => (
                  <li
                    key={`${alias.whatsappName}-${alias.employeeId}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-2 text-sm"
                  >
                    <span>
                      “{alias.whatsappName}” → {alias.employeeName}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => removeAlias(alias.whatsappName)}>
                      <Trash2 /> Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" /> Privacy &amp; branding
            </CardTitle>
            <CardDescription>How the app stores data and what appears on exported reports.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="School name" hint="Shown in the app header, on reports and in PDF headers.">
              <Input
                value={settings.schoolName}
                onChange={(event) => patch({ schoolName: event.target.value })}
                placeholder="MBK School"
                className="w-full max-w-sm"
              />
            </Field>
            <Switch
              label="Keep uploads in this browser"
              description="Stores the uploaded files and your corrections in this browser's local storage so you can continue later. Nothing leaves this device. Turn it off to keep everything in memory only."
              checked={settings.persistToBrowser}
              onCheckedChange={(value) => patch({ persistToBrowser: value })}
            />
            <Alert tone="info" title="Current rule summary">
              <ul className="list-disc space-y-0.5 pl-5">
                <li>
                  Working days: {WEEK_ORDER.filter((day) => !settings.weekendDays.includes(day)).map((day) => WEEKDAY_NAMES[day]).join(', ')}
                  {settings.weekendDays.length > 0
                    ? ` · weekend: ${settings.weekendDays.map((day) => WEEKDAY_NAMES[day]).join(', ')}`
                    : ''}
                </li>
                <li>
                  Late after {settings.defaultLateCutoff} by default
                  {Object.entries(settings.lateCutoffByWeekday).length > 0
                    ? `, ${Object.entries(settings.lateCutoffByWeekday)
                        .map(([day, value]) => `${WEEKDAY_NAMES[Number(day)]} after ${value}`)
                        .join(', ')}`
                    : ''}
                  . A punch exactly at the cut-off counts as on time.
                </li>
                <li>
                  Early departures:{' '}
                  {settings.earlyLeaveEnabled ? `last punch before ${settings.earlyLeaveThreshold}` : 'disabled'}
                </li>
                <li>
                  Minimum punches per day: {settings.minValidPunches}
                  {settings.treatNoPunchAsAbsent ? '' : ' · “no punch” is reported but never treated as absence'}
                </li>
                <li>
                  Matching: matched ≥ {settings.matchedThreshold}%, possible ≥ {settings.possibleThreshold}%
                  {settings.useTransliterationVariants ? ', spelling variants on' : ', spelling variants off'}
                </li>
                <li>Defaults from the app at load: late {DEFAULT_SETTINGS.defaultLateCutoff}, Thursday {DEFAULT_SETTINGS.lateCutoffByWeekday[4]}, weekend Friday.</li>
              </ul>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={resetSettings}>
                <RotateCcw /> Restore default rules
              </Button>
              <Button variant="ghost" onClick={() => setSavedNotice(false)}>
                <Save /> Settings are saved automatically
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
