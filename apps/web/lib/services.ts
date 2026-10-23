'use client';

import { createMockServices, createSupabaseServices, type PlatformServices, type MockPlatformServices } from '@bazarhq/shared';

let instance: PlatformServices | null = null;

/** Single service-layer instance for the browser session. */
export function getServices(): PlatformServices {
  if (instance) return instance;
  const source = process.env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock';
  if (source === 'supabase') {
    instance = createSupabaseServices({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    });
  } else {
    instance = createMockServices({ storageKey: 'bazarhq.web' });
  }
  return instance;
}

export function getMockDevTools(): MockPlatformServices['dev'] | null {
  const s = getServices() as Partial<MockPlatformServices>;
  return s.dev ?? null;
}

export const showDemoTools = (process.env.NEXT_PUBLIC_SHOW_DEMO_TOOLS ?? 'true') !== 'false';
