'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { LoaderCircle, ShieldAlert, ShieldX } from 'lucide-react';
import { BazarLogo, Button, useSession } from '@bazarhq/ui';
import { paths } from '@/lib/paths';

type Decision = 'loading' | 'login' | 'forbidden' | 'suspended' | 'verify' | 'onboarding' | 'ok';

/**
 * Role-aware route guard. This is a UX control only (AUTHZ-03): every service
 * call is authorized again by the server / RLS. In the Supabase build this is
 * complemented by a server-side session check (see README → Security).
 */
export function MerchantGuard({ requireStore = true, children }: { requireStore?: boolean; children: ReactNode }) {
  const { session, status, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  let decision: Decision = 'ok';
  if (status === 'loading') decision = 'loading';
  else if (!session) decision = 'login';
  else if (session.user.role !== 'merchant') decision = 'forbidden';
  else if (session.user.status === 'suspended') decision = 'suspended';
  else if (!session.user.emailVerified) decision = 'verify';
  else if (requireStore && !session.store) decision = 'onboarding';

  useEffect(() => {
    if (decision === 'login') router.replace(`${paths.login}?next=${encodeURIComponent(pathname)}`);
    if (decision === 'verify') router.replace(paths.verifyEmail);
    if (decision === 'onboarding') router.replace(paths.onboarding);
  }, [decision, pathname, router]);

  if (decision === 'ok') return <>{children}</>;

  if (decision === 'forbidden' || decision === 'suspended') {
    const forbidden = decision === 'forbidden';
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <BazarLogo subtitle="Merchant" />
        <div className="mt-8 flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          {forbidden ? <ShieldX className="size-7" aria-hidden /> : <ShieldAlert className="size-7" aria-hidden />}
        </div>
        <p className="mt-4 text-sm font-semibold text-red-700">{forbidden ? '403 — Access denied' : 'Account suspended'}</p>
        <h1 className="mt-1 text-2xl font-bold text-ink">{forbidden ? 'This area is for merchant accounts' : 'Your merchant account is suspended'}</h1>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          {forbidden
            ? `You're signed in as ${session?.user.email}, which isn't a merchant account. Sign out and use your merchant login.`
            : (session?.user.suspensionReason ?? 'Contact BazarHQ support for details.')}
        </p>
        <Button className="mt-6" variant="primary" onClick={() => void signOut().then(() => router.replace(paths.login))}>
          Sign out
        </Button>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
      <LoaderCircle className="size-6 animate-spin text-brand-600" aria-hidden />
      <span className="sr-only">Checking your session…</span>
    </div>
  );
}
