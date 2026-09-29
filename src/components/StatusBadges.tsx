import { AlertTriangle, Check, CircleHelp, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ADMIN_STATUS_LABELS, ADMIN_STATUS_TONES } from '@/lib/admin';
import { ADMIN_EXCUSE_LABELS } from '@/lib/types';
import {
  BIOMETRIC_STATUS_SHORT,
  BIOMETRIC_STATUS_TONE,
  EVENT_LABELS,
  matchStatusMeta,
  NOTIFICATION_LABELS,
  NOTIFICATION_TONE,
} from '@/lib/statuses';
import type {
  AdminExcuseStatus,
  AdminStatus,
  Audience,
  BiometricEvaluation,
  MatchTier,
  NameMatch,
  NotificationStatus,
  StaffEventType,
  WhatsAppEventRow,
} from '@/lib/types';

const toneToVariant = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'neutral',
} as const;

/** Icons + text so that meaning never depends on colour alone. */
export function MatchStatusBadge({
  status,
  short = true,
  className,
}: {
  status: WhatsAppEventRow['matchStatus'];
  short?: boolean;
  className?: string;
}) {
  const meta = matchStatusMeta(status);
  const Icon = meta.isConflict
    ? AlertTriangle
    : meta.isUnnotified
      ? XCircle
      : meta.group === 'ok'
        ? Check
        : meta.group === 'review'
          ? CircleHelp
          : ShieldAlert;
  return (
    <Badge tone={toneToVariant[meta.tone]} className={cn('whitespace-nowrap', className)} title={meta.label}>
      <Icon aria-hidden className="size-3.5" />
      {short ? meta.shortLabel : meta.label}
      {meta.index !== null ? <span className="opacity-60">#{meta.index}</span> : null}
    </Badge>
  );
}

export function BiometricBadge({
  evaluation,
  className,
}: {
  evaluation: BiometricEvaluation;
  className?: string;
}) {
  return (
    <Badge
      tone={toneToVariant[BIOMETRIC_STATUS_TONE[evaluation.status]]}
      className={cn('whitespace-nowrap', className)}
      title={evaluation.statusLabel}
    >
      {BIOMETRIC_STATUS_SHORT[evaluation.status]}
    </Badge>
  );
}

export function NotificationBadge({
  status,
  className,
}: {
  status: NotificationStatus;
  className?: string;
}) {
  return (
    <Badge tone={toneToVariant[NOTIFICATION_TONE[status]]} className={className}>
      {NOTIFICATION_LABELS[status]}
    </Badge>
  );
}

export function AudienceBadge({ audience, className }: { audience: Audience; className?: string }) {
  const tone = audience === 'staff' ? 'primary' : audience === 'student' ? 'info' : 'warning';
  return (
    <Badge tone={tone} className={className}>
      {audience === 'staff' ? 'Staff' : audience === 'student' ? 'Student' : 'Uncertain'}
    </Badge>
  );
}

export function EventBadge({ event, className }: { event: StaffEventType; className?: string }) {
  const tone =
    event === 'LATE'
      ? 'warning'
      : event === 'ABSENT'
        ? 'danger'
        : event === 'SICK' || event === 'HOSPITAL'
          ? 'info'
          : event === 'UNKNOWN'
            ? 'neutral'
            : 'outline';
  return (
    <Badge tone={tone} className={cn('whitespace-nowrap', className)}>
      {EVENT_LABELS[event]}
    </Badge>
  );
}

export function TierBadge({ tier, className }: { tier: MatchTier; className?: string }) {
  const map: Record<MatchTier, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' }> = {
    matched: { label: 'Matched', tone: 'success' },
    manual: { label: 'Matched (manual)', tone: 'primary' },
    possible: { label: 'Possible match', tone: 'warning' },
    unmatched: { label: 'Unmatched', tone: 'danger' },
    rejected: { label: 'Rejected', tone: 'neutral' },
  };
  const entry = map[tier];
  return (
    <Badge tone={entry.tone} className={className}>
      {entry.label}
    </Badge>
  );
}

export function ConfidenceBadge({
  score,
  tier,
}: {
  score: number;
  tier?: NameMatch['tier'];
}) {
  const tone: 'success' | 'warning' | 'danger' = score >= 85 ? 'success' : score >= 62 ? 'warning' : 'danger';
  return (
    <Badge tone={tone} title={`${score}% confidence${tier ? ` (${tier})` : ''}`}>
      {score}%
    </Badge>
  );
}

export function ConfidenceLabel({ value }: { value: 'high' | 'medium' | 'low' }) {
  const tone = value === 'high' ? 'success' : value === 'medium' ? 'warning' : 'danger';
  return <Badge tone={tone}>{value === 'high' ? 'High' : value === 'medium' ? 'Medium' : 'Low'}</Badge>;
}

/* ------------------------------------------------------------------ *
 * Administrative badges (spec 29–34)
 * ------------------------------------------------------------------ */

export function AdminStatusBadge({
  status,
  label,
  tone,
  reason,
  className,
}: {
  status?: AdminStatus;
  label?: string;
  tone?: 'success' | 'info' | 'warning' | 'danger';
  reason?: string;
  className?: string;
}) {
  const resolvedTone = tone ?? (status ? ADMIN_STATUS_TONES[status] : 'neutral');
  const text = label ?? (status ? ADMIN_STATUS_LABELS[status] : '—');
  return (
    <Badge tone={resolvedTone} className={className} title={reason}>
      {text}
    </Badge>
  );
}

export function ExcuseStatusBadge({ status }: { status: AdminExcuseStatus }) {
  const tone: Record<AdminExcuseStatus, 'success' | 'danger' | 'warning' | 'info'> = {
    excused: 'success',
    unexcused: 'danger',
    pending: 'warning',
    leave: 'info',
  };
  return <Badge tone={tone[status]}>{ADMIN_EXCUSE_LABELS[status]}</Badge>;
}

export function LateMinutesBadge({ minutes, estimated }: { minutes: number; estimated?: boolean }) {
  if (minutes <= 0) return <span className="text-[var(--muted-foreground)]">—</span>;
  return (
    <Badge tone={estimated ? 'warning' : 'danger'}>
      {minutes} min{estimated ? ' (estimated)' : ''}
    </Badge>
  );
}
