'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { NavigationProvider, ServicesProvider, SessionProvider, ToastProvider, type AppLinkComponent } from '@bazarhq/ui';
import { getServices } from '@/lib/services';
import { adminPaths, customerPaths, paths } from '@/lib/paths';

const AppLink: AppLinkComponent = ({ href, children, ...rest }) => (
  <Link href={href} {...rest}>
    {children}
  </Link>
);

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const navigate = useCallback((href: string, opts?: { replace?: boolean }) => (opts?.replace ? router.replace(href) : router.push(href)), [router]);
  return (
    <ServicesProvider services={getServices()}>
      <NavigationProvider Link={AppLink} navigate={navigate} paths={paths} customerPaths={customerPaths} adminPaths={adminPaths} platform="web">
        <ToastProvider>
          <SessionProvider>{children}</SessionProvider>
        </ToastProvider>
      </NavigationProvider>
    </ServicesProvider>
  );
}
