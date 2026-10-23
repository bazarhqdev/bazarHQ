'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PRODUCT_STATUS_LABEL,
  RETURN_STATUS_LABEL,
  STORE_STATUS_LABEL,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ProductStatus,
  type ReturnStatus,
  type StockState,
  type StoreStatus,
  type TicketPriority,
  type TicketStatus,
} from '@bazarhq/shared';
import { Package } from 'lucide-react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'navy' | 'violet';
const toneClass: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-brand-50 text-brand-800 ring-brand-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  navy: 'bg-navy-50 text-navy-800 ring-navy-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
};

export type BadgeTone = Tone;

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold ring-1 ring-inset',
        toneClass[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

const orderTone: Record<OrderStatus, BadgeTone> = {
  pending: 'warning',
  confirmed: 'info',
  processing: 'violet',
  shipped: 'navy',
  out_for_delivery: 'navy',
  delivered: 'success',
  cancelled: 'danger',
};
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={orderTone[status]} dot>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}

const paymentTone: Record<PaymentStatus, BadgeTone> = {
  pending: 'neutral',
  pending_verification: 'warning',
  paid: 'success',
  failed: 'danger',
  cod_pending: 'warning',
  cod_collected: 'success',
  refunded: 'violet',
};
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={paymentTone[status]}>{PAYMENT_STATUS_LABEL[status]}</Badge>;
}

const stockTone: Record<StockState, BadgeTone> = { in_stock: 'success', low_stock: 'warning', out_of_stock: 'danger' };
const stockLabel: Record<StockState, string> = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock' };
export function StockBadge({ state }: { state: StockState }) {
  return (
    <Badge tone={stockTone[state]} dot>
      {stockLabel[state]}
    </Badge>
  );
}

const productTone: Record<ProductStatus, BadgeTone> = { active: 'success', draft: 'neutral', inactive: 'warning' };
export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return <Badge tone={productTone[status]}>{PRODUCT_STATUS_LABEL[status]}</Badge>;
}

const storeTone: Record<StoreStatus, BadgeTone> = { draft: 'warning', published: 'success', suspended: 'danger' };
export function StoreStatusBadge({ status }: { status: StoreStatus }) {
  return (
    <Badge tone={storeTone[status]} dot>
      {STORE_STATUS_LABEL[status]}
    </Badge>
  );
}

const ticketTone: Record<TicketStatus, BadgeTone> = {
  open: 'warning',
  in_progress: 'info',
  waiting_for_customer: 'violet',
  resolved: 'success',
  closed: 'neutral',
};
export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge tone={ticketTone[status]}>{TICKET_STATUS_LABEL[status]}</Badge>;
}
export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return <Badge tone={priority === 'urgent' ? 'danger' : 'neutral'}>{TICKET_PRIORITY_LABEL[priority]}</Badge>;
}

const returnTone: Record<ReturnStatus, BadgeTone> = { requested: 'warning', approved: 'info', rejected: 'danger', received: 'navy', closed: 'neutral' };
export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
  return <Badge tone={returnTone[status]}>{RETURN_STATUS_LABEL[status]}</Badge>;
}

const methodColor: Record<PaymentMethod, string> = {
  bkash: 'bg-[#E2136E] text-white',
  nagad: 'bg-[#EC1C24] text-white',
  rocket: 'bg-[#8C3494] text-white',
  sslcommerz: 'bg-[#1F5AA6] text-white',
  cod: 'bg-brand-700 text-white',
};
const methodShort: Record<PaymentMethod, string> = { bkash: 'bK', nagad: 'Ng', rocket: 'Rk', sslcommerz: 'SSL', cod: 'COD' };

/** Neutral text-mark for a payment method (no third-party logos are reproduced). */
export function PaymentMethodMark({ method, size = 32 }: { method: PaymentMethod; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg font-bold', methodColor[method])}
      style={{ width: size, height: size, fontSize: method === 'sslcommerz' || method === 'cod' ? size * 0.3 : size * 0.38 }}
    >
      {methodShort[method]}
    </span>
  );
}

export function PaymentMethodLabel({ method }: { method: PaymentMethod }) {
  return (
    <span className="inline-flex items-center gap-2">
      <PaymentMethodMark method={method} size={22} />
      <span>{PAYMENT_METHOD_LABEL[method]}</span>
    </span>
  );
}

const thumbHues = [
  'bg-brand-100 text-brand-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-lime-100 text-lime-800',
];

/** Product image or a tinted placeholder tile when no image was uploaded. */
export function ProductThumb({ name, url, size = 44, className }: { name: string; url?: string | null; size?: number; className?: string }) {
  if (url) {
    return <img src={url} alt="" className={cn('shrink-0 rounded-lg object-cover ring-1 ring-line', className)} style={{ width: size, height: size }} />;
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg', thumbHues[h % thumbHues.length], className)}
      style={{ width: size, height: size }}
    >
      <Package style={{ width: size * 0.42, height: size * 0.42 }} />
    </span>
  );
}
