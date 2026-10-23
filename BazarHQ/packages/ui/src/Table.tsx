'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

/** Responsive table wrapper; tables scroll inside their card, never the page. */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('w-full overflow-x-auto', className)}>{children}</div>;
}

export const th = 'px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle whitespace-nowrap';
export const td = 'px-4 py-3 text-sm text-ink align-middle';
