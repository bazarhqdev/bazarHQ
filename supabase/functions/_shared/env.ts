/**
 * Server-only configuration. Everything here is read inside the Edge runtime;
 * none of it is ever sent to a client. SUPABASE_URL, SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY are injected by the Supabase platform; the rest are
 * set with `supabase secrets set` (see docs/database/BACKEND_SETUP.md).
 */
function read(name: string): string {
  return (Deno.env.get(name) ?? '').trim();
}

function required(name: string): string {
  const value = read(name);
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

export type PaymentProviderMode = 'live' | 'simulator';

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL');
  },
  get anonKey() {
    return required('SUPABASE_ANON_KEY');
  },
  /** Service-role key: Edge runtime only. Never logged, never returned. */
  get serviceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get appEnv(): 'production' | 'staging' | 'development' {
    const v = read('APP_ENV');
    return v === 'production' || v === 'staging' ? v : 'development';
  },
  /** Comma-separated browser origins allowed by CORS (web app + Capacitor WebView). */
  get allowedOrigins(): string[] {
    return read('ALLOWED_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  },
  /** Public web app base URL, used for payment return redirects. */
  get publicAppUrl(): string {
    return (read('PUBLIC_APP_URL') || 'http://localhost:3000').replace(/\/+$/, '');
  },
  /** Public URL of this project's functions endpoint, used for gateway callbacks. */
  get functionsUrl(): string {
    return (read('FUNCTIONS_PUBLIC_URL') || `${required('SUPABASE_URL')}/functions/v1`).replace(/\/+$/, '');
  },
  /** Shared secret for scheduler-only functions (send-notification). */
  get cronSecret(): string {
    return read('CRON_SECRET');
  },
  /**
   * `simulator` makes wallet/SSLCommerz verification deterministic for local
   * development and automated tests. It is refused when APP_ENV=production.
   */
  get paymentProviderMode(): PaymentProviderMode {
    const mode = read('PAYMENT_PROVIDER_MODE') === 'simulator' ? 'simulator' : 'live';
    if (mode === 'simulator' && read('APP_ENV') === 'production') {
      throw new Error('PAYMENT_PROVIDER_MODE=simulator is not allowed in production');
    }
    return mode;
  },
  /** HMAC secret for simulator payment sessions (development only). */
  get simulatorSecret(): string {
    return read('PAYMENT_SIMULATOR_SECRET') || 'local-simulator-secret-not-for-production';
  },
  /** Which request header carries the client IP, and which entry to trust. */
  get clientIpHeader(): string {
    return (read('CLIENT_IP_HEADER') || 'x-forwarded-for').toLowerCase();
  },
  get clientIpPosition(): 'first' | 'last' {
    return read('CLIENT_IP_POSITION') === 'last' ? 'last' : 'first';
  },
  get fcm(): { projectId: string; clientEmail: string; privateKey: string } | null {
    const projectId = read('FCM_PROJECT_ID');
    const clientEmail = read('FCM_CLIENT_EMAIL');
    const privateKey = read('FCM_PRIVATE_KEY').replace(/\\n/g, '\n');
    return projectId && clientEmail && privateKey ? { projectId, clientEmail, privateKey } : null;
  },
};
