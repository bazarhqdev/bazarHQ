/**
 * Caller identity for Edge Functions.
 *
 * 1. The bearer JWT is verified by Supabase Auth (auth.getUser), which checks
 *    the signature, expiry and that the session still exists.
 * 2. Role and status come from public.profiles (get_actor_context), never from
 *    client input or user metadata (AUTHZ-01/02).
 * 3. Super Admin calls additionally require an AAL2 (TOTP) session.
 *    Request IP may be retained as audit metadata but is not authorization.
 */
import { rpc, serviceClient } from './db.ts';
import { decodeBase64UrlToString } from './encoding.ts';
import { env } from './env.ts';
import { forbidden, HttpError, unauthenticated } from './errors.ts';

export type Role = 'customer' | 'merchant' | 'super_admin';

export interface Actor {
  id: string;
  role: Role;
  storeId: string | null;
  fullName: string;
  /** Authenticator assurance level from the verified JWT ('aal1' | 'aal2'). */
  aal: string | null;
  sessionId: string | null;
  /** The caller's access token, for user-context RPCs. Never logged. */
  token: string;
}

interface ActorContext {
  user_id: string;
  role: Role;
  status: 'active' | 'suspended' | 'deleted';
  store_id: string | null;
  full_name: string;
}

function decodePayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(decodeBase64UrlToString(parts[1]!)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extracts a user access token; the anon/publishable key (sent by signed-out clients) counts as "no user". */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const token = match[1]!.trim();
  const payload = decodePayload(token);
  if (!payload || payload.role !== 'authenticated') return null;
  return token;
}

export async function getActor(req: Request): Promise<Actor | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data?.user) throw unauthenticated();

  const ctx = await rpc<ActorContext | null>(serviceClient(), 'get_actor_context', { p_user_id: data.user.id });
  if (!ctx) throw forbidden('Your account is not set up yet. Please sign in again.');
  if (ctx.status === 'suspended') throw new HttpError(403, 'SUSPENDED', 'This account is suspended. Contact BazarHQ support.');
  if (ctx.status !== 'active') throw unauthenticated('This account is no longer active.');

  const claims = decodePayload(token) ?? {};
  return {
    id: ctx.user_id,
    role: ctx.role,
    storeId: ctx.store_id,
    fullName: ctx.full_name,
    aal: typeof claims.aal === 'string' ? claims.aal : null,
    sessionId: typeof claims.session_id === 'string' ? claims.session_id : null,
    token,
  };
}

export async function requireActor(req: Request, roles: Role[]): Promise<Actor> {
  const actor = await getActor(req);
  if (!actor) throw unauthenticated('Please sign in to continue.');
  if (!roles.includes(actor.role)) throw forbidden();
  return actor;
}

/** Merchant with a store (most merchant operations need one). */
export async function requireMerchant(req: Request): Promise<Actor & { storeId: string }> {
  const actor = await requireActor(req, ['merchant']);
  if (!actor.storeId) throw forbidden('Create your store first.');
  return actor as Actor & { storeId: string };
}

/** Client IP as set by the trusted proxy in front of the functions (configurable). */
export function clientIp(req: Request): string | null {
  const raw = req.headers.get(env.clientIpHeader);
  if (!raw || raw.length > 2000) return null;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const candidate = env.clientIpPosition === 'last' ? parts[parts.length - 1] : parts[0];
  if (!candidate) return null;
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const ipv6 = /^[0-9a-f:]{2,39}$/i;
  return ipv4.test(candidate) || (candidate.includes(':') && ipv6.test(candidate)) ? candidate : null;
}

/** Super Admin with a TOTP-verified AAL2 session. IP is optional audit metadata only. */
export async function requireSuperAdmin(req: Request): Promise<Actor & { ip: string | null }> {
  const actor = await requireActor(req, ['super_admin']);
  if (actor.aal !== 'aal2') {
    throw forbidden('Super Admin access requires a verified second factor.');
  }
  return { ...actor, ip: clientIp(req) };
}

/** Scheduler-only endpoints: constant-time comparison of the shared secret. */
export function requireCronSecret(req: Request): void {
  const expected = env.cronSecret;
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!expected || expected.length < 32) throw forbidden('Scheduler secret is not configured.');
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (diff !== 0) throw forbidden();
}
