'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BazarLogo, Button, useSession } from '@bazarhq/ui';
import { MerchantGuard } from '@/components/merchant/MerchantGuard';
import { paths } from '@/lib/paths';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { session, signOut } = useSession();
  const router = useRouter();
  return (
    <MerchantGuard requireStore={false}>
      <div className="min-h-dvh">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
            <Link href={session?.store ? paths.dashboard : paths.onboarding} aria-label="BazarHQ home">
              <BazarLogo subtitle="Store setup" />
            </Link>
            <div className="flex items-center gap-2">
              {session?.store && (
                <Link href={paths.dashboard} className="hidden text-sm font-semibold text-navy-800 hover:underline sm:inline">
                  Go to dashboard
                </Link>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await signOut();
                  router.replace(paths.login);
                }}
              >
                Sign out
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      </div>
    </MerchantGuard>
  );
}
