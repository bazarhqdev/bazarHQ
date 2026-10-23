'use client';

import { cn } from './cn';

/** BazarHQ mark: an original storefront glyph (not a third-party logo). */
export function BazarMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden>
      <rect width="40" height="40" rx="11" fill="#059669" />
      <path d="M10 15.5 12.2 10h15.6l2.2 5.5" fill="#fff" />
      <path d="M10 15.5a3.33 3.33 0 0 0 6.67 0 3.33 3.33 0 0 0 6.66 0 3.33 3.33 0 0 0 6.67 0Z" fill="#fff" />
      <path d="M12 20.5V29a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="17.5" y="23.5" width="5" height="6.5" rx="0.8" fill="#fff" />
    </svg>
  );
}

export function BazarLogo({ className, tone = 'dark', subtitle }: { className?: string; tone?: 'dark' | 'light'; subtitle?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BazarMark />
      <span className="leading-tight">
        <span className={cn('block text-lg font-extrabold tracking-tight', tone === 'dark' ? 'text-navy-900' : 'text-white')}>
          Bazar<span className="text-brand-500">HQ</span>
        </span>
        {subtitle && <span className={cn('block text-[11px] font-semibold', tone === 'dark' ? 'text-ink-muted' : 'text-white/70')}>{subtitle}</span>}
      </span>
    </span>
  );
}
