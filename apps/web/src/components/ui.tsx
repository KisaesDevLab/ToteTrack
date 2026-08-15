import type { AiStatus, BoxStatus } from '@totetrack/shared';
import type { ReactNode } from 'react';

export function LabelChip({ label, size = 'md' }: { label: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz =
    size === 'lg'
      ? 'text-xl px-3 py-1'
      : size === 'sm'
        ? 'text-xs px-1.5 py-0.5'
        : 'text-sm px-2 py-0.5';
  return <span className={`label-chip ${sz}`}>{label}</span>;
}

export function StatusPill({ status }: { status: BoxStatus }) {
  return status === 'sealed' ? (
    <span className="pill bg-ink text-paper">
      <LockIcon className="h-3 w-3" /> Sealed
    </span>
  ) : (
    <span className="pill bg-paper-sunk text-ink-soft">Open</span>
  );
}

export function AiPill({ status, error }: { status: AiStatus; error?: string | null }) {
  if (status === 'none') return null;
  if (status === 'pending')
    return (
      <span className="pill bg-accent-soft text-accent-deep">
        <Spinner className="h-3 w-3" /> AI analyzing
      </span>
    );
  if (status === 'error')
    return (
      <span className="pill bg-red-50 text-bad" title={error ?? undefined}>
        AI failed
      </span>
    );
  return (
    <span className="pill bg-green-50 text-good" title={error ?? undefined}>
      AI {error ? '(partial)' : 'done'}
    </span>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function LockIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      {icon ?? <BoxIcon className="mb-3 h-10 w-10 text-ink-mute" />}
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-mute">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function BoxIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8l9-4 9 4-9 4-9-4z" />
      <path d="M3 8v8l9 4 9-4V8" />
      <path d="M12 12v8" />
    </svg>
  );
}

export function PageHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0 flex items-start gap-2">
        {back}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-ink-mute">{subtitle}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-bad">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-mute">{hint}</span>
      ) : null}
    </label>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card flex items-center gap-3 p-3">
          <div className="skeleton h-14 w-14 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-2/5" />
            <div className="skeleton h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorNote({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="card flex items-center justify-between gap-3 border-bad/30 bg-red-50 px-4 py-3 text-sm text-bad">
      <span>{message}</span>
      {retry && (
        <button className="btn-sm btn-secondary" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Confirm',
  className = 'btn-danger btn-sm',
  disabled,
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={() => {
        if (window.confirm(typeof children === 'string' ? `${children}?` : confirmLabel))
          onConfirm();
      }}
    >
      {children}
    </button>
  );
}
