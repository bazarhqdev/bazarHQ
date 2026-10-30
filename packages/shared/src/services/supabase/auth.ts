/**
 * AuthService + AdminAuthService on Supabase Auth.
 *
 *  - Roles come only from public.profiles (set server-side by
 *    handle_new_auth_user / grant_super_admin); the client never sends one
 *    except the sign-up flow hint `account_type`, which the trigger maps to
 *    customer or merchant only (AUTHZ-01/02).
 *  - Lockout (AUTH-07) and suspension (AUTH-14) are enforced by the Auth hooks
 *    in migration 006; their messages are mapped to LOCKED / SUSPENDED here.
 *  - Super Admins sign in only through AdminAuthService: password, then TOTP
 *    (AAL2), from an allowlisted network, with a 30-minute idle limit.
 */
import type { User as SbUser } from '@supabase/supabase-js';
import { ADMIN_LIMITS } from '../../constants';
import type { AccountUser, ActiveSession, Profile, Session } from '../../types';
import { ServiceError, type AdminAuthService, type AuthService } from '../contracts';
import { authError, objectName, type AdapterContext } from './core';
import { mapStore, STORE_COLUMNS } from './mappers';

const PENDING_KEY = 'bazarhq.sb.pendingVerification';
const OAUTH_INTENT_KEY = 'bazarhq.sb.oauthIntent';
const ADMIN_ACTIVITY_KEY = 'bazarhq.sb.adminActivity';
const GENERIC_LOGIN = 'Incorrect email or password.';

interface PendingVerification {
  email: string;
  fullName: string;
  role: 'merchant' | 'customer';
  createdAt: string;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function origin(ctx: AdapterContext): string {
  if (ctx.config.redirectTo) return ctx.config.redirectTo.replace(/\/+$/, '');
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function resetPath(): string {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  return path.startsWith('/merchant') ? '/merchant/reset-password' : '/forgot-password';
}

function describeDevice(ua: string | null): { device: string; platform: 'web' | 'android' } {
  const s = ua ?? '';
  const platform: 'web' | 'android' = /Android/i.test(s) && /(wv|Capacitor|BazarHQ)/i.test(s) ? 'android' : 'web';
  const browser = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /Android/i.test(s) ? 'Android' : /iPhone|iPad/i.test(s) ? 'iOS' : /Windows/i.test(s) ? 'Windows' : /Mac OS/i.test(s) ? 'macOS' : /Linux/i.test(s) ? 'Linux' : 'Unknown device';
  return { device: platform === 'android' ? `BazarHQ app on ${os}` : `${browser} on ${os}`, platform };
}

export function createAuth(ctx: AdapterContext) {
  const { sb } = ctx;

  async function profileOf(userId: string): Promise<(Profile & { createdAt: string }) | null> {
    const row = await ctx.q<Record<string, unknown> | null>(
      sb.from('profiles').select('id, full_name, phone, avatar_url, role, status, suspension_reason, created_at').eq('id', userId).maybeSingle(),
    );
    if (!row) return null;
    return {
      id: row.id as string,
      fullName: row.full_name as string,
      phone: (row.phone as string | null) ?? null,
      avatarUrl: await ctx.signedUrl('profile-images', row.avatar_url as string | null),
      role: row.role as Profile['role'],
      status: row.status as Profile['status'],
      suspensionReason: (row.suspension_reason as string | null) ?? null,
      createdAt: row.created_at as string,
    };
  }

  async function accountUser(user: SbUser): Promise<AccountUser | null> {
    const profile = await profileOf(user.id);
    if (!profile) return null;
    const factors = await sb.auth.mfa.listFactors().catch(() => null);
    const provider = (user.app_metadata?.provider as string | undefined) === 'google' ? 'google' : 'email';
    return {
      id: user.id,
      email: user.email ?? '',
      emailVerified: !!user.email_confirmed_at,
      pendingEmail: user.new_email ?? null,
      authProvider: provider,
      twoFactorEnabled: !!factors?.data?.totp?.some((f) => f.status === 'verified'),
      createdAt: user.created_at,
      fullName: profile.fullName,
      phone: profile.phone,
      avatarUrl: profile.avatarUrl,
      role: profile.role,
      status: profile.status,
      suspensionReason: profile.suspensionReason,
    };
  }

  async function storeOf(ownerId: string): Promise<Session['store']> {
    const row = await ctx.q<Record<string, unknown> | null>(sb.from('stores').select(STORE_COLUMNS).eq('owner_id', ownerId).maybeSingle());
    if (!row) return null;
    const urls = await ctx.signedUrls('store-logos', [row.logo_url as string | null, row.banner_url as string | null]);
    return mapStore(row, { logo: urls.get(row.logo_url as string) ?? null, banner: urls.get(row.banner_url as string) ?? null });
  }

  let networkCache: { allowed: boolean; ip: string; at: number } | null = null;
  async function checkNetwork(force = false): Promise<{ allowed: boolean; ip: string }> {
    if (!force && networkCache && Date.now() - networkCache.at < 5 * 60_000) return networkCache;
    const r = await ctx.invoke<{ allowed: boolean; ip: string }>('admin-network-check', {});
    networkCache = { ...r, at: Date.now() };
    return r;
  }

  function adminActivity(): number {
    return readJson<number>(ADMIN_ACTIVITY_KEY) ?? 0;
  }

  /** Applies the post-OAuth merchant intent once (become_merchant only works for fresh, unused customer accounts). */
  async function applyOAuthIntent(user: AccountUser): Promise<AccountUser> {
    let intent: string | null = null;
    try {
      intent = typeof window !== 'undefined' ? window.localStorage.getItem(OAUTH_INTENT_KEY) : null;
      if (intent && typeof window !== 'undefined') window.localStorage.removeItem(OAUTH_INTENT_KEY);
    } catch {
      intent = null;
    }
    if (intent === 'merchant' && user.role === 'customer' && user.authProvider === 'google') {
      try {
        await ctx.rpc('become_merchant');
        return { ...user, role: 'merchant' };
      } catch {
        return user;
      }
    }
    return user;
  }

  // Short-lived cache: getSession() is called on every screen; profile/store reads are cheap but not free.
  let cache: { token: string; at: number; session: Session } | null = null;
  sb.auth.onAuthStateChange(() => {
    cache = null;
  });
  function invalidate() {
    cache = null;
  }

  async function buildSession(opts: { requireAdminReady?: boolean } = {}): Promise<Session | null> {
    const { data } = await sb.auth.getSession();
    const sbSession = data.session;
    if (sbSession && cache && cache.token === sbSession.access_token && Date.now() - cache.at < 15_000 && !opts.requireAdminReady) {
      return cache.session;
    }
    if (!sbSession) {
      const pending = readJson<PendingVerification>(PENDING_KEY);
      if (!pending) return null;
      // Awaiting email verification: a UI-only placeholder (no tokens, no data access).
      return {
        user: {
          id: 'pending-verification',
          email: pending.email,
          emailVerified: false,
          pendingEmail: null,
          authProvider: 'email',
          twoFactorEnabled: false,
          createdAt: pending.createdAt,
          fullName: pending.fullName,
          phone: null,
          avatarUrl: null,
          role: pending.role,
          status: 'active',
          suspensionReason: null,
        },
        store: null,
      };
    }
    writeJson(PENDING_KEY, null);
    let user = await accountUser(sbSession.user);
    if (!user || user.status === 'deleted') {
      await sb.auth.signOut({ scope: 'local' });
      return null;
    }
    user = await applyOAuthIntent(user);
    const session: Session = { user, store: user.role === 'merchant' ? await storeOf(user.id) : null };

    if (user.role === 'super_admin') {
      const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel().catch(() => null);
      const mfaVerified = aal?.data?.currentLevel === 'aal2';
      const last = adminActivity();
      const idleExpiresAt = last ? new Date(last + ADMIN_LIMITS.idleTimeoutMinutes * 60_000).toISOString() : null;
      if (mfaVerified && last && Date.now() - last > ADMIN_LIMITS.idleTimeoutMinutes * 60_000) {
        await sb.auth.signOut({ scope: 'local' });
        writeJson(ADMIN_ACTIVITY_KEY, null);
        if (opts.requireAdminReady) throw new ServiceError('UNAUTHENTICATED', 'Your admin session expired after 30 minutes of inactivity. Sign in again.');
        return null;
      }
      const network = mfaVerified ? await checkNetwork().catch(() => ({ allowed: false, ip: 'unknown' })) : { allowed: false, ip: 'unknown' };
      session.admin = { mfaVerified, networkAllowed: network.allowed, idleExpiresAt, ip: network.ip };
      // Like the mock: an admin session only counts once TOTP is done on the approved network.
      if (!mfaVerified || !network.allowed) return null;
    }
    cache = { token: sbSession.access_token, at: Date.now(), session };
    return session;
  }

  async function requireSession(): Promise<Session> {
    const s = await buildSession();
    if (!s || s.user.id === 'pending-verification') throw new ServiceError('UNAUTHENTICATED', 'Please sign in to continue.');
    return s;
  }

  const auth: AuthService = {
    getSession: () => buildSession(),

    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) {
        const mapped = authError(error);
        if (mapped.code === 'UNVERIFIED') {
          writeJson(PENDING_KEY, { email: email.trim().toLowerCase(), fullName: '', role: 'merchant', createdAt: new Date().toISOString() });
        }
        throw mapped;
      }
      const user = await accountUser(data.user);
      // Super Admins must use the admin sign-in (allowlist + TOTP, §12.1).
      if (!user || user.role === 'super_admin' || user.status === 'deleted') {
        await sb.auth.signOut({ scope: 'local' });
        throw new ServiceError('UNAUTHENTICATED', GENERIC_LOGIN);
      }
      const session = await buildSession();
      if (!session) throw new ServiceError('UNAUTHENTICATED', GENERIC_LOGIN);
      return session;
    },

    async signInWithGoogle(accountType = 'merchant') {
      try {
        window.localStorage.setItem(OAUTH_INTENT_KEY, accountType);
      } catch {
        /* intent is best-effort */
      }
      const external = !!ctx.config.openExternal;
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: ctx.config.oauthCallbackUrl ?? `${origin(ctx)}${typeof window !== 'undefined' ? window.location.pathname : '/'}`,
          skipBrowserRedirect: external,
        },
      });
      if (error) throw authError(error);
      if (external && data.url) await ctx.config.openExternal!(data.url);
      // The browser leaves the page; the session is picked up on return (detectSessionInUrl).
      return await new Promise<Session>(() => {});
    },

    async register({ fullName, email, password, accountType }) {
      const normalized = email.trim().toLowerCase();
      const { data, error } = await sb.auth.signUp({
        email: normalized,
        password,
        options: {
          data: { full_name: fullName.trim(), account_type: accountType === 'customer' ? 'customer' : 'merchant' },
          emailRedirectTo: `${origin(ctx)}${accountType === 'customer' ? '/verify-email' : '/merchant/verify-email'}`,
        },
      });
      if (error) throw authError(error);
      // With email confirmation on, an existing address comes back with no identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new ServiceError('CONFLICT', 'Email already registered', { email: 'Email already registered. Sign in instead, or reset your password.' });
      }
      if (!data.session) {
        writeJson(PENDING_KEY, {
          email: normalized,
          fullName: fullName.trim(),
          role: accountType === 'customer' ? 'customer' : 'merchant',
          createdAt: new Date().toISOString(),
        } satisfies PendingVerification);
      }
      return { email: normalized };
    },

    async resendVerification(email) {
      const { error } = await sb.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
      if (error) throw authError(error);
    },

    async refreshVerification() {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        const { data: fresh } = await sb.auth.getUser();
        if (fresh.user?.email_confirmed_at) {
          await sb.auth.refreshSession();
          const s = await buildSession();
          if (s) return s;
        }
      }
      throw new ServiceError(
        'UNVERIFIED',
        "We haven't received your verification yet. Open the link in the email we sent, then sign in again on this device if needed.",
      );
    },

    async requestPasswordReset(email) {
      // Same response whether or not the address exists (no enumeration).
      const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${origin(ctx)}${resetPath()}` });
      if (error && authError(error).code === 'RATE_LIMITED') throw authError(error);
    },

    async resetPassword(token, password) {
      // The recovery email template links to …?token={{ .TokenHash }} (see supabase/templates/recovery.html).
      const { error } = await sb.auth.verifyOtp({ token_hash: token, type: 'recovery' });
      if (error) throw new ServiceError('VALIDATION', 'This reset link is invalid or has expired. Request a new one.');
      const upd = await sb.auth.updateUser({ password });
      if (upd.error) throw authError(upd.error);
      // Single-use link; end every session after a reset.
      await sb.auth.signOut({ scope: 'global' });
    },

    async signOut() {
      writeJson(PENDING_KEY, null);
      writeJson(ADMIN_ACTIVITY_KEY, null);
      networkCache = null;
      await sb.auth.signOut({ scope: 'local' });
    },

    async updateProfile({ fullName, phone, avatar }) {
      const s = await requireSession();
      const patch: Record<string, unknown> = { full_name: fullName.trim(), phone: phone || null };
      if (avatar) {
        const path = `users/${s.user.id}/${objectName(avatar)}`;
        await ctx.upload('profile-images', path, avatar);
        patch.avatar_url = path;
      } else if (avatar === null) {
        patch.avatar_url = null;
      }
      await ctx.q(sb.from('profiles').update(patch).eq('id', s.user.id));
      invalidate();
      return (await requireSession()).user;
    },

    async requestEmailChange(newEmail) {
      const { error } = await sb.auth.updateUser({ email: newEmail.trim().toLowerCase() }, { emailRedirectTo: `${origin(ctx)}/merchant/profile` });
      if (error) {
        const e = authError(error);
        if (e.code === 'CONFLICT') throw new ServiceError('CONFLICT', 'That email is already registered.', { email: 'That email is already registered.' });
        throw e;
      }
    },

    async changePassword(currentPassword, newPassword) {
      const s = await requireSession();
      // Re-verify the current password (counts toward the lockout like any sign-in).
      const check = await sb.auth.signInWithPassword({ email: s.user.email, password: currentPassword });
      if (check.error) {
        const e = authError(check.error);
        if (e.code === 'UNAUTHENTICATED') {
          throw new ServiceError('VALIDATION', 'Your current password is incorrect.', { currentPassword: 'Your current password is incorrect.' });
        }
        throw e;
      }
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw authError(error);
      // AUTH-06: end all other sessions.
      await sb.auth.signOut({ scope: 'others' });
    },

    async listSessions() {
      const rows = await ctx.rpc<{ id: string; user_agent: string | null; ip: string | null; last_active_at: string; current: boolean }[]>('list_my_sessions');
      return rows.map((r): ActiveSession => {
        const d = describeDevice(r.user_agent);
        return { id: r.id, device: d.device, platform: d.platform, location: r.ip ? `IP ${r.ip}` : null, lastActiveAt: r.last_active_at, current: r.current };
      });
    },

    async terminateSession(sessionId) {
      await ctx.rpc('revoke_my_session', { p_session_id: sessionId });
    },

    async beginTotpEnrollment() {
      const existing = await sb.auth.mfa.listFactors();
      for (const f of existing.data?.all ?? []) {
        if (f.factor_type === 'totp' && f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
      if (error || !data) throw authError(error);
      return { secret: data.totp.secret, otpauthUrl: data.totp.uri };
    },

    async confirmTotpEnrollment(code) {
      const factors = await sb.auth.mfa.listFactors();
      const pending = (factors.data?.all ?? []).find((f) => f.factor_type === 'totp' && f.status !== 'verified');
      if (!pending) throw new ServiceError('VALIDATION', 'Start two-factor setup again.');
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: pending.id, code });
      if (error) throw authError(error);
      // Supabase Auth issues no recovery codes; the profile screen suggests a second authenticator instead.
      return { recoveryCodes: [] };
    },

    async disableTotp(code) {
      const factors = await sb.auth.mfa.listFactors();
      const factor = factors.data?.totp?.find((f) => f.status === 'verified');
      if (!factor) return;
      const verify = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (verify.error) throw authError(verify.error);
      const { error } = await sb.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw authError(error);
    },

    async getDeletionPrecheck() {
      const s = await requireSession();
      let query = sb.from('orders').select('id', { count: 'exact', head: true }).not('status', 'in', '(delivered,cancelled)');
      query = s.store ? query.eq('store_id', s.store.id) : query.eq('customer_id', s.user.id);
      const { count, error } = await query;
      if (error) throw authError(error);
      return { pendingOrders: count ?? 0 };
    },

    async deleteAccount(confirmation) {
      if (confirmation !== 'DELETE') throw new ServiceError('VALIDATION', 'Type DELETE to confirm.', { confirmation: 'Type DELETE to confirm.' });
      await ctx.rpc('delete_my_account', { p_confirmation: confirmation });
      await sb.auth.signOut({ scope: 'local' });
    },
  };

  const adminAuth: AdminAuthService = {
    checkNetwork: () => checkNetwork(true),

    async signIn(email, password) {
      const net = await checkNetwork(true);
      if (!net.allowed) throw new ServiceError('FORBIDDEN', 'Super Admin access is only allowed from the approved network or VPN.');
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw authError(error);
      const profile = await profileOf(data.user.id);
      if (!profile || profile.role !== 'super_admin' || profile.status !== 'active') {
        await sb.auth.signOut({ scope: 'local' });
        throw new ServiceError('UNAUTHENTICATED', GENERIC_LOGIN);
      }
      const factors = await sb.auth.mfa.listFactors();
      if (!factors.data?.totp?.some((f) => f.status === 'verified')) {
        await sb.auth.signOut({ scope: 'local' });
        throw new ServiceError('FORBIDDEN', 'Two-factor authentication is not set up for this account. Run the admin TOTP enrolment (see BACKEND_SETUP.md).');
      }
      return { mfaRequired: true };
    },

    async verifyTotp(code) {
      const factors = await sb.auth.mfa.listFactors();
      const factor = factors.data?.totp?.find((f) => f.status === 'verified');
      if (!factor) throw new ServiceError('UNAUTHENTICATED', 'Sign in again to continue.');
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) throw new ServiceError('VALIDATION', 'That code is not valid. Check your authenticator app and try again.', { code: 'Invalid code.' });
      writeJson(ADMIN_ACTIVITY_KEY, Date.now());
      const s = await buildSession({ requireAdminReady: true });
      if (!s) throw new ServiceError('FORBIDDEN', 'Super Admin access is only allowed from the approved network or VPN.');
      return s;
    },

    async touch() {
      const s = await buildSession({ requireAdminReady: true });
      if (!s) throw new ServiceError('UNAUTHENTICATED', 'Your admin session has ended. Sign in again.');
      writeJson(ADMIN_ACTIVITY_KEY, Date.now());
      return (await buildSession()) ?? s;
    },

    async signOut() {
      await auth.signOut();
    },
  };

  /** For admin service calls: refreshes the idle timer or fails like the mock. */
  async function requireAdminSession(): Promise<Session> {
    const s = await buildSession({ requireAdminReady: true });
    if (!s || s.user.role !== 'super_admin') throw new ServiceError('UNAUTHENTICATED', 'Your admin session has ended. Sign in again.');
    writeJson(ADMIN_ACTIVITY_KEY, Date.now());
    return s;
  }

  /**
   * Mobile OAuth return (MOB-07): the system browser comes back to the app on
   * the callback deep link with a PKCE `code`; exchange it for a session.
   * Returns false for links that are not an OAuth callback.
   */
  async function completeOAuthRedirect(url: string): Promise<boolean> {
    const callback = ctx.config.oauthCallbackUrl;
    if (!callback || !url.startsWith(callback)) return false;
    const params = new URL(url.replace(/#/, '?')).searchParams;
    const error = params.get('error_description') ?? params.get('error');
    if (error) throw new ServiceError('UNAUTHENTICATED', 'Google sign-in was cancelled or failed. Please try again.');
    const code = params.get('code');
    if (!code) return false;
    const { error: exchangeError } = await sb.auth.exchangeCodeForSession(code);
    if (exchangeError) throw authError(exchangeError);
    invalidate();
    ctx.emit();
    return true;
  }

  return { auth, adminAuth, buildSession, requireSession, requireAdminSession, invalidate, completeOAuthRedirect };
}

export type AuthModule = ReturnType<typeof createAuth>;
