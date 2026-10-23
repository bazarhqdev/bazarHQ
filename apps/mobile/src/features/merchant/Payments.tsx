import { Alert, ErrorState, PaymentMethodCard, Skeleton, useAsync, useServices } from '@bazarhq/ui';
import { Screen } from '@/components/Screen';

export function PaymentsScreen() {
  const services = useServices();
  const configs = useAsync(() => services.payments.list(), []);
  return (
    <Screen title="Payment settings" back onRefresh={configs.reload}>
      <Alert tone="info">Sandbox credentials only during development. Credentials are encrypted by a server function and never stored in the app.</Alert>
      <div className="mt-3 space-y-3">
        {configs.loading ? (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-36 rounded-[var(--radius-card)]" />)
        ) : configs.error ? (
          <ErrorState message={configs.error} onRetry={configs.reload} />
        ) : (
          configs.data!.map((c) => (
            <PaymentMethodCard key={c.method} config={c} onChange={(nc) => configs.setData((l) => (l ?? []).map((x) => (x.method === nc.method ? nc : x)))} />
          ))
        )}
      </div>
      <p className="mt-3 text-[12px] text-ink-subtle">Changes apply to new orders only. A published store needs at least one enabled method.</p>
    </Screen>
  );
}
