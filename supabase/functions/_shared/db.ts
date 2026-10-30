/**
 * Supabase clients for Edge Functions.
 *
 *  - serviceClient(): service-role client. Used ONLY to call the trusted
 *    SECURITY DEFINER workflow functions that take a verified actor id
 *    (create_order, transition_order_status, …). Those functions re-check role,
 *    ownership and state themselves, so service-role access never replaces
 *    authorization (brief: "Do not use service-role access as a replacement for
 *    authorization").
 *  - userClient(token): anon key + the caller's JWT. Used for functions that are
 *    callable by `authenticated` (create_support_ticket, escalate_ticket, …), so
 *    auth.uid() and RLS apply exactly as for a direct client call.
 */
import { createClient, type SupabaseClient } from './deps.ts';
import { env } from './env.ts';
import { fromDbError, rateLimited } from './errors.ts';

let service: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (!service) {
    service = createClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-client-info': 'bazarhq-edge' } },
    });
  }
  return service;
}

export function userClient(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}`, 'x-client-info': 'bazarhq-edge' } },
  });
}

/** Calls a Postgres function and converts failures into safe HttpErrors. */
export async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as T;
}

/**
 * Fixed-window rate limit backed by private.rate_limits (consume_rate_limit).
 * Throws 429 when the bucket is exhausted.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number, message?: string): Promise<void> {
  const ok = await rpc<boolean>(serviceClient(), 'consume_rate_limit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (!ok) throw rateLimited(message);
}
