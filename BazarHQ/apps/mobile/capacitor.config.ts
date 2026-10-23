import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the Vite SPA build (dist/) — never the Next.js SSR app.
 * No secrets live here: the APK only ever receives the public Supabase anon
 * key via VITE_ env vars at build time (MOB-03 / MOB-11).
 */
const config: CapacitorConfig = {
  appId: 'com.bazarhq.app',
  appName: 'BazarHQ',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0b1f3a',
      showSpinner: false,
    },
  },
};

export default config;
