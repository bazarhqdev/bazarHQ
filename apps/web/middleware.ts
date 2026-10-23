/**
 * Edge middleware:
 *  1. Store subdomains — `<sub>.bazarhq.com/…` is served from `/store/<sub>/…`
 *     (FR-C-37). Reserved hosts (www, admin, merchant, api, app) are skipped.
 *  2. Super Admin network gate — `/admin/*` requires the caller IP to be on
 *     ADMIN_IP_ALLOWLIST (FR-SA-01). This is a server-side check; the UI and
 *     the mock service layer only mirror it. TOTP + 30-minute idle timeout are
 *     enforced by the auth layer (Supabase MFA / AAL2) in production.
 *  3. Role-aware routing (Supabase mode): protected areas need a session whose
 *     role claim matches — /merchant → merchant, /admin → super_admin,
 *     /customer|/orders|/profile → customer. This only routes; it does not
 *     authorize. Every read/write is authorized again by RLS and the Edge
 *     Functions. In mock mode the session lives in browser storage, so the
 *     client guards (MerchantGuard / RequireCustomer / RequireAdmin) do this.
 *  4. Security headers (CSP, HSTS, no-store for admin).
 *
 * Next.js 16 calls this convention "proxy"; `middleware.ts` is kept because the
 * project brief names it. Rename to `proxy.ts` (same export) to silence the
 * deprecation notice.
 */
import { NextResponse, type NextRequest } from 'next/server';

const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'bazarhq.com').toLowerCase();
const RESERVED = new Set(['www', 'admin', 'merchant', 'api', 'app', 'static', 'cdn']);
const STORE_PATHS = /^\/(?:$|products(?:\/|$)|cart$|checkout$|order-success$)/;
const isProd = process.env.NODE_ENV === 'production';

function storeSubdomain(host: string): string | null {
  const h = host.split(':')[0]!.toLowerCase();
  if (!h.endsWith(`.${ROOT_DOMAIN}`)) return null;
  const sub = h.slice(0, -(ROOT_DOMAIN.length + 1));
  if (!sub || sub.includes('.') || RESERVED.has(sub) || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(sub)) return null;
  return sub;
}

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  // Direct local connection (next dev / next start without a proxy).
  const host = (req.headers.get('host') ?? '').split(':')[0];
  return host === 'localhost' || host === '127.0.0.1' ? '127.0.0.1' : null;
}

/** Exact IPs or IPv4 CIDR blocks, comma separated. `*` allows all (local demos only). */
function ipAllowed(ip: string | null): boolean {
  const raw = process.env.ADMIN_IP_ALLOWLIST?.trim();
  // Fail closed in production when no allowlist is configured.
  if (!raw) return !isProd;
  if (raw === '*') return true;
  if (!ip) return false;
  return raw.split(',').some((entry) => {
    const rule = entry.trim();
    if (!rule) return false;
    if (!rule.includes('/')) return rule === ip || (rule === '127.0.0.1' && ip === '::1');
    const [base, bitsStr] = rule.split('/');
    const bits = Number(bitsStr);
    const toInt = (a: string) => a.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base!) || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (toInt(ip) & mask) === (toInt(base!) & mask);
  });
}

const DATA_SOURCE = process.env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock';
type Role = 'customer' | 'merchant' | 'super_admin';

const PROTECTED: { prefix: RegExp; role: Role; login: string }[] = [
  { prefix: /^\/merchant\/(?!login|register|verify-email|forgot-password|reset-password)/, role: 'merchant', login: '/merchant/login' },
  { prefix: /^\/admin\/(?!login|totp)/, role: 'super_admin', login: '/admin/login' },
  { prefix: /^\/(customer|orders|profile)(\/|$)/, role: 'customer', login: '/login' },
];

/**
 * Reads the role claim from the Supabase auth cookie (sb-<ref>-auth-token,
 * possibly chunked and base64-prefixed by @supabase/ssr). The JWT signature is
 * NOT verified here — that happens in Supabase; a forged cookie only gets a
 * page shell whose data calls are then refused by RLS.
 */
function sessionRole(req: NextRequest): { role: Role | null; aal: string | null } {
  const cookies = req.cookies
    .getAll()
    .filter((c) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!cookies.length) return { role: null, aal: null };
  try {
    let raw = cookies.map((c) => c.value).join('');
    if (raw.startsWith('base64-')) raw = atob(raw.slice(7));
    const token = (JSON.parse(raw) as { access_token?: string }).access_token ?? '';
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      app_metadata?: { role?: Role };
      user_role?: Role;
      aal?: string;
    };
    return { role: payload.app_metadata?.role ?? payload.user_role ?? null, aal: payload.aal ?? null };
  } catch {
    return { role: null, aal: null };
  }
}

function csp(): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : '';
  const connect = ["'self'", supabase, supabase.replace(/^https/, 'wss'), isProd ? '' : 'ws:'].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    // Next.js inlines bootstrap scripts; nonces can replace 'unsafe-inline' once pages are server-rendered.
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

function withHeaders(res: NextResponse, admin: boolean): NextResponse {
  res.headers.set('Content-Security-Policy', csp());
  if (isProd) res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  if (admin) {
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const admin = pathname === '/admin' || pathname.startsWith('/admin/');

  if (admin && !ipAllowed(clientIp(req))) {
    const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access restricted · BazarHQ</title><body style="font-family:system-ui,sans-serif;background:#f4f6f5;color:#0f1d2e;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:28rem;padding:2rem;text-align:center"><h1 style="font-size:1.25rem">Access restricted</h1><p style="color:#4b5a6b">The BazarHQ admin console is only available from the approved office network or VPN.</p></main></body></html>`;
    return withHeaders(new NextResponse(body, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } }), true);
  }

  if (DATA_SOURCE === 'supabase') {
    const rule = PROTECTED.find((r) => r.prefix.test(pathname));
    if (rule) {
      const { role, aal } = sessionRole(req);
      // Super Admin pages also need an MFA-verified (AAL2) session.
      if (role !== rule.role || (rule.role === 'super_admin' && aal !== 'aal2')) {
        const url = req.nextUrl.clone();
        url.pathname = rule.login;
        url.search = rule.role === 'super_admin' ? '' : `?next=${encodeURIComponent(pathname)}`;
        return withHeaders(NextResponse.redirect(url), admin);
      }
    }
  }

  const sub = storeSubdomain(req.headers.get('host') ?? '');
  if (sub && STORE_PATHS.test(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = `/store/${sub}${pathname === '/' ? '' : pathname}`;
    return withHeaders(NextResponse.rewrite(url), false);
  }

  return withHeaders(NextResponse.next(), admin);
}

export const config = {
  // Skip static assets and Next internals.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)'],
};
