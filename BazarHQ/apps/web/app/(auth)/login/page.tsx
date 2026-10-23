'use client';

import { Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { DEMO_ACCOUNTS, ROLE_HOME, type Session } from '@bazarhq/shared';
import { CustomerLogin } from '@bazarhq/ui';
import { customerPaths } from '@/lib/paths';
import { showDemoTools } from '@/lib/services';

function Login() {
  const next = useSearchParams().get('next');
  const routeAfter = useCallback((s: Session, n?: string | null) => {
    if (s.user.role === 'merchant') return ROLE_HOME.merchant;
    // Only same-site relative paths are honoured (no open redirects).
    return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/merchant') && !n.startsWith('/admin') ? n : customerPaths.account;
  }, []);
  return <CustomerLogin next={next} routeAfter={routeAfter} demoAccounts={showDemoTools ? DEMO_ACCOUNTS.filter((a) => a.role !== 'super_admin') : undefined} />;
}

export default function LoginPage() {
  return (
    <>
      <title>Sign in · BazarHQ</title>
      <Suspense>
        <Login />
      </Suspense>
    </>
  );
}
