import { useEffect, type ReactNode } from 'react';
import { Link, matchPath, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Boxes, House, LoaderCircle, Menu, Package, ShieldX, ShoppingBag, WifiOff } from 'lucide-react';
import { BazarLogo, Button, cn, useOnlineStatus, useSession, useUnreadCount } from '@bazarhq/ui';
import { onAppResume, onDeepLink, onHardwareBack } from '@/services/native';
import { paths, ROLE_START, ROOT_SCREENS } from '@/navigation/paths';

const TABS = [
  { to: paths.dashboard, label: 'Home', icon: House },
  { to: paths.products, label: 'Products', icon: Package },
  { to: paths.orders, label: 'Orders', icon: ShoppingBag },
  { to: paths.inventory, label: 'Inventory', icon: Boxes },
  { to: paths.analytics, label: 'Analytics', icon: BarChart3 },
  { to: '/more', label: 'More', icon: Menu },
];

/** Hide the tab bar on full-screen forms with their own sticky actions. */
const NO_TAB_BAR = ['/products/new', '/products/:id', '/support/:id'];

export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3" role="status">
      <LoaderCircle className="size-7 animate-spin text-brand-600" aria-hidden />
      <span className="text-sm text-ink-muted">{label}</span>
    </div>
  );
}

/** Android back button + resume refresh, mounted once for the whole app. */
export function NativeBridge() {
  const location = useLocation();
  const navigate = useNavigate();
  const { refresh } = useSession();
  useEffect(
    () =>
      onHardwareBack(() => {
        if (ROOT_SCREENS.includes(location.pathname)) return false; // exit app
        navigate(-1);
        return true;
      }),
    [location.pathname, navigate],
  );
  useEffect(() => onAppResume(() => void refresh()), [refresh]);
  // MOB-07: store, product and tracking links open the matching screen.
  useEffect(() => onDeepLink((route) => navigate(route)), [navigate]);
  return null;
}

/** UX guard only; the service layer / server enforces authorization (AUTHZ-03). */
export function Guard({ requireStore = true, children }: { requireStore?: boolean; children: ReactNode }) {
  const { session, status, signOut } = useSession();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader label="Checking your session…" />;
  if (!session) return <Navigate to={paths.login} replace state={{ from: location.pathname }} />;
  if (session.user.role !== 'merchant') return <Navigate to={ROLE_START[session.user.role]} replace />;
  if (session.user.status === 'suspended') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <BazarLogo subtitle="Merchant" />
        <ShieldX className="mt-8 size-10 text-red-600" aria-hidden />
        <h1 className="mt-3 text-xl font-bold">Account suspended</h1>
        <p className="mt-2 text-sm text-ink-muted">{session.user.suspensionReason}</p>
        <Button className="mt-6" onClick={() => void signOut()}>
          Sign out
        </Button>
      </main>
    );
  }
  if (!session.user.emailVerified) return <Navigate to={paths.verifyEmail} replace />;
  if (requireStore && !session.store) return <Navigate to={paths.onboarding} replace />;
  return <>{children}</>;
}

export function TabLayout() {
  const location = useLocation();
  const online = useOnlineStatus();
  const unread = useUnreadCount();
  const hideTabs = NO_TAB_BAR.some((p) => matchPath(p, location.pathname));
  return (
    <div className={cn('min-h-dvh', !hideTabs && 'pb-[calc(64px+env(safe-area-inset-bottom))]')}>
      {!online && (
        <div
          className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-amber-100 px-3 pt-[env(safe-area-inset-top)] text-[12.5px] font-semibold text-amber-900"
          role="status"
        >
          <span className="flex items-center gap-1.5 py-1.5">
            <WifiOff className="size-4" aria-hidden /> Offline — showing saved data. Changes need a connection.
          </span>
        </div>
      )}
      <Outlet />
      {!hideTabs && (
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
          <ul className="mx-auto grid h-16 max-w-2xl grid-cols-6">
            {TABS.map((t) => (
              <li key={t.to}>
                <NavLink
                  to={t.to}
                  className={({ isActive }) =>
                    cn(
                      'relative flex h-full flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold',
                      isActive || (t.to === '/more' && isMoreRoute(location.pathname)) ? 'text-brand-700' : 'text-ink-subtle',
                    )
                  }
                >
                  <t.icon className="size-[22px]" aria-hidden />
                  {t.label}
                  {t.to === '/more' && unread > 0 && (
                    <span className="absolute right-[22%] top-2 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 text-white">
                      {unread}
                      <span className="sr-only"> unread notifications</span>
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

function isMoreRoute(p: string) {
  return ['/more', '/payments', '/notifications', '/support', '/settings', '/returns'].some((r) => p === r || p.startsWith(`${r}/`));
}

export function MenuLink({ to, icon, label, hint, badge }: { to: string; icon: ReactNode; label: string; hint?: string; badge?: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 active:bg-canvas">
      <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        {hint && <span className="block truncate text-[12.5px] text-ink-muted">{hint}</span>}
      </span>
      {badge}
      <span className="text-ink-subtle" aria-hidden>
        ›
      </span>
    </Link>
  );
}
