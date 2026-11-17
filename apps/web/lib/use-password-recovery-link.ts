'use client';

import { useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { parsePasswordRecoveryUrl } from '@/lib/password-recovery';

/**
 * Subscribe to URL changes without synchronously setting React state in an effect.
 * A blank server snapshot ensures the server and first hydration render agree;
 * the browser snapshot is read immediately after hydration.
 */
function subscribeToLocation(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener('hashchange', onChange);
  window.addEventListener('pageshow', onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('pageshow', onChange);
  };
}

function getBrowserLocation(): string {
  return window.location.href;
}

function getServerLocation(): string {
  return '';
}

export function usePasswordRecoveryLink(): {
  ready: boolean;
  credential: string | null;
  error: string | null;
  attempted: boolean;
} {
  // Subscribe to Next.js client-side query navigation as well as browser events.
  useSearchParams();
  const href = useSyncExternalStore(subscribeToLocation, getBrowserLocation, getServerLocation);

  if (!href) {
    return { ready: false, credential: null, error: null, attempted: false };
  }

  const url = new URL(href);
  const result = parsePasswordRecoveryUrl(url.search, url.hash);
  const attempted = /(?:token|code|type|recovery|error)/.test(url.search + url.hash);
  return { ready: true, ...result, attempted };
}
