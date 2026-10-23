'use client';

import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Bell,
  CreditCard,
  Gavel,
  LifeBuoy,
  Megaphone,
  Package,
  RotateCcw,
  ShoppingBag,
  UserCog,
} from 'lucide-react';
import {
  formatBDT,
  formatChange,
  formatRelative,
  makeRange,
  NOTIFICATION_TYPE_LABEL,
  RANGE_PRESETS,
  type DateRange,
  type DateRangePreset,
  type LowStockItem,
  type MetricWithChange,
  type Notification,
  type NotificationType,
  type Order,
} from '@bazarhq/shared';
import { cn } from '../cn';
import { notificationHref, useNavigation } from '../context';
import { Card } from '../components';
import { OrderStatusBadge, PaymentStatusBadge, StockBadge } from '../components';

export function StatTile({
  label,
  metric,
  format,
  icon,
  tone = 'brand',
  sublabel = 'vs previous period',
}: {
  label: string;
  metric: MetricWithChange;
  format: (v: number) => string;
  icon: ReactNode;
  tone?: 'brand' | 'navy' | 'violet' | 'amber';
  sublabel?: string;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    navy: 'bg-navy-50 text-navy-700',
    violet: 'bg-violet-50 text-violet-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  const up = (metric.changePct ?? 0) > 0;
  const down = (metric.changePct ?? 0) < 0;
  return (
    <Card as="div" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-ink-muted">{label}</p>
        <span className={cn('flex size-9 items-center justify-center rounded-xl', tones[tone])} aria-hidden>
          {icon}
        </span>
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight text-ink tabular">{format(metric.value)}</p>
      <p className="mt-1 flex items-center gap-1 text-[12.5px]">
        {metric.changePct !== null && (up || down) ? (
          <span className={cn('inline-flex items-center gap-0.5 font-semibold', up ? 'text-brand-700' : 'text-red-600')}>
            {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
            {formatChange(metric.changePct)}
            <span className="sr-only">{up ? 'increase' : 'decrease'}</span>
          </span>
        ) : (
          <span className="font-semibold text-ink-subtle">{metric.changePct === null ? 'New' : '0%'}</span>
        )}
        <span className="text-ink-subtle">{sublabel}</span>
      </p>
    </Card>
  );
}

export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const select = (p: DateRangePreset) => {
    if (p === 'custom') onChange(makeRange('custom', new Date(), { from, to }));
    else onChange(makeRange(p));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="Date range">
        {[...RANGE_PRESETS.map((p) => ({ value: p.value, label: p.value.toUpperCase() })), { value: 'custom' as const, label: 'Custom' }].map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={value.preset === p.value}
            title={RANGE_PRESETS.find((r) => r.value === p.value)?.label ?? 'Custom range'}
            onClick={() => select(p.value)}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold',
              value.preset === p.value ? 'bg-navy-900 text-white' : 'text-ink-muted hover:text-ink',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="flex items-center gap-1.5 text-[13px]">
          <label className="sr-only" htmlFor="range-from">
            From
          </label>
          <input
            id="range-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              if (e.target.value) onChange(makeRange('custom', new Date(), { from: e.target.value, to }));
            }}
            className="h-9 rounded-lg border border-line-strong bg-white px-2"
          />
          <span className="text-ink-subtle">to</span>
          <label className="sr-only" htmlFor="range-to">
            To
          </label>
          <input
            id="range-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              if (e.target.value) onChange(makeRange('custom', new Date(), { from, to: e.target.value }));
            }}
            className="h-9 rounded-lg border border-line-strong bg-white px-2"
          />
        </div>
      )}
    </div>
  );
}

export function LowStockList({ items }: { items: LowStockItem[] }) {
  const { Link, paths } = useNavigation();
  if (!items.length) return <p className="px-5 pb-5 text-sm text-ink-muted">All active products are above their low-stock thresholds.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => (
        <li key={`${it.productId}:${it.variantId ?? ''}`}>
          <Link href={paths.inventoryFor(it.productId)} className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
            <AlertTriangle className={cn('size-4 shrink-0', it.state === 'out_of_stock' ? 'text-red-600' : 'text-amber-600')} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{it.name}</span>
            <span className="text-[12.5px] tabular text-ink-muted">
              {it.stockQuantity} / {it.threshold}
            </span>
            <StockBadge state={it.state} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RecentOrdersList({ orders }: { orders: Order[] }) {
  const { Link, paths } = useNavigation();
  return (
    <ul className="divide-y divide-line">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={paths.order(o.id)} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{o.orderNumber}</p>
              <p className="truncate text-[12.5px] text-ink-muted">
                {o.customerName} · {formatRelative(o.createdAt)}
              </p>
              <div className="mt-1 sm:hidden">
                <OrderStatusBadge status={o.status} />
              </div>
            </div>
            <div className="hidden sm:block">
              <PaymentStatusBadge status={o.paymentStatus} />
            </div>
            <div className="hidden sm:block">
              <OrderStatusBadge status={o.status} />
            </div>
            <span className="w-20 text-right text-sm font-semibold tabular text-ink">{formatBDT(o.totalAmount)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const notifIcon: Record<NotificationType, typeof Bell> = {
  new_order: ShoppingBag,
  order_status: ShoppingBag,
  payment: CreditCard,
  low_stock: Package,
  return: RotateCcw,
  support_ticket: LifeBuoy,
  announcement: Megaphone,
  system: Bell,
  refund: Banknote,
  dispute: Gavel,
  account: UserCog,
};

export function NotificationList({
  items,
  onOpen,
  dense,
  hrefFor,
}: {
  items: Notification[];
  onOpen?: (n: Notification) => void;
  dense?: boolean;
  hrefFor?: (n: Notification) => string | null;
}) {
  const { Link, paths } = useNavigation();
  return (
    <ul className="divide-y divide-line">
      {items.map((n) => {
        const Icon = notifIcon[n.type];
        const href = hrefFor ? hrefFor(n) : notificationHref(n, paths);
        const content = (
          <>
            <span
              className={cn(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl',
                n.isRead ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-700',
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm', n.isRead ? 'font-medium text-ink-muted' : 'font-semibold text-ink')}>
                {n.title}
                {!n.isRead && <span className="sr-only"> (unread)</span>}
              </p>
              <p className={cn('text-[12.5px] text-ink-muted', dense && 'truncate')}>{n.body}</p>
              <p className="mt-0.5 text-[12px] text-ink-subtle">
                {NOTIFICATION_TYPE_LABEL[n.type]} · {formatRelative(n.createdAt)}
              </p>
            </div>
            {!n.isRead && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand-600" aria-hidden />}
          </>
        );
        const cls = cn('flex w-full gap-3 px-5 text-left hover:bg-canvas', dense ? 'py-2.5' : 'py-3.5');
        return (
          <li key={n.id}>
            {href ? (
              <Link href={href} className={cls} onClick={() => onOpen?.(n)}>
                {content}
              </Link>
            ) : (
              <button type="button" className={cls} onClick={() => onOpen?.(n)}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
