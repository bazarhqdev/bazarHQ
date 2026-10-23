import { useState, type ReactNode } from 'react';
import { PullToRefresh } from '@/components/Screen';
import { Link, matchPath, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  LogIn,
  House,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  ScrollText,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  User,
  Users,
  WifiOff,
} from 'lucide-react';
import { BazarLogo, cn, RequireAdmin, useOnlineStatus, useSession, useUnreadCount } from '@bazarhq/ui';
import { adminPaths as a, customerPaths as c, ROLE_START } from '@/navigation/paths';
import { FullScreenLoader } from '@/navigation/Shell';

type Tab = { to: string; label: string; icon: typeof House; end?: boolean; badge?: number };

function TabBar({ tabs, activeFor }: { tabs: Tab[]; activeFor?: (tab: Tab, path: string) => boolean }) {
  const location = useLocation();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid h-16 max-w-2xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'relative flex h-full flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold',
                  isActive || activeFor?.(t, location.pathname) ? 'text-brand-700' : 'text-ink-subtle',
                )
              }
            >
              <t.icon className="size-[22px]" aria-hidden />
              {t.label}
              {Boolean(t.badge) && (
                <span className="absolute right-[24%] top-2 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 text-white">{t.badge}</span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function OfflineBar() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      className="sticky top-0 z-40 flex items-center justify-center gap-1.5 bg-amber-100 px-3 py-1.5 pt-[calc(env(safe-area-inset-top)+6px)] text-[12.5px] font-semibold text-amber-900"
      role="status"
    >
      <WifiOff className="size-4" aria-hidden /> Offline — some screens need a connection.
    </div>
  );
}

/**
 * Pull-to-refresh for shared screens: re-mounting the routed screen re-runs its
 * data loaders (they read through the service layer, never cached UI state).
 */
function RefreshableOutlet() {
  const [generation, setGeneration] = useState(0);
  return (
    <PullToRefresh
      onRefresh={async () => {
        setGeneration((g) => g + 1);
        await new Promise((r) => setTimeout(r, 450));
      }}
    >
      <div key={generation}>
        <Outlet />
      </div>
    </PullToRefresh>
  );
}

/** Customer tab bar; screens under /c/s/<store> show the store’s own header instead. */
export function CustomerTabLayout() {
  const location = useLocation();
  const { session } = useSession();
  const unread = useUnreadCount();
  const inStore = Boolean(matchPath('/c/s/:sub/*', location.pathname));
  const fullScreen = ['/c/s/:sub/checkout', '/c/pay/ssl'].some((p) => matchPath(p, location.pathname));
  const signedIn = session?.user.role === 'customer';
  // Spec: Home · Stores · Orders · Notifications · Profile. Signed-out taps go to sign-in, then back.
  const tabs: Tab[] = [
    { to: c.home, label: 'Home', icon: House, end: true },
    { to: c.stores(), label: 'Stores', icon: Search },
    { to: signedIn ? c.orders : c.login(c.orders), label: 'Orders', icon: ShoppingBag },
    { to: signedIn ? c.notifications : c.login(c.notifications), label: 'Notifications', icon: Bell, badge: signedIn ? unread : 0 },
    { to: signedIn ? c.account : c.login(c.account), label: 'Profile', icon: User },
  ];
  return (
    <div className={cn('min-h-dvh bg-canvas', !fullScreen && 'pb-[calc(64px+env(safe-area-inset-bottom))]', !inStore && 'pt-[env(safe-area-inset-top)]')}>
      <OfflineBar />
      {fullScreen ? <Outlet /> : <RefreshableOutlet />}
      {!fullScreen && (
        <TabBar
          tabs={tabs}
          activeFor={(t, p) =>
            (t.label === 'Stores' && (p.startsWith('/c/s/') || p === '/c/cart')) ||
            (t.label === 'Profile' && ['/c/returns', '/c/support', '/c/profile', '/c/addresses'].some((r) => p.startsWith(r)))
          }
        />
      )}
    </div>
  );
}

/** Super Admin stack: guard (network + TOTP + 30-min idle) and tab bar. */
export function AdminTabLayout() {
  const unread = useUnreadCount();
  // Spec: Home · Merchants · Stores · Support · Audit Logs · More
  const tabs: Tab[] = [
    { to: a.dashboard, label: 'Home', icon: LayoutDashboard },
    { to: a.merchants, label: 'Merchants', icon: Users },
    { to: a.stores, label: 'Stores', icon: Store },
    { to: a.support, label: 'Support', icon: LifeBuoy },
    { to: a.auditLogs, label: 'Audit Logs', icon: ScrollText },
    { to: '/a/more', label: 'More', icon: Menu, badge: unread },
  ];
  return (
    <RequireAdmin>
      <div className="min-h-dvh bg-canvas pb-[calc(64px+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
        <OfflineBar />
        <RefreshableOutlet />
        <TabBar
          tabs={tabs}
          activeFor={(t, p) =>
            t.to === '/a/more' &&
            [
              '/a/health',
              '/a/customers',
              '/a/orders',
              '/a/themes',
              '/a/announcements',
              '/a/policies',
              '/a/refunds',
              '/a/disputes',
              '/a/notifications',
              '/a/profile',
            ].some((r) => p.startsWith(r))
          }
        />
      </div>
    </RequireAdmin>
  );
}

/** Padding wrapper for shared screens that render their own page header. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-3xl px-4 py-4', className)}>{children}</div>;
}

/** `/` — send each signed-in role to its own stack; guests choose. */
export function RoleHome() {
  const { session, status } = useSession();
  if (status === 'loading') return <FullScreenLoader label="Starting BazarHQ…" />;
  if (session && (session.user.role !== 'super_admin' || session.admin?.mfaVerified)) return <Navigate to={ROLE_START[session.user.role]} replace />;
  return <Navigate to="/welcome" replace />;
}

export function WelcomeScreen() {
  const items = [
    { to: c.home, icon: ShoppingBag, title: 'Shop', text: 'Find a store, check out and track orders. No account needed.' },
    { to: '/login', icon: Store, title: 'Sell', text: 'Manage your store, products, orders and payments.' },
    { to: c.login(), icon: LogIn, title: 'Sign in', text: 'Already have an account? We’ll open the right app for your role.' },
    { to: '/a/network', icon: ShieldCheck, title: 'Platform admin', text: 'BazarHQ staff only — approved network and TOTP required.' },
  ];
  return (
    <main className="flex min-h-dvh flex-col bg-navy-950 px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[calc(40px+env(safe-area-inset-top))] text-white">
      <BazarLogo tone="light" />
      <h1 className="mt-10 text-3xl font-extrabold leading-tight">Bangladesh’s stores, in your pocket.</h1>
      <p className="mt-2 text-navy-100">How would you like to use BazarHQ?</p>
      <ul className="mt-8 space-y-3">
        {items.map((it) => (
          <li key={it.to}>
            <Link to={it.to} className="flex items-center gap-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 active:bg-white/10">
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand-500/15 text-brand-300">
                <it.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-bold">{it.title}</span>
                <span className="block text-[13px] text-navy-200">{it.text}</span>
              </span>
              <ArrowRight className="size-5 text-navy-300" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-8 text-center text-[12px] text-navy-300">v0.2.0 · Android</p>
    </main>
  );
}
