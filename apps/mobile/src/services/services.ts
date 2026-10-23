import { secureTokenStore } from './native';
import { createMockServices, createSupabaseServices, type PlatformServices, type MockPlatformServices } from '@bazarhq/shared';

const source = import.meta.env.VITE_DATA_SOURCE ?? 'mock';

export const services: PlatformServices =
  source === 'supabase'
    ? createSupabaseServices({
        url: import.meta.env.VITE_SUPABASE_URL ?? '',
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        authStorage: secureTokenStore,
      })
    : createMockServices({ storageKey: 'bazarhq.mobile' });

export const devTools: MockPlatformServices['dev'] | null = (services as Partial<MockPlatformServices>).dev ?? null;
export const showDemoTools = (import.meta.env.VITE_SHOW_DEMO_TOOLS ?? 'true') !== 'false';
