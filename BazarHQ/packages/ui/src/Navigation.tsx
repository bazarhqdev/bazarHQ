'use client';

import { cn } from './cn';

/** Segmented tabs with optional counts — used for status filters. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]', className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors',
              active ? 'bg-navy-900 text-white' : 'text-ink-muted hover:bg-white hover:text-ink',
            )}
          >
            {it.label}
            {it.count !== undefined && (
              <span className={cn('rounded-full px-1.5 text-[11px] tabular', active ? 'bg-white/20' : 'bg-slate-200 text-slate-700')}>{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s} className="flex flex-1 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
                state === 'done' && 'bg-brand-600 text-white',
                state === 'current' && 'bg-navy-900 text-white',
                state === 'todo' && 'bg-slate-200 text-slate-600',
              )}
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className={cn('hidden text-[13px] font-semibold sm:inline', state === 'todo' ? 'text-ink-subtle' : 'text-ink')}>{s}</span>
            {i < steps.length - 1 && <span className={cn('h-px flex-1', i < current ? 'bg-brand-600' : 'bg-line-strong')} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
