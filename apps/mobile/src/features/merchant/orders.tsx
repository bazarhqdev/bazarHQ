import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MapPin, Phone, ShoppingBag } from 'lucide-react';
import { formatBDT, formatDateTime, formatRelative, makeRange, ORDER_STATUS_LABEL, ORDER_STATUSES, type OrderStatus } from '@bazarhq/shared';
import {
  Badge,
  Card,
  Checkbox,
  DeliveryHistoryButton,
  EmptyState,
  ErrorState,
  OrderActions,
  OrderItemsList,
  MarkTestOrder,
  OrderStatusBadge,
  OrderTimeline,
  PaymentMethodLabel,
  PaymentReviewCard,
  PaymentStatusBadge,
  ReturnStatusBadge,
  SearchInput,
  SkeletonRows,
  Tabs,
  useAsync,
  useDebounced,
  useServiceEvents,
  useServices,
} from '@bazarhq/ui';
import { Screen, SectionTitle } from '@/components/Screen';
import { paths } from '@/navigation/paths';

export function OrdersScreen() {
  const services = useServices();
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [includeTest, setIncludeTest] = useState(false);
  const q = useDebounced(search);
  const [range] = useState(() => makeRange('90d'));
  const orders = useAsync(() => services.orders.list({ status, search: q, includeTest }), [status, q, includeTest]);
  const counts = useAsync(() => services.orders.countsByStatus(), []);
  useServiceEvents(() => {
    void orders.reload();
    void counts.reload();
  });
  const list = orders.data?.items ?? [];

  return (
    <Screen title="Orders" onRefresh={orders.reload} actions={<DeliveryHistoryButton range={range} />}>
      <SearchInput value={search} onChange={setSearch} placeholder="Order ID, name or phone" label="Search orders" />
      <Tabs
        className="mt-3"
        label="Order status"
        value={status}
        onChange={setStatus}
        items={[
          { value: 'all' as const, label: 'All', count: counts.data?.all },
          ...ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s], count: counts.data?.[s] })),
        ]}
      />
      <div className="mt-3">
        <Checkbox label="Include academic test orders" description="Hidden by default; excluded from sales analytics." checked={includeTest} onChange={setIncludeTest} />
      </div>
      <Card className="mt-3">
        {orders.loading ? (
          <SkeletonRows rows={6} />
        ) : orders.error ? (
          <ErrorState message={orders.error} onRetry={orders.reload} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="size-6" aria-hidden />}
            title="No orders here"
            description="Orders appear as soon as customers check out."
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((o) => (
              <li key={o.id}>
                <Link to={paths.order(o.id)} className="block px-4 py-3 active:bg-canvas">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold">{o.orderNumber}</p>
                      <p className="text-[13px] text-ink-muted">
                        {o.customerName} · {formatRelative(o.createdAt)}
                      </p>
                      {o.isTest && <Badge tone="warning" className="mt-1">Academic test</Badge>}
                    </div>
                    <p className="text-[15px] font-bold tabular">{formatBDT(o.totalAmount)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <OrderStatusBadge status={o.status} />
                    <PaymentStatusBadge status={o.paymentStatus} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Screen>
  );
}

export function OrderDetailScreen() {
  const { id = '' } = useParams<{ id: string }>();
  const services = useServices();
  const detail = useAsync(() => services.orders.get(id), [id]);
  useServiceEvents(() => void detail.reload());
  const d = detail.data;
  const o = d?.order;

  return (
    <Screen title={o?.orderNumber ?? 'Order details'} subtitle={o ? formatDateTime(o.createdAt) : undefined} back onRefresh={detail.reload}>
      {detail.loading ? (
        <SkeletonRows rows={6} />
      ) : detail.error || !d || !o ? (
        <ErrorState message={detail.error ?? 'Order not found.'} onRetry={detail.reload} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <OrderStatusBadge status={o.status} />
            <PaymentStatusBadge status={o.paymentStatus} />
            {o.isTest && <Badge tone="warning">Academic test</Badge>}
            {d.returnRequest && <ReturnStatusBadge status={d.returnRequest.status} />}
          </div>
          <Card className="mt-3 p-4">
            <MarkTestOrder detail={d} onChange={(nd) => detail.setData(nd)} compact />
          </Card>
          <Card className="mt-3 p-4">
            <p className="mb-3 text-[13px] font-semibold text-ink-muted">Update order status</p>
            <OrderActions detail={d} onChange={(nd) => detail.setData(nd)} compact />
          </Card>
          <div className="mt-3">
            <PaymentReviewCard detail={d} onChange={(nd) => detail.setData(nd)} />
          </div>
          {d.returnRequest && (
            <Link
              to={paths.returnDetail(d.returnRequest.id)}
              className="mt-3 flex items-center justify-between rounded-xl border border-line bg-white p-3 text-sm font-semibold"
            >
              Return {d.returnRequest.returnNumber} <ReturnStatusBadge status={d.returnRequest.status} />
            </Link>
          )}
          {o.cancellationReason && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">Cancelled: {o.cancellationReason}</p>}

          <SectionTitle>Customer</SectionTitle>
          <Card className="space-y-2 p-4 text-sm">
            <p className="font-semibold">
              {o.customerName} <span className="font-normal text-ink-muted">{o.customerId ? '· Registered' : '· Guest'}</span>
            </p>
            <a href={`tel:${o.orderPhone}`} className="flex items-center gap-2 text-brand-700">
              <Phone className="size-4" aria-hidden /> {o.orderPhone}
            </a>
            <p className="flex items-start gap-2 text-ink-muted">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              {o.deliveryAddress.address}, {o.deliveryAddress.district}
            </p>
          </Card>

          <SectionTitle>Items</SectionTitle>
          <Card className="px-4 py-1">
            <OrderItemsList order={o} />
            <div className="h-3" />
          </Card>

          <SectionTitle>Payment</SectionTitle>
          <Card className="space-y-2 p-4 text-sm">
            <div className="flex items-center justify-between">
              <PaymentMethodLabel method={o.paymentMethod} />
              <PaymentStatusBadge status={o.paymentStatus} />
            </div>
            <p className="text-[12px] text-ink-subtle">Online payments are verified by the server; they can’t be marked paid from the app.</p>
          </Card>

          <SectionTitle>Timeline</SectionTitle>
          <Card className="p-4">
            <OrderTimeline order={o} events={d.events} />
          </Card>
        </>
      )}
    </Screen>
  );
}
