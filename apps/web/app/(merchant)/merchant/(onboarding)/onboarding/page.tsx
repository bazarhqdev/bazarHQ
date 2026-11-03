'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Rocket, Store } from 'lucide-react';
import { errorMessage, storefrontUrl } from '@bazarhq/shared';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  CardHeader,
  ErrorState,
  OnboardingChecklist,
  SkeletonRows,
  Stepper,
  StoreStatusBadge,
  useAsync,
  useServices,
  useSession,
  useToast,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

export default function OnboardingPage() {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const { session, refresh } = useSession();
  const store = session?.store ?? null;
  const progress = useAsync(() => services.store.getOnboarding(), [store?.id, store?.status]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!store) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <title>Welcome · BazarHQ Merchant</title>
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Store className="size-8" aria-hidden />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Welcome{session ? `, ${session.user.fullName.split(' ')[0]}` : ''}! Let’s create your store.
        </h1>
        <p className="mt-2 text-ink-muted">Setup takes about 10 minutes. Your progress is saved after each step, so you can come back any time.</p>
        <ol className="mx-auto mt-8 grid max-w-md gap-3 text-left">
          {[
            ['Store details', 'Name, address (subdomain) and category'],
            ['Theme & branding', 'Logo, banner, theme and brand colour'],
            ['Go live', 'Enable a payment method, add a product, publish'],
          ].map(([t, d], i) => (
            <li key={t} className="flex items-start gap-3 rounded-xl border border-line bg-white p-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[12px] font-bold text-white">{i + 1}</span>
              <span>
                <span className="block text-sm font-semibold text-ink">{t}</span>
                <span className="text-[13px] text-ink-muted">{d}</span>
              </span>
            </li>
          ))}
        </ol>
        <Link href={paths.onboardingStore} className={buttonClass('brand', 'lg', 'mt-8')}>
          Create my store
        </Link>
      </div>
    );
  }

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      await services.store.publish();
      await refresh();
      toast.success('Your store is live!', storefrontUrl(store.subdomain));
      router.push(paths.dashboard);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <title>Store setup · BazarHQ Merchant</title>
      <Stepper steps={['Store details', 'Theme & branding', 'Go live']} current={2} />
      <div className="mt-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Finish setting up {store.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {storefrontUrl(store.subdomain)} <StoreStatusBadge status={store.status} />
        </p>
      </div>
      <Card className="mt-6">
        <CardHeader title="Setup checklist" description="Your store can be published when every step is complete and at least one payment method is enabled." />
        <div className="px-5 pb-5">
          {progress.loading ? (
            <SkeletonRows rows={4} />
          ) : progress.error ? (
            <ErrorState message={progress.error} onRetry={progress.reload} />
          ) : progress.data ? (
            <OnboardingChecklist progress={progress.data} />
          ) : null}
        </div>
      </Card>
      {error && (
        <Alert tone="warning" className="mt-4">
          {error}
        </Alert>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {store.status === 'published' ? (
          <Link href={paths.dashboard} className={buttonClass('primary', 'lg')}>
            Go to dashboard
          </Link>
        ) : (
          <>
            <Button
              variant="brand"
              size="lg"
              icon={<Rocket className="size-4" aria-hidden />}
              loading={publishing}
              disabled={!progress.data?.publishable}
              onClick={() => void publish()}
            >
              Publish store
            </Button>
            <Link href={paths.dashboard} className={buttonClass('secondary', 'lg')}>
              Continue to dashboard
            </Link>
          </>
        )}
      </div>
      {!progress.data?.publishable && store.status !== 'published' && (
        <p className="mt-2 text-[13px] text-ink-muted">Publishing unlocks at 100%. You can keep working in the dashboard meanwhile.</p>
      )}
    </div>
  );
}
