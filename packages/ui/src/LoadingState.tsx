'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, RefreshCw, XCircle } from 'lucide-react';
import { cn } from './cn';
import { Button } from './Button';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const alertIcon = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };
const alertClass: Record<AlertTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-brand-200 bg-brand-50 text-brand-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
};

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = alertIcon[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', alertClass[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(Boolean(title) && 'mt-0.5', 'leading-relaxed opacity-95')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-shimmer rounded-md bg-slate-200/80', className)} aria-hidden />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3 p-5', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-ink-muted', className)}>
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">{icon}</div>}
      <h3 className="text-[15px] font-bold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <h3 className="text-[15px] font-bold text-ink">We couldn’t load this</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" icon={<RefreshCw className="size-4" aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={className}>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label={label}
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
