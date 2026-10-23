'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

export function Card({
  className,
  children,
  as: Tag = 'section',
  ...rest
}: {
  className?: string;
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
  'aria-labelledby'?: string;
  id?: string;
}) {
  return (
    <Tag className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-bold text-ink">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return src ? (
    <img src={src} alt="" width={size} height={size} className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800', className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
    >
      {letters}
    </span>
  );
}

export function KeyValue({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}
