/**
 * Canonical state machines (SRS §13.1, §14, §15, §12.5).
 *
 * These mirror the server rules so the UI never OFFERS an invalid action.
 * They are NOT a security boundary (AUTHZ-03): every transition is validated
 * again by the trusted server operation / Edge Function.
 */
import { ADMIN_LIMITS } from '../constants';
import type {
  AnnouncementStatus,
  Order,
  OrderStatus,
  PaymentAttempt,
  PaymentStatus,
  PolicyStatus,
  RefundStatus,
  ReturnRequest,
  ReturnStatus,
  SupportTicket,
  TicketStatus,
} from '../types';

/* ------------------------------ Orders ------------------------------ */

/** SRS §13.1 canonical order state machine. */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const ORDER_FORWARD_PATH: readonly OrderStatus[] = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** The single forward step available from `status`, if any. */
export function nextForwardStatus(status: OrderStatus): OrderStatus | null {
  return ORDER_TRANSITIONS[status].find((s) => s !== 'cancelled') ?? null;
}

/** Cancellation needs a reason and is blocked for out_for_delivery/delivered (FR-M-31). */
export function canCancelOrder(status: OrderStatus): boolean {
  return canTransitionOrder(status, 'cancelled');
}

export const ORDER_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Confirm order',
  processing: 'Start processing',
  shipped: 'Mark as shipped',
  out_for_delivery: 'Mark out for delivery',
  delivered: 'Mark as delivered',
  cancelled: 'Cancel order',
};

/**
 * Payment states in which the mock server accepts `pending -> confirmed`.
 * SRS §13.1 says "payment/COD preconditions are checked server-side" without
 * enumerating them; this list is a MOCK ASSUMPTION to be replaced by the
 * server's answer.
 */
export const CONFIRMABLE_PAYMENT_STATUSES: readonly PaymentStatus[] = ['paid', 'cod_pending'];

export function confirmBlockedReason(order: Pick<Order, 'status' | 'paymentStatus'>): string | null {
  if (order.status !== 'pending') return null;
  if (CONFIRMABLE_PAYMENT_STATUSES.includes(order.paymentStatus)) return null;
  if (order.paymentStatus === 'pending_verification') {
    return 'Payment is still awaiting server-side verification. You can confirm once it is verified.';
  }
  if (order.paymentStatus === 'failed') {
    return 'The payment for this order failed. It cannot be confirmed unless a new payment succeeds.';
  }
  return 'Payment has not been completed yet.';
}

/**
 * DM-05: COD collection is recorded only after cash is actually collected,
 * i.e. while the order is out for delivery or delivered and still cod_pending.
 */
export function canRecordCodCollection(order: Pick<Order, 'paymentMethod' | 'paymentStatus' | 'status'>): boolean {
  return order.paymentMethod === 'cod' && order.paymentStatus === 'cod_pending' && (order.status === 'out_for_delivery' || order.status === 'delivered');
}

/** Revenue excludes cancelled orders (FR-M-39). */
export function countsTowardRevenue(order: Pick<Order, 'status'>): boolean {
  return order.status !== 'cancelled';
}

/* ------------------------------ Support ----------------------------- */

/** FR-SUP-04 merchant-side ticket workflow. Customer reply moves waiting -> in_progress. */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ['in_progress'],
  in_progress: ['waiting_for_customer', 'resolved'],
  waiting_for_customer: ['in_progress', 'resolved'],
  resolved: ['closed'],
  closed: [],
};

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

/** Closed tickets are read-only for the merchant (FR-SUP-08). */
export function canReplyToTicket(status: TicketStatus): boolean {
  return status !== 'closed';
}

/** FR-SUP-10: 72 elapsed hours from creation without a public merchant reply. */
export function ticketEscalationDueAt(createdAt: string): Date {
  return new Date(new Date(createdAt).getTime() + 72 * 60 * 60 * 1000);
}

/** FR-SUP-04: a Customer may reopen a Closed ticket within seven calendar days. */
export function canCustomerReopenTicket(t: Pick<SupportTicket, 'status' | 'closedAt'>, now: Date = new Date()): boolean {
  if (t.status !== 'closed' || !t.closedAt) return false;
  return now.getTime() - Date.parse(t.closedAt) <= ADMIN_LIMITS.ticketReopenDays * 86_400_000;
}

/**
 * FR-SUP-10: escalation is available when the assigned active Merchant has not
 * publicly responded within 72 elapsed hours from creation.
 */
export function canCustomerEscalateTicket(
  t: Pick<SupportTicket, 'queue' | 'status' | 'createdAt' | 'firstMerchantResponseAt' | 'escalationAt'>,
  now: Date = new Date(),
): boolean {
  if (t.queue !== 'store' || t.escalationAt || t.firstMerchantResponseAt) return false;
  if (t.status === 'resolved' || t.status === 'closed') return false;
  return now.getTime() >= ticketEscalationDueAt(t.createdAt).getTime();
}

/** Priority can be updated by the customer until the ticket is resolved (FR-SUP-06). */
export function canCustomerChangePriority(status: TicketStatus): boolean {
  return status !== 'resolved' && status !== 'closed';
}

/* ------------------------------ Returns ----------------------------- */

/** FR-RET-10: requested → approved | rejected; approved → received; received/rejected → closed. */
export const RETURN_TRANSITIONS: Readonly<Record<ReturnStatus, readonly ReturnStatus[]>> = {
  requested: ['approved', 'rejected'],
  approved: ['received'],
  rejected: ['closed'],
  received: ['closed'],
  closed: [],
};

export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from].includes(to);
}

/**
 * FR-RET-01/03: delivered order, inside the store's return window (calendar days
 * from delivery), no existing return. The server re-checks with its own clock.
 */
export function returnEligibility(
  order: Pick<Order, 'status'>,
  deliveredAt: string | null,
  returnWindowDays: number,
  hasExistingReturn: boolean,
  now: Date = new Date(),
): { eligible: boolean; reason: string | null; windowEndsAt: string | null } {
  if (hasExistingReturn) return { eligible: false, reason: 'A return has already been requested for this order.', windowEndsAt: null };
  if (order.status !== 'delivered' || !deliveredAt) {
    return { eligible: false, reason: 'Returns are available after the order is delivered.', windowEndsAt: null };
  }
  const ends = new Date(Date.parse(deliveredAt) + returnWindowDays * 86_400_000);
  if (now.getTime() > ends.getTime()) {
    return { eligible: false, reason: `The ${returnWindowDays}-day return window for this order has ended.`, windowEndsAt: ends.toISOString() };
  }
  return { eligible: true, reason: null, windowEndsAt: ends.toISOString() };
}

/** FR-RET-09: only a rejected return can be escalated, and only once. */
export function canEscalateReturn(r: Pick<ReturnRequest, 'status' | 'dispute'>): boolean {
  return r.status === 'rejected' && r.dispute.status === 'none';
}

/* ------------------------------ Refunds ----------------------------- */

/** FR-REF-05: initiated → processing → completed | failed. A failed refund may be retried. */
export const REFUND_TRANSITIONS: Readonly<Record<RefundStatus, readonly RefundStatus[]>> = {
  initiated: ['processing', 'completed', 'failed'],
  processing: ['completed', 'failed'],
  failed: ['processing'],
  completed: [],
};

export function canTransitionRefund(from: RefundStatus, to: RefundStatus): boolean {
  return REFUND_TRANSITIONS[from].includes(to);
}

/* ------------------------- Payment attempts ------------------------- */

/** Option B (migration 003/004): pending → pending_verification | paid | failed; pending_verification → paid | failed. */
export const PAYMENT_ATTEMPT_TRANSITIONS: Readonly<Record<PaymentAttempt['status'], readonly PaymentAttempt['status'][]>> = {
  pending: ['pending_verification', 'paid', 'failed'],
  pending_verification: ['paid', 'failed'],
  paid: [],
  failed: [],
};

/** Manual review records a final result only, by the owning merchant or a Super Admin (API-43). */
export function canManuallyReviewPayment(order: Pick<Order, 'paymentMethod' | 'paymentStatus'>): boolean {
  return order.paymentMethod !== 'cod' && order.paymentStatus === 'pending_verification';
}

/* ---------------------- Policies and announcements ------------------ */

/** FR-SA-18/19: submit → second-admin approval → publish; publishing archives the previous version. */
export const POLICY_TRANSITIONS: Readonly<Record<PolicyStatus, readonly PolicyStatus[]>> = {
  pending_approval: ['approved'],
  approved: ['published'],
  published: ['archived'],
  archived: [],
};

/** FR-SA-16: sent announcements cannot be recalled or deleted. */
export const ANNOUNCEMENT_TRANSITIONS: Readonly<Record<AnnouncementStatus, readonly AnnouncementStatus[]>> = {
  draft: ['scheduled', 'sent'],
  scheduled: ['draft', 'sent'],
  sent: [],
};
