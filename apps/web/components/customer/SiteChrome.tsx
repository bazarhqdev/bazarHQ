'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Search, ShoppingCart, User } from 'lucide-react';
import { BazarLogo, cn, customerNav, useCartCount, useSession } from '@bazarhq/ui';
import { customerPaths as p } from '@/lib/paths';

/** Root-site header for discovery, tracking, auth and the customer account. */
export function SiteHeader() {
  const count = useCartCount();
  const { session, signOut } = useSession();
  const customer = session?.user.role === 'customer' ? session : null;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
        <Link href={p.home} aria-label="BazarHQ home" className="mr-2">
          <BazarLogo />
        </Link>
        <nav aria-label="Main" className="ml-auto flex items-center gap-1">
          <Link
            href={p.stores()}
            className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-canvas hover:text-ink sm:inline-flex"
          >
            <Search className="size-4" aria-hidden /> Find stores
          </Link>
          <Link href={p.track()} className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-canvas hover:text-ink sm:inline-flex">
            Track order
          </Link>
          <Link
            href={p.carts}
            aria-label={`Carts, ${count} items`}
            className="relative inline-flex size-10 items-center justify-center rounded-lg text-ink hover:bg-canvas"
          >
            <ShoppingCart className="size-5" aria-hidden />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
                {count}
              </span>
            )}
          </Link>
          {customer ? (
            <>
              <Link href={p.account} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-ink hover:bg-canvas">
                <User className="size-4" aria-hidden /> <span className="hidden sm:inline">{customer.user.fullName.split(' ')[0]}</span>
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                aria-label="Sign out"
                className="inline-flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-canvas hover:text-ink"
              >
                <LogOut className="size-4" aria-hidden />
              </button>
            </>
          ) : (
            <Link href={p.login()} className="inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} BazarHQ · Multi-merchant commerce for Bangladesh</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-4">
          <Link href={p.policy('tos')} className="hover:text-ink">
            Terms
          </Link>
          <Link href={p.policy('privacy')} className="hover:text-ink">
            Privacy
          </Link>
          <Link href={p.track()} className="hover:text-ink">
            Track order
          </Link>
          <Link href={p.merchantLogin} className="hover:text-ink">
            For merchants
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** Customer account side navigation (horizontal scroller on small screens). */
export function AccountNav() {
  const pathname = usePathname();
  const items = customerNav(p);
  const active = (href: string) => (href === p.account ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Account" className="lg:sticky lg:top-24 lg:self-start">
      <ul className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:overflow-visible">
        {items.map((it) => (
          <li key={it.href} className="shrink-0">
            <Link
              href={it.href}
              aria-current={active(it.href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold',
                active(it.href) ? 'bg-white text-ink shadow-[var(--shadow-card)] ring-1 ring-line' : 'text-ink-muted hover:bg-white hover:text-ink',
              )}
            >
              <it.icon className="size-4" aria-hidden /> {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
