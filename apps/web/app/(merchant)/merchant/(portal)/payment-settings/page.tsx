'use client';

import { ShieldCheck } from 'lucide-react';
import { Alert, Card, ErrorState, PageHeader, PaymentMethodCard, Skeleton, useAsync, useServices, useSession } from '@bazarhq/ui';

export default function PaymentSettingsPage() {
  const services = useServices();
  const { session } = useSession();
  const configs = useAsync(() => services.payments.list(), []);
  const enabled = configs.data?.filter((c) => c.isEnabled).length ?? 0;

  return (
    <>
      <title>Payment settings · BazarHQ Merchant</title>
      <PageHeader title="Payment settings" description="Choose how customers can pay. Changes apply to new orders only." />
      <div className="space-y-4">
        <Alert tone="info" title="Sandbox mode">
          BazarHQ is in development, so only sandbox/test credentials are accepted. Credentials are validated and encrypted by a secure server function; this
          page never stores or displays them.
        </Alert>
        {configs.data && enabled === 0 && (
          <Alert tone="warning" title="No payment method enabled">
            Your store can’t be published until at least one payment method is enabled
            {session?.store?.status === 'published' ? '.' : '. Cash on Delivery needs no credentials.'}
          </Alert>
        )}
        {configs.loading ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-40 rounded-[var(--radius-card)]" />
            ))}
          </div>
        ) : configs.error ? (
          <Card>
            <ErrorState message={configs.error} onRetry={configs.reload} />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {configs.data!.map((c) => (
              <PaymentMethodCard
                key={c.method}
                config={c}
                onChange={(nc) => configs.setData((list) => (list ?? []).map((x) => (x.method === nc.method ? nc : x)))}
              />
            ))}
          </div>
        )}
        <p className="flex items-start gap-2 text-[12.5px] text-ink-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
          Online payments are confirmed only by server-side verification or a signed gateway callback — never by the customer’s redirect or a transaction ID
          they type in.
        </p>
      </div>
    </>
  );
}
