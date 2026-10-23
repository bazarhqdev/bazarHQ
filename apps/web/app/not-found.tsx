'use client';

import Link from 'next/link';
import { buttonClass } from '@bazarhq/ui';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="text-2xl font-bold text-ink">Page not found</h1>
      <p className="max-w-sm text-sm text-ink-muted">The page you’re looking for doesn’t exist or has moved.</p>
      <Link href="/" className={buttonClass('primary', 'md', 'mt-2')}>
        Go to BazarHQ home
      </Link>
    </main>
  );
}
