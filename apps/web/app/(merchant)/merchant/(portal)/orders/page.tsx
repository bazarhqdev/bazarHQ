'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight, ShoppingBag } from 'lucide-react';
import {
  formatBDT,
  formatDateTime,
  formatRelative,
  ORDER_STATUS_LABEL,
  ORDER_STATUSES,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@bazarhq/shared';
import {
  Badge,
  Card,
  Checkbox,
  DeliveryHistoryButton,
  EmptyState,
  ErrorState,
  OrderStatusBadge,
  PageHeader,
  PaymentMethodLabel,
  PaymentStatusBadge,
  SearchInput,
  SelectField,
  SkeletonRows,
  TableWrap,
  Tabs,
  td,
  th,
  useAsync,
  useDebounced,
  useServiceEvents,
  useServices,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

export default function OrdersPage() {
  const services = useServices();
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | 'all'>('all');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | 'all'>('all');
  const [includeTest, setIncludeTest] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(search);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [defaultFrom] = useState(() => new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10));
  const orders = useAsync(
    () => services.orders.list({ status, search: q, paymentStatus, paymentMethod, from: from || undefined, to: to || undefined, includeTest }),
    [status, q, paymentStatus, paymentMethod, from, to, includeTest],
  );
  const counts = useAsync(() => services.orders.countsByStatus(), [orders.data]);
  useServiceEvents(() => void orders.reload());

  const list = orders.data?.items ?? [];
  const filtered = q || paymentStatus !== 'all' || paymentMethod !== 'all' || from || to || includeTest;

  return (
    <>
      <title>Orders · BazarHQ Merchant</title>
      <PageHeader
        title="Orders"
        description="Track and update orders for your store. Status changes notify the customer."
        actions={<DeliveryHistoryButton range={{ preset: 'custom', from: from || defaultFrom, to: to || today }} />}
      />
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <Tabs
            label="Order status"
            value={status}
            onChange={setStatus}
            items={[
              { value: 'all' as const, label: 'All', count: counts.data?.all },
              ...ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s], count: counts.data?.[s] })),
            ]}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_1fr_1fr_auto]">
            <SearchInput value={search} onChange={setSearch} placeholder="Order ID, customer or phone" label="Search orders" />
            <SelectField
              aria-label="Payment status"
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus | 'all')}
              options={[{ value: 'all', label: 'Any payment status' }, ...PAYMENT_STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS_LABEL[s] }))]}
            />
            <SelectField
              aria-label="Payment method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | 'all')}
              options={[{ value: 'all', label: 'Any method' }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))]}
            />
            <div className="flex items-center gap-1.5">
              <label htmlFor="from" className="sr-only">
                From date
              </label>
              <input
                id="from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-2 text-sm"
              />
              <span className="text-[12px] text-ink-subtle">to</span>
              <label htmlFor="to" className="sr-only">
                To date
              </label>
              <input
                id="to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-2 text-sm"
              />
            </div>
          </div>
          <div className="pt-1">
            <Checkbox label="Include academic test orders" description="Test orders are hidden by default and excluded from business analytics." checked={includeTest} onChange={setIncludeTest} />
          </div>
        </div>
        {orders.loading ? (
          <SkeletonRows rows={7} />
        ) : orders.error ? (
          <ErrorState message={orders.error} onRetry={orders.reload} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="size-6" aria-hidden />}
            title={filtered || status !== 'all' ? 'No orders match' : 'No orders yet'}
            description={filtered || status !== 'all' ? 'Try another status, search or date range.' : 'New orders appear here as soon as customers check out.'}
          />
        ) : (
          <>
            <TableWrap className="hidden lg:block">
              <table className="w-full">
                <thead className="border-b border-line bg-canvas/60">
                  <tr>
                    {['Order', 'Customer', 'Items', 'Total', 'Payment', 'Status'].map((h) => (
                      <th key={h} scope="col" className={th}>
                        {h}
                      </th>
                    ))}
                    <th scope="col" className={th}>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.map((o) => (
                    <tr key={o.id} className="group hover:bg-canvas/60">
                      <td className={td}>
                        <Link href={paths.order(o.id)} className="font-semibold text-ink hover:text-brand-700">
                          {o.orderNumber}
                        </Link>
                        <p className="text-[12px] text-ink-subtle" title={formatDateTime(o.createdAt)}>
                          {formatRelative(o.createdAt)}
                        </p>
                        {o.isTest && <Badge tone="warning" className="mt-1">Academic test</Badge>}
                      </td>
                      <td className={td}>
                        <p className="font-medium">{o.customerName}</p>
                        <p className="text-[12px] text-ink-subtle">
                          {o.orderPhone}
                          {!o.customerId && ' · Guest'}
                        </p>
                      </td>
                      <td className={`${td} tabular`}>{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                      <td className={`${td} font-semibold tabular`}>{formatBDT(o.totalAmount)}</td>
                      <td className={td}>
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-[12.5px]">
                            <PaymentMethodLabel method={o.paymentMethod} />
                          </span>
                          <PaymentStatusBadge status={o.paymentStatus} />
                        </div>
                      </td>
                      <td className={td}>
                        <OrderStatusBadge status={o.status} />
                      </td>
                      <td className={`${td} text-right`}>
                        <Link
                          href={paths.order(o.id)}
                          aria-label={`Open ${o.orderNumber}`}
                          className="inline-flex rounded-lg p-2 text-ink-subtle group-hover:text-ink"
                        >
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <ul className="divide-y divide-line lg:hidden">
              {list.map((o) => (
                <li key={o.id}>
                  <Link href={paths.order(o.id)} className="block p-4 hover:bg-canvas">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{o.orderNumber}</p>
                        <p className="text-[12.5px] text-ink-muted">
                          {o.customerName} · {formatRelative(o.createdAt)}
                        </p>
                      </div>
                      <p className="text-sm font-bold tabular">{formatBDT(o.totalAmount)}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <OrderStatusBadge status={o.status} />
                      <PaymentStatusBadge status={o.paymentStatus} />
                      {o.isTest && <Badge tone="warning">Academic test</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-subtle">
              {orders.data?.total} order{orders.data?.total === 1 ? '' : 's'}
            </p>
          </>
        )}
      </Card>
    </>
  );
}
