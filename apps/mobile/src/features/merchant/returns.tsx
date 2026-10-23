import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { formatBDT, formatRelative, RETURN_REASON_LABEL, RETURN_STATUS_LABEL, RETURN_STATUSES, type ReturnStatus } from '@bazarhq/shared';
import { Card, EmptyState, ErrorState, ReturnPanel, ReturnStatusBadge, SkeletonRows, Tabs, useAsync, useServiceEvents, useServices } from '@bazarhq/ui';
import { Screen } from '@/components/Screen';
import { paths } from '@/navigation/paths';

export function ReturnsScreen() {
  const services = useServices();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ReturnStatus | 'all'>('all');
  const list = useAsync(() => services.returns.list({ status }), [status]);
  useServiceEvents(() => void list.reload());
  return (
    <Screen title="Returns & refunds" back={paths.dashboard} onRefresh={list.reload}>
      <Tabs
        label="Return status"
        value={status}
        onChange={setStatus}
        items={[{ value: 'all' as const, label: 'All' }, ...RETURN_STATUSES.map((s) => ({ value: s, label: RETURN_STATUS_LABEL[s] }))]}
      />
      <Card className="mt-3">
        {list.loading ? (
          <SkeletonRows rows={5} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon={<RotateCcw className="size-6" aria-hidden />} title="No returns" />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => navigate(paths.returnDetail(r.id))}
                  className="flex w-full items-start justify-between gap-2 px-4 py-3 text-left active:bg-canvas"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {r.customerName} · {r.orderNumber}
                    </span>
                    <span className="block text-[12.5px] text-ink-muted">
                      {RETURN_REASON_LABEL[r.reason]} · {formatBDT(r.refundAmountRequested)} · {formatRelative(r.createdAt)}
                    </span>
                  </span>
                  <ReturnStatusBadge status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Screen>
  );
}

export function ReturnDetailScreen() {
  const { id = '' } = useParams();
  return (
    <Screen title="Return" back={paths.returns}>
      <Card>
        <ReturnPanel id={id} />
      </Card>
    </Screen>
  );
}
