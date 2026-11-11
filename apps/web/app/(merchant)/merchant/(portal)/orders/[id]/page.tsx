'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Mail, MapPin, Phone, User } from 'lucide-react';
import { formatBDT, formatDateTime, PAYMENT_METHOD_LABEL, RETURN_REASON_LABEL, type ReturnReason } from '@bazarhq/shared';
import {
  Badge,
  Card,
  CardHeader,
  ErrorState,
  OrderActions,
  OrderItemsList,
  MarkTestOrder,
  OrderStatusBadge,
  OrderTimeline,
  PageHeader,
  PaymentMethodLabel,
  PaymentReviewCard,
  PaymentStatusBadge,
  ReturnStatusBadge,
  SkeletonRows,
  useAsync,
  useServiceEvents,
  useServices,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const services = useServices();
  const detail = useAsync(() => services.orders.get(id), [id]);
  useServiceEvents(() => void detail.reload());
  const d = detail.data;
  const o = d?.order;

  return (
    <>
      <title>{`${o?.orderNumber ?? 'Order'} · BazarHQ Merchant`}</title>
      <PageHeader
        back={
          <Link href={paths.orders} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Orders
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o?.orderNumber ?? 'Order'} {o && <OrderStatusBadge status={o.status} />}
          </span>
        }
        description={o ? `Placed ${formatDateTime(o.createdAt)}` : undefined}
      />
      {detail.loading ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : detail.error || !d || !o ? (
        <Card>
          <ErrorState message={detail.error ?? 'Order not found.'} onRetry={detail.reload} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <Card>
              <div className="p-5 pb-0"><MarkTestOrder detail={d} onChange={(nd) => detail.setData(nd)} /></div>
              <CardHeader title="Update status" description="Only the next valid step is offered. Every change is recorded and the customer is notified." />
              <div className="px-5 pb-5">
                <OrderActions detail={d} onChange={(nd) => detail.setData(nd)} />
              </div>
            </Card>
            <PaymentReviewCard detail={d} onChange={(nd) => detail.setData(nd)} />
            {o.cancellationReason && (
              <Card className="border-red-200 bg-red-50/50 p-4">
                <p className="text-sm font-semibold text-red-800">Cancellation reason</p>
                <p className="text-sm text-red-900">{o.cancellationReason}</p>
              </Card>
            )}
            <Card>
              <CardHeader title={`Items (${o.items.length})`} />
              <div className="px-5 pb-5">
                <OrderItemsList order={o} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Order timeline" description="Order status is separate from payment and return status." />
              <div className="px-5 pb-5">
                <OrderTimeline order={o} events={d.events} />
              </div>
            </Card>
          </div>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Customer" />
              <dl className="space-y-2.5 px-5 pb-5 text-sm">
                <div className="flex items-center gap-2">
                  <User className="size-4 text-ink-subtle" aria-hidden />
                  <dt className="sr-only">Name</dt>
                  <dd className="font-semibold">{o.customerName}</dd>
                  <Badge tone={o.customerId ? 'navy' : 'neutral'}>{o.customerId ? 'Registered' : 'Guest'}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="size-4 text-ink-subtle" aria-hidden />
                  <dt className="sr-only">Phone</dt>
                  <dd>
                    <a href={`tel:${o.orderPhone}`} className="hover:underline">
                      {o.orderPhone}
                    </a>
                  </dd>
                </div>
                {o.orderEmail && (
                  <div className="flex items-center gap-2">
                    <Mail className="size-4 text-ink-subtle" aria-hidden />
                    <dt className="sr-only">Email</dt>
                    <dd>
                      <a href={`mailto:${o.orderEmail}`} className="hover:underline">
                        {o.orderEmail}
                      </a>
                    </dd>
                  </div>
                )}
                <Link
                  href={paths.customer(o.customerId ?? `guest:${o.orderPhone}`)}
                  className="inline-block pt-1 text-[13px] font-semibold text-brand-700 hover:underline"
                >
                  View customer history
                </Link>
              </dl>
            </Card>
            <Card>
              <CardHeader title="Shipping address" />
              <div className="flex gap-2 px-5 pb-5 text-sm">
                <MapPin className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden />
                <address className="not-italic leading-relaxed">
                  <span className="font-semibold">{o.deliveryAddress.recipientName}</span>
                  <br />
                  {o.deliveryAddress.address}
                  <br />
                  {o.deliveryAddress.district}
                  {o.deliveryAddress.postalCode && ` ${o.deliveryAddress.postalCode}`}
                  <br />
                  {o.deliveryAddress.phone}
                </address>
              </div>
            </Card>
            <Card>
              <CardHeader title="Payment" />
              <dl className="space-y-3 px-5 pb-5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ink-muted">Method</dt>
                  <dd>
                    <PaymentMethodLabel method={o.paymentMethod} />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ink-muted">Payment status</dt>
                  <dd>
                    <PaymentStatusBadge status={o.paymentStatus} />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ink-muted">Amount</dt>
                  <dd className="font-semibold tabular">{formatBDT(o.totalAmount)}</dd>
                </div>
                {d.payments.length > 0 && (
                  <div className="border-t border-line pt-3">
                    <dt className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Payment attempts</dt>
                    <dd>
                      <ul className="space-y-1.5">
                        {d.payments.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
                            <span>
                              {PAYMENT_METHOD_LABEL[p.method]}{' '}
                              {p.providerReferenceMasked && <span className="text-ink-subtle">ref {p.providerReferenceMasked}</span>}
                            </span>
                            <Badge tone={p.status === 'paid' ? 'success' : p.status === 'failed' ? 'danger' : 'warning'}>{p.status.replace('_', ' ')}</Badge>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                <p className="text-[12px] text-ink-subtle">
                  bKash, Nagad and SSLCommerz are verified server-side. Rocket (and any payment the provider couldn’t confirm) can be reviewed manually above;
                  every decision is audited.
                </p>
              </dl>
            </Card>
            {d.returnRequest && (
              <Card>
                <CardHeader title="Return request" />
                <div className="space-y-1.5 px-5 pb-5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{d.returnRequest.returnNumber}</span>
                    <ReturnStatusBadge status={d.returnRequest.status} />
                  </div>
                  <p className="text-ink-muted">Reason: {RETURN_REASON_LABEL[d.returnRequest.reason as ReturnReason] ?? d.returnRequest.reason}</p>
                  <p className="text-[12px] text-ink-subtle">Requested {formatDateTime(d.returnRequest.createdAt)}.</p>
                  <Link href={paths.returnDetail(d.returnRequest.id)} className="inline-block pt-1 text-[13px] font-semibold text-brand-700 hover:underline">
                    Review return →
                  </Link>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
