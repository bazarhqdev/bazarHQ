'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { DISPUTE_STATUS_LABEL, formatBDT, formatRelative, RETURN_REASON_LABEL, RETURN_STATUS_LABEL, RETURN_STATUSES, type ReturnStatus } from '@bazarhq/shared';
import {
  Badge,
  Card,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  ReturnPanel,
  ReturnStatusBadge,
  SearchInput,
  SkeletonRows,
  Tabs,
  useAsync,
  useDebounced,
  useServiceEvents,
  useServices,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

function ReturnsView() {
  const services = useServices();
  const router = useRouter();
  const pathname = usePathname();
  const selected = useSearchParams().get('return');
  const [status, setStatus] = useState<ReturnStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useAsync(() => services.returns.list({ status, search: q }), [status, q]);
  const all = useAsync(() => services.returns.list(), [list.data]);
  useServiceEvents(() => void list.reload());
  const count = (s: ReturnStatus | 'all') => (all.data ? (s === 'all' ? all.data.length : all.data.filter((r) => r.status === s).length) : undefined);
  const open = (id: string | null) => router.replace(id ? `${pathname}?return=${id}` : pathname, { scroll: false });

  return (
    <>
      <title>Returns · BazarHQ Merchant</title>
      <PageHeader title="Returns & refunds" description="Review return requests, confirm receipt and record refunds. Customers are notified at every step." />
      <Card className="overflow-hidden">
        <div className="grid min-h-[560px] grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className={cn('border-line lg:border-r', selected && 'hidden lg:block')}>
            <div className="space-y-3 border-b border-line p-4">
              <Tabs
                label="Return status"
                value={status}
                onChange={setStatus}
                items={[
                  { value: 'all' as const, label: 'All', count: count('all') },
                  ...RETURN_STATUSES.map((s) => ({ value: s, label: RETURN_STATUS_LABEL[s], count: count(s) })),
                ]}
              />
              <SearchInput value={search} onChange={setSearch} placeholder="Return, order or customer" label="Search returns" />
            </div>
            {list.loading ? (
              <SkeletonRows rows={6} />
            ) : list.error ? (
              <ErrorState message={list.error} onRetry={list.reload} />
            ) : (list.data?.length ?? 0) === 0 ? (
              <EmptyState icon={<RotateCcw className="size-6" aria-hidden />} title="No returns" description="Return requests from customers appear here." />
            ) : (
              <ul className="divide-y divide-line">
                {list.data!.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => open(r.id)}
                      aria-current={selected === r.id ? 'true' : undefined}
                      className={cn('block w-full px-4 py-3 text-left hover:bg-canvas', selected === r.id && 'bg-brand-50/60')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">
                            {r.customerName} · {r.orderNumber}
                          </p>
                          <p className="text-[12.5px] text-ink-muted">
                            {RETURN_REASON_LABEL[r.reason]} · {formatBDT(r.refundAmountRequested)} · {formatRelative(r.createdAt)}
                          </p>
                        </div>
                        <ReturnStatusBadge status={r.status} />
                      </div>
                      {r.dispute.status !== 'none' && (
                        <Badge tone="violet" className="mt-1.5">
                          Dispute: {DISPUTE_STATUS_LABEL[r.dispute.status]}
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={cn(!selected && 'hidden lg:block')}>
            {selected ? (
              <>
                <button
                  type="button"
                  onClick={() => open(null)}
                  className="flex items-center gap-1 border-b border-line px-5 py-3 text-[13px] font-semibold text-ink-muted hover:text-ink lg:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden /> All returns
                </button>
                <ReturnPanel key={selected} id={selected} onChanged={() => void list.reload()} />
              </>
            ) : (
              <EmptyState
                className="h-full justify-center"
                icon={<RotateCcw className="size-6" aria-hidden />}
                title="Select a return"
                description="Choose a request on the left to review it."
              />
            )}
          </div>
        </div>
      </Card>
      <p className="mt-3 text-[12.5px] text-ink-subtle">
        Returns are allowed within each order’s return window ({'Store settings → Policies'}). See{' '}
        <a href={paths.storeSettings} className="underline">
          Store settings
        </a>
        .
      </p>
    </>
  );
}

export default function ReturnsPage() {
  return (
    <Suspense>
      <ReturnsView />
    </Suspense>
  );
}
