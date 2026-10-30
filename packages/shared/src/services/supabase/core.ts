
/**
 * Supabase adapter core: client creation, error mapping, Edge Function calls,
 * signed URLs and uploads.
 *
 * Security model (brief + SRS §7.5):
 *  - Only the public anon/publishable key is ever used here. The service-role
 *    key lives in Edge Functions and never in browser, mobile or APK code.
 *  - Reads go straight to PostgREST and are filtered by RLS.
 *  - Writes that move money, stock or order/payment state go through Edge
 *    Functions (which verify the JWT and call trusted SQL functions) or through
 *    SECURITY DEFINER RPCs that use auth.uid(). There is no direct table write
 *    for those.
 */
import {
  createClient,
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  ServiceError,
  type ServiceErrorCode,
  type UploadFile,
} from '../contracts';
import {
  validateAttachmentFile,
  validateImageFile,
} from '../../validation/files';

export interface SupabaseClientConfig {
  url: string;
  /** Public anon/publishable key ONLY. Never the service-role key (§5.2, MOB-11). */
  anonKey: string;
  /**
   * Where supabase-js keeps the session. Android passes the Keystore-backed
   * vault so tokens never sit in localStorage/Preferences (AUTH-05, MOB-05).
   */
  authStorage?: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  /** Where OAuth and email links return to. Defaults to the current origin. */
  redirectTo?: string;
  /** Mobile: open OAuth in the system browser instead of the WebView. */
  openExternal?: (url: string) => Promise<void>;
  /** Mobile OAuth callback deep link; must be in Auth's redirect allow list. */
  oauthCallbackUrl?: string;
}

/** Rejects keys whose JWT payload says role=service_role. */
export function assertPublicAnonKey(key: string): void {
  const parts = key.split('.');
  if (parts.length !== 3) return;

  try {
    const json =
      typeof atob === 'function'
        ? atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))
        : '';

    const payload = JSON.parse(json) as { role?: string };
// eslint-disable-next-line no-restricted-syntax -- This guard detects a service-role key; it never exposes or stores the key.
    if (payload.role === 'service_role') {

      throw new ServiceError(
        'FORBIDDEN',
        'Refusing to start: a service-role key was supplied to a client build.',
      );
    }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

const PG_CODES: Record<string, ServiceErrorCode> = {
  '42501': 'FORBIDDEN',
  P0002: 'NOT_FOUND',
  PGRST116: 'NOT_FOUND',
  '22023': 'VALIDATION',
  '22P02': 'VALIDATION',
  '23502': 'VALIDATION',
  '23503': 'VALIDATION',
  '23505': 'CONFLICT',
  '23514': 'CONFLICT',
  '40001': 'CONFLICT',
  '55000': 'CONFLICT',
  BQ001: 'CONFLICT',
  BQ002: 'CONFLICT',
  BQ003: 'NOT_FOUND',
  BQ004: 'RATE_LIMITED',
  BQ005: 'CONFLICT',
  PGRST301: 'UNAUTHENTICATED',
  PGRST303: 'UNAUTHENTICATED',
};

const GENERIC: Record<ServiceErrorCode, string> = {
  UNAUTHENTICATED: 'Your session has ended. Please sign in again.',
  FORBIDDEN: 'You don’t have permission to do that.',
  NOT_FOUND: 'We couldn’t find that.',
  VALIDATION: 'Please check the highlighted fields.',
  CONFLICT: 'That can’t be done right now. Refresh and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  LOCKED:
    'Too many failed sign-in attempts. Try again in 15 minutes or reset your password.',
  SUSPENDED: 'This account is suspended.',
  UNVERIFIED: 'Please verify your email address first.',
  NETWORK: 'You appear to be offline. Check your connection and try again.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

const SYSTEM_MESSAGE =
  /(constraint|violates|duplicate key|null value|relation "|column "|syntax|function |permission denied|schema |operator |type "|invalid input syntax|out of range|JWT|PGRST|Could not find)/i;

function safeMessage(
  code: ServiceErrorCode,
  message: unknown,
): string {
  return typeof message === 'string' &&
    message.length > 0 &&
    message.length <= 300 &&
    !SYSTEM_MESSAGE.test(message)
    ? message
    : GENERIC[code];
}

/** Converts PostgREST, Auth, Storage and Edge Function errors into ServiceError. */
export function toServiceError(e: unknown): ServiceError {
  if (e instanceof ServiceError) return e;

  if (
    e instanceof FunctionsFetchError ||
    e instanceof FunctionsRelayError
  ) {
    return new ServiceError('NETWORK', GENERIC.NETWORK);
  }

  if (e instanceof TypeError && /fetch|network/i.test(e.message)) {
    return new ServiceError('NETWORK', GENERIC.NETWORK);
  }

  const err = e as {
    code?: string;
    message?: string;
    status?: number;
    name?: string;
  } | null;

  if (err && typeof err === 'object') {
    if (err.code && PG_CODES[err.code]) {
      const code = PG_CODES[err.code]!;
      return new ServiceError(code, safeMessage(code, err.message));
    }

    if (err.status === 429) {
      return new ServiceError('RATE_LIMITED', GENERIC.RATE_LIMITED);
    }

    if (err.status === 401) {
      return new ServiceError(
        'UNAUTHENTICATED',
        GENERIC.UNAUTHENTICATED,
      );
    }
  }

  return new ServiceError('UNKNOWN', GENERIC.UNKNOWN);
}

/** Maps Supabase Auth errors to user-facing errors. */
export function authError(e: unknown): ServiceError {
  const err = e as {
    code?: string;
    message?: string;
    status?: number;
  } | null;

  const code = err?.code ?? '';
  const msg = err?.message ?? '';

  if (/suspended/i.test(msg)) {
    return new ServiceError(
      'SUSPENDED',
      msg.length <= 300 ? msg : GENERIC.SUSPENDED,
    );
  }

  if (/too many failed sign-in attempts/i.test(msg)) {
    return new ServiceError('LOCKED', GENERIC.LOCKED);
  }

  if (/has been deleted/i.test(msg)) {
    return new ServiceError(
      'UNAUTHENTICATED',
      'Incorrect email or password.',
    );
  }

  if (
    code === 'invalid_credentials' ||
    /invalid login credentials/i.test(msg)
  ) {
    return new ServiceError(
      'UNAUTHENTICATED',
      'Incorrect email or password.',
    );
  }

  if (code === 'email_not_confirmed') {
    return new ServiceError(
      'UNVERIFIED',
      'Please verify your email address to continue.',
    );
  }

  if (code === 'user_already_exists' || code === 'email_exists') {
    return new ServiceError('CONFLICT', 'Email already registered', {
      email:
        'Email already registered. Sign in instead, or reset your password.',
    });
  }

  if (code === 'weak_password') {
    return new ServiceError(
      'VALIDATION',
      'Please choose a stronger password.',
      {
        password:
          'Password must be at least 8 characters and include a number.',
      },
    );
  }

  if (code === 'same_password') {
    return new ServiceError(
      'VALIDATION',
      'Choose a password you haven’t used here before.',
      { password: 'Choose a new password.' },
    );
  }

  if (code === 'otp_expired' || code === 'flow_state_expired') {
    return new ServiceError(
      'VALIDATION',
      'This link is invalid or has expired. Request a new one.',
    );
  }

  if (
    code === 'mfa_verification_failed' ||
    code === 'mfa_challenge_expired'
  ) {
    return new ServiceError(
      'VALIDATION',
      'That code did not match. Wait for a new code and try again.',
      { code: 'That code did not match.' },
    );
  }

  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    err?.status === 429
  ) {
    return new ServiceError('RATE_LIMITED', GENERIC.RATE_LIMITED);
  }

  if (
    code === 'session_not_found' ||
    code === 'refresh_token_not_found' ||
    err?.status === 401
  ) {
    return new ServiceError(
      'UNAUTHENTICATED',
      GENERIC.UNAUTHENTICATED,
    );
  }

  return toServiceError(e);
}

async function functionError(e: unknown): Promise<ServiceError> {
  if (e instanceof FunctionsHttpError) {
    try {
      const body = (await (e.context as Response).json()) as {
        error?: {
          code?: ServiceErrorCode;
          message?: string;
          fieldErrors?: Record<string, string>;
        };
      };

      const code =
        body.error?.code && body.error.code in GENERIC
          ? body.error.code
          : 'UNKNOWN';

      return new ServiceError(
        code,
        body.error?.message ?? GENERIC[code],
        body.error?.fieldErrors,
      );
    } catch {
      return new ServiceError('UNKNOWN', GENERIC.UNKNOWN);
    }
  }

  return toServiceError(e);
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export type Bucket =
  | 'product-images'
  | 'store-logos'
  | 'profile-images'
  | 'return-evidence'
  | 'support-attachments'
  | 'delivery-evidence';

const SIGNED_URL_SECONDS = 3600;

/**
 * Converts a data URL to a Blob without fetching the data URL.
 * This avoids CSP errors caused by calling fetch() with a data: URL.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');

  if (!dataUrl.startsWith('data:') || comma < 0) {
    throw new Error('Invalid image data URL');
  }

  const metadata = dataUrl.slice(5, comma);
  const mimeType =
    metadata.split(';')[0] || 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1);

  if (metadata.split(';').includes('base64')) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes.buffer as ArrayBuffer], {
      type: mimeType,
    });
  }

  return new Blob([decodeURIComponent(payload)], {
    type: mimeType,
  });
}

export function createAdapterContext(
  config: SupabaseClientConfig,
) {
  assertPublicAnonKey(config.anonKey);

  if (!config.url || !config.anonKey) {
    throw new ServiceError(
      'UNKNOWN',
      'Supabase is not configured. Set the Supabase URL and anon key, or use the mock data source.',
    );
  }

  const sb: SupabaseClient = createClient(
    config.url,
    config.anonKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: typeof window !== 'undefined',
        flowType: 'pkce',
        ...(config.authStorage
          ? { storage: config.authStorage }
          : {}),
      },
      global: {
        headers: { 'x-client-info': 'bazarhq-app' },
      },
    },
  );

  const urlCache = new Map<
    string,
    { url: string; expiresAt: number }
  >();

  const listeners = new Set<() => void>();

  /** Unwraps a PostgREST/RPC result or throws a ServiceError. */
  async function q<T>(
    query: PromiseLike<{ data: unknown; error: unknown }>,
  ): Promise<T> {
    let res: { data: unknown; error: unknown };

    try {
      res = await query;
    } catch (e) {
      throw toServiceError(e);
    }

    if (res.error) throw toServiceError(res.error);
    return res.data as T;
  }

  async function rpc<T>(
    fn: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    return await q<T>(sb.rpc(fn, args));
  }

  /** Calls an Edge Function with the user's session or as a guest. */
  async function invoke<T>(
    fn: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    try {
      const { data, error } = await sb.functions.invoke(fn, {
        body,
      });

      if (error) throw await functionError(error);
      return data as T;
    } catch (e) {
      throw e instanceof ServiceError
        ? e
        : await functionError(e);
    }
  }

  async function userId(): Promise<string> {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user.id;

    if (!id) {
      throw new ServiceError(
        'UNAUTHENTICATED',
        'Please sign in to continue.',
      );
    }

    return id;
  }

  async function signedUrls(
    bucket: Bucket,
    paths: (string | null | undefined)[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const now = Date.now();
    const missing: string[] = [];

    for (const p of new Set(paths.filter((x): x is string => !!x))) {
      if (/^(https?:|blob:|data:)/.test(p)) {
        out.set(p, p);
        continue;
      }

      const hit = urlCache.get(`${bucket}/${p}`);

      if (hit && hit.expiresAt > now + 60_000) {
        out.set(p, hit.url);
      } else {
        missing.push(p);
      }
    }

    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);

      const { data } = await sb.storage
        .from(bucket)
        .createSignedUrls(chunk, SIGNED_URL_SECONDS);

      for (const item of data ?? []) {
        if (item.signedUrl && item.path) {
          out.set(item.path, item.signedUrl);

          urlCache.set(`${bucket}/${item.path}`, {
            url: item.signedUrl,
            expiresAt: now + SIGNED_URL_SECONDS * 1000,
          });
        }
      }
    }

    return out;
  }

  async function signedUrl(
    bucket: Bucket,
    path: string | null | undefined,
  ): Promise<string | null> {
    if (!path) return null;

    return (await signedUrls(bucket, [path])).get(path) ?? null;
  }

  /** Reads the selected file and uploads it to a policy-checked Storage path. */
  async function upload(
    bucket: Bucket,
    path: string,
    file: UploadFile,
    kind: 'image' | 'attachment' = 'image',
  ): Promise<void> {
    const validationError =
      kind === 'image'
        ? validateImageFile(file)
        : validateAttachmentFile(file);

    if (validationError) {
      throw new ServiceError('VALIDATION', validationError);
    }

    const previewUrl = file.previewUrl;

    if (!previewUrl) {
      throw new ServiceError(
        'VALIDATION',
        'We couldn’t read that file. Choose it again.',
      );
    }

    let blob: Blob;

    try {
      if (previewUrl.startsWith('data:')) {
        // Convert data URLs directly; fetch(dataUrl) can be blocked by CSP.
        blob = dataUrlToBlob(previewUrl);
      } else {
        const response = await fetch(previewUrl);

        if (!response.ok) {
          throw new Error('Unable to read image');
        }

        blob = await response.blob();
      }

      if (blob.size === 0) {
        throw new Error('Empty file');
      }
    } catch {
      throw new ServiceError(
        'VALIDATION',
        'We couldn’t read that file. Choose it again.',
      );
    }

    const contentType =
      blob.type || file.type || 'application/octet-stream';

    const { error } = await sb.storage
      .from(bucket)
      .upload(path, blob, {
        contentType,
        upsert: false,
        cacheControl: '3600',
      });

    if (error) {
      const status = (
        error as { statusCode?: string | number }
      ).statusCode;

      if (String(status) === '413') {
        throw new ServiceError(
          'VALIDATION',
          'That file is too large.',
        );
      }

      if (
        String(status) === '403' ||
        String(status) === '400'
      ) {
        throw new ServiceError(
          'FORBIDDEN',
          'You can’t upload a file here.',
        );
      }

      throw toServiceError(error);
    }
  }

  return {
    sb,
    config,
    q,
    rpc,
    invoke,
    userId,
    signedUrls,
    signedUrl,
    upload,

    /** In-app change notifications for subscribe() listeners. */
    emit() {
      for (const listener of listeners) {
        listener();
      }
    },

    listen(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type AdapterContext =
  ReturnType<typeof createAdapterContext>;

/** A safe object name: random prefix + cleaned original name. */
export function objectName(
  file: Pick<UploadFile, 'name'>,
): string {
  const clean = file.name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-60);

  const rand =
    typeof crypto !== 'undefined' &&
    'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `${rand}-${clean || 'file'}`;
}

export function idempotencyKeyFor(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' &&
    'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}:${rand}`;
}
