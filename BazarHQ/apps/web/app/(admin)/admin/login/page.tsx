'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { DEMO_ACCOUNTS } from '@bazarhq/shared';
import { AdminLogin, type AdminDemoTools } from '@bazarhq/ui';
import { getMockDevTools, showDemoTools } from '@/lib/services';

function Login() {
  const expired = useSearchParams().get('expired') === '1';
  const demo = useMemo<AdminDemoTools | null>(() => {
    const dev = showDemoTools ? getMockDevTools() : null;
    if (!dev) return null;
    return {
      accounts: DEMO_ACCOUNTS.filter((a) => a.role === 'super_admin'),
      totpCode: dev.demoTotpCode,
      network: () => dev.adminNetwork(),
      setNetwork: (n) => dev.setAdminNetwork(n),
      expireSession: () => dev.expireAdminSession(),
    };
  }, []);
  return <AdminLogin demo={demo} expired={expired} />;
}

export default function AdminLoginPage() {
  return (
    <>
      <title>Admin sign in · BazarHQ</title>
      <Suspense>
        <Login />
      </Suspense>
    </>
  );
}
