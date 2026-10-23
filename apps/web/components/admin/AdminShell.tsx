'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  Activity,
  Banknote,
  Bell,
  Gavel,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  Palette,
  ScrollText,
  ShieldCheck,
  ShoppingBag,
  Store,
  User,
  Users,
  X,
  FileText,
} from 'lucide-react';
import { BazarLogo, cn, useServices, useSession, useUnreadCount } from '@bazarhq/ui';
import { adminPaths as a } from '@/lib/paths';
import { getMockDevTools, showDemoTools } from '@/lib/services';

const NAV: { group: string; items: { href: string; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    group: 'Overview',
    items: [
      { href: a.dashboard, label: 'Dashboard', icon: LayoutDashboard },
      { href: a.systemHealth, label: 'System health', icon: Activity },
    ],
  },
  {
    group: 'Accounts',
    items: [
      { href: a.merchants, label: 'Merchants', icon: Users },
      { href: a.customers, label: 'Customers', icon: User },
      { href: a.stores, label: 'Stores', icon: Store },
      { href: a.orders, label: 'Orders', icon: ShoppingBag },
    ],
  },
  {
    group: 'Platform',
    items: [
      { href: a.themes, label: 'Themes', icon: Palette },
      { href: a.announcements, label: 'Announcements', icon: Megaphone },
      { href: a.policies, label: 'Policies', icon: FileText },
    ],
  },
  {
    group: 'Resolution',
    items: [
      { href: a.support, label: 'Support', icon: LifeBuoy },
      { href: a.disputes, label: 'Disputes', icon: Gavel },
      { href: a.refunds, label: 'Refunds', icon: Banknote },
    ],
  },
  { group: 'Security', items: [{ href: a.auditLogs, label: 'Audit log', icon: ScrollText }] },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="space-y-5">
      {NAV.map((g) => (
        <div key={g.group}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-300">{g.group}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                      active ? 'bg-white/10 text-white' : 'text-navy-100 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <it.icon className="size-4" aria-hidden /> {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const services = useServices();
  const router = useRouter();
  const { session, setSession } = useSession();
  const unread = useUnreadCount();
  const [drawer, setDrawer] = useState(false);
  const dev = showDemoTools ? getMockDevTools() : null;
  const signOut = async () => {
    await services.adminAuth.signOut().catch(() => undefined);
    setSession(null);
    router.replace(a.login);
  };
  const sidebar = (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <Link href={a.dashboard} className="px-3">
        <BazarLogo tone="light" subtitle="Super Admin" />
      </Link>
      <div className="flex-1 overflow-y-auto">
        <Nav onNavigate={() => setDrawer(false)} />
      </div>
      <div className="rounded-xl bg-white/5 p-3 text-[12px] text-navy-200">
        <p className="flex items-center gap-1.5 font-semibold text-white">
          <ShieldCheck className="size-3.5 text-brand-300" aria-hidden /> TOTP verified
        </p>
        <p className="mt-0.5 font-mono">{session?.admin?.ip}</p>
        <p className="mt-0.5">Auto sign-out after 30 idle minutes</p>
      </div>
    </div>
  );
  return (
    <div className="min-h-dvh bg-canvas lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-64 bg-navy-950 lg:block">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-navy-950">
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
        <span className="rounded-md bg-navy-900 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Admin</span>
        {dev && (
          <button
            type="button"
            className="hidden rounded-md border border-dashed border-line-strong px-2 py-0.5 text-[11.5px] font-semibold text-ink-muted hover:bg-canvas sm:inline"
            onClick={() => dev.expireAdminSession()}
            title="Demo: age the session past the idle limit; the next request is rejected"
          >
            Demo: expire session
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Link
            href={a.notifications}
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
          <Link href={a.profile} className="hidden items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-ink hover:bg-navy-50 sm:flex">
            <User className="size-4" aria-hidden /> {session?.user.fullName}
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-ink-muted hover:bg-navy-50 hover:text-ink"
          >
            <LogOut className="size-4" aria-hidden /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
