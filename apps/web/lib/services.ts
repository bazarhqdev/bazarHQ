'use client';

import { createMockServices, createSupabaseServices, type PlatformServices, type MockPlatformServices } from '@bazarhq/shared';

let instance: PlatformServices | null = null;
const isProduction = process.env.NODE_ENV === 'production';

/** Single service-layer instance for the browser session. */
export function getServices(): PlatformServices {
  if (instance) return instance;

  const source = process.env.NEXT_PUBLIC_DATA_SOURCE ?? (isProduction ? '' : 'mock');

  if (source === 'supabase') {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

    if (!url || !anonKey) {
      throw new Error('BazarHQ is not configured: production Supabase URL and publishable key are required.');
    }

    instance = createSupabaseServices({ url, anonKey });
    return instance;
  }

  // Mock data is a development/demo adapter only. Never silently fall back to
  // it in Preview or Production when Supabase configuration is missing.
  if (source === 'mock' && !isProduction) {
    instance = createMockServices({ storageKey: 'bazarhq.web' });
    return instance;
  }

  throw new Error(
    isProduction
      ? 'BazarHQ production requires NEXT_PUBLIC_DATA_SOURCE=supabase. Mock data is disabled.'
      : 'Set NEXT_PUBLIC_DATA_SOURCE to "mock" or "supabase".',
  );
}

export function getMockDevTools(): MockPlatformServices['dev'] | null {
  const s = getServices() as Partial<MockPlatformServices>;
  return s.dev ?? null;
}

export const showDemoTools = !isProduction && (process.env.NEXT_PUBLIC_SHOW_DEMO_TOOLS ?? 'true') !== 'false';
