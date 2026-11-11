/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'supabase';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PUSH_ENABLED?: string;
  readonly VITE_SHOW_DEMO_TOOLS?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
}
