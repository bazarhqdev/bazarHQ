'use client';

import { usePathname } from 'next/navigation';
import { RequireCustomer } from '@bazarhq/ui';
import { AccountNav } from '@/components/customer/SiteChrome';
import { customerPaths } from '@/lib/paths';

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <RequireCustomer loginHref={customerPaths.login(pathname)}>
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <AccountNav />
        <main className="min-w-0">{children}</main>
      </div>
    </RequireCustomer>
  );
}
