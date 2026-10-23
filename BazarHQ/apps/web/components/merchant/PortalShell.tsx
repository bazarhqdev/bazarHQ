'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  Boxes,
  ChevronDown,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Package,
  RotateCcw,
  Settings,
  ShoppingBag,
  Sparkles,
  User,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { storefrontUrl } from '@bazarhq/shared';
import { Avatar, BazarLogo, cn, StoreStatusBadge, useOnlineStatus, useSession, useToast, useUnreadCount } from '@bazarhq/ui';
import { paths } from '@/lib/paths';
import { getMockDevTools, showDemoTools } from '@/lib/services';

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; group?: string }[] = [
  { href: paths.dashboard, label: 'Dashboard', icon: LayoutDashboard },
  { href: paths.products, label: 'Products', icon: Package },
  { href: paths.inventory, label: 'Inventory', icon: Boxes },
  { href: paths.orders, label: 'Orders', icon: ShoppingBag },
  { href: paths.returns, label: 'Returns', icon: RotateCcw },
  { href: paths.customers, label: 'Customers', icon: Users },
  { href: paths.analytics, label: 'Analytics', icon: BarChart3 },
  { href: paths.support, label: 'Support', icon: LifeBuoy, group: 'Engage' },
  { href: paths.notifications, label: 'Notifications', icon: Bell, group: 'Engage' },
  { href: paths.paymentSettings, label: 'Payment settings', icon: CreditCard, group: 'Settings' },
  { href: paths.storeSettings, label: 'Store settings', icon: Settings, group: 'Settings' },
];

function NavLinks({ onNavigate, unread }: { onNavigate?: () => void; unread: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Merchant" className="flex flex-col gap-0.5">
      {NAV.map((item, i) => {
        const active = pathname === item.href || (item.href !== paths.dashboard && pathname.startsWith(item.href));
        const header = item.group && item.group !== NAV[i - 1]?.group ? item.group : null;
        const Icon = item.icon;
        return (
          <div key={item.href}>
            {header && <p className="mt-4 mb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-white/40">{header}</p>}
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                active ? 'bg-white/12 text-white shadow-[inset_3px_0_0_var(--color-brand-400)]' : 'text-white/70 hover:bg-white/6 hover:text-white',
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.href === paths.notifications && unread > 0 && (
                <span className="rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white tabular">
                  {unread}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

function DemoTools() {
  const toast = useToast();
  const { refresh } = useSession();
  const dev = getMockDevTools();
  if (!dev || !showDemoTools) return null;
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/50">
        <Sparkles className="size-3.5" aria-hidden /> Demo data
      </p>
      <div className="mt-2 flex flex-col gap-1">
        <button
          type="button"
          className="rounded-md px-2 py-1.5 text-left text-[12.5px] font-semibold text-white/80 hover:bg-white/10"
          onClick={async () => {
            await dev.simulateIncomingOrder();
            toast.info('New order received', 'A simulated customer order just arrived.');
          }}
        >
          Simulate new order
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] font-semibold text-white/80 hover:bg-white/10"
          onClick={async () => {
            dev.reset();
            await refresh();
            window.location.assign(paths.login);
          }}
        >
          <RotateCcw className="size-3.5" aria-hidden /> Reset demo data
        </button>
      </div>
    </div>
  );
}

function UserMenu() {
  const { session, signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!session) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-navy-50"
      >
        <Avatar name={session.user.fullName} src={session.user.avatarUrl} size={32} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-[13px] font-semibold text-ink">{session.user.fullName}</span>
          <span className="block text-[11px] text-ink-subtle">Merchant</span>
        </span>
        <ChevronDown className="size-4 text-ink-subtle" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-52 animate-fade-in rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-pop)]">
          <Link
            role="menuitem"
            href={paths.profile}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-canvas"
          >
            <User className="size-4" aria-hidden /> Profile & security
          </Link>
          <Link
            role="menuitem"
            href={paths.storeSettings}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-canvas"
          >
            <Settings className="size-4" aria-hidden /> Store settings
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              await signOut();
              router.replace(paths.login);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function PortalShell({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const unread = useUnreadCount();
  const online = useOnlineStatus();
  const [drawer, setDrawer] = useState(false);
  const store = session?.store;

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 px-3 py-4">
      <div className="px-2">
        <BazarLogo tone="light" subtitle="Merchant portal" />
      </div>
      <div className="mt-6 flex-1 overflow-y-auto">
        <NavLinks unread={unread} onNavigate={() => setDrawer(false)} />
        <DemoTools />
      </div>
      {store && (
        <a
          href={storefrontUrl(store.subdomain)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[12.5px] font-semibold text-white/80 hover:bg-white/5"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="truncate">{store.subdomain}.bazarhq.com</span>
        </a>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setDrawer(false)} aria-hidden />
          <div className="relative h-full w-72 max-w-[85vw] animate-slide-up">
            {sidebar}
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 rounded-lg p-1.5 text-white/80 hover:bg-white/10"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
        <button type="button" className="rounded-lg p-2 text-ink hover:bg-navy-50 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
          <Menu className="size-5" aria-hidden />
        </button>
        {store && (
          <div className="flex min-w-0 items-center gap-2">
            {store.logoUrl ? (
              <img src={store.logoUrl} alt="" className="size-8 rounded-lg object-cover" />
            ) : (
              <span
                className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ background: store.brandColour }}
                aria-hidden
              >
                {store.name.charAt(0)}
              </span>
            )}
            <span className="truncate text-sm font-bold text-ink">{store.name}</span>
            <StoreStatusBadge status={store.status} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Link
            href={paths.notifications}
            className="relative rounded-lg p-2 text-ink-muted hover:bg-navy-50 hover:text-ink"
            aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          >
            <Bell className="size-5" aria-hidden />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {unread}
              </span>
            )}
          </Link>
          <UserMenu />
        </div>
      </header>
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-[13px] font-semibold text-amber-900" role="status">
          <WifiOff className="size-4" aria-hidden /> You’re offline. Showing the last loaded data — changes need a connection.
        </div>
      )}
      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
