/**
 * Edge middleware:
 *  1. Store subdomains — `<sub>.bazarhq.com/…` is served from `/store/<sub>/…`
 *     (FR-C-37). Reserved hosts (www, admin, merchant, api, app) are skipped.
 *  2. Super Admin route protection — `/admin/*` pages require a session with
 *     the super_admin role and AAL2. This is a routing guard only; RLS and
 *     Supabase Edge Functions enforce data and operation authorization.
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

const DATA_SOURCE = process.env.NEXT_PUBLIC_DATA_SOURCE ?? (isProd ? '' : 'mock');
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
      app_role?: Role;
      app_metadata?: { role?: Role };
      user_role?: Role;
      aal?: string;
    };
    return { role: payload.app_role ?? payload.app_metadata?.role ?? payload.user_role ?? null, aal: payload.aal ?? null };
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

  // Production must never run with the mock adapter or an unset/unknown
  // data-source setting. Fail closed before serving any application route.
  if (isProd && DATA_SOURCE !== 'supabase') {
    return withHeaders(new NextResponse('BazarHQ is temporarily unavailable because production data access is not configured.', { status: 503 }), admin);
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
