/** Merchant return review and refund processing (SRS §14, API-16/17/42). */
import { REFUND_STATUS_LABEL, RETURN_STATUS_LABEL } from '../../constants';
import { canTransitionRefund, canTransitionReturn } from '../../transitions';
import type { Refund, RefundStatus, ReturnRequest } from '../../types';
import { ServiceError, type MerchantReturnService, type ReturnDetail } from '../contracts';
import type { MockContext } from './context';
import type { MockUser } from './seed';

/** Shared by merchant and Super Admin refund operations. */
export function refundHelpers(ctx: MockContext) {
  function detail(r: ReturnRequest): ReturnDetail {
    const order = ctx.db.orders.find((o) => o.id === r.orderId)!;
    return { returnRequest: r, order, refund: ctx.db.refunds.find((f) => f.returnId === r.id) ?? null };
  }

  function addRefundEvent(f: Refund, status: RefundStatus, actor: MockUser | null, note: string | null) {
    if (f.status !== status && !canTransitionRefund(f.status, status)) {
      throw new ServiceError(
        'CONFLICT',
        `A refund that is ${REFUND_STATUS_LABEL[f.status].toLowerCase()} can't move to ${REFUND_STATUS_LABEL[status].toLowerCase()}.`,
      );
    }
    f.status = status;
    f.events.push({ status, actorName: actor?.profile.fullName ?? 'System', note, createdAt: ctx.nowIso() });
  }

  function notifyCustomer(r: ReturnRequest, title: string, body: string, refund?: Refund) {
    ctx.notify(r.customerId, { type: refund ? 'refund' : 'return', title, body, referenceType: refund ? 'refund' : 'return', referenceId: refund?.id ?? r.id });
  }

  /** Completion requires settlement evidence; closes the return and marks the order refunded. */
  function settle(f: Refund, actor: MockUser, reference: string, note: string) {
    if (!reference || reference.trim().length < 4)
      throw new ServiceError('VALIDATION', 'Enter the settlement reference.', { reference: 'Enter the settlement reference.' });
    addRefundEvent(f, 'completed', actor, note.trim() || `Settled with reference ${reference.trim()}`);
    f.confirmationReference = reference.trim();
    f.processedAt = ctx.nowIso();
    const r = ctx.db.returns.find((x) => x.id === f.returnId)!;
    const order = ctx.db.orders.find((o) => o.id === f.orderId)!;
    order.paymentStatus = 'refunded';
    order.updatedAt = ctx.nowIso();
    if (r.status === 'received') {
      r.status = 'closed';
      r.closedAt = ctx.nowIso();
    }
    ctx.audit(actor, 'refund.manual_settlement_recorded', 'refund', f.id, { amount: f.amount, method: f.method, reference: f.confirmationReference });
    notifyCustomer(r, 'Refund completed', `Your refund of ৳${f.amount} for ${f.orderNumber} has been completed (ref ${f.confirmationReference}).`, f);
  }

  return { detail, addRefundEvent, notifyCustomer, settle };
}

export function createReturnServices(ctx: MockContext): MerchantReturnService {
  const { read, write, nowIso, newId, requireMerchant, requireStore, seen, recordMovement, audit } = ctx;
  const { detail, addRefundEvent, notifyCustomer, settle } = refundHelpers(ctx);

  function owned(id: string): ReturnRequest {
    const store = requireStore();
    const r = ctx.db.returns.find((x) => x.id === id || x.returnNumber === id);
    if (!r) throw new ServiceError('NOT_FOUND', 'This return request could not be found.');
    if (r.storeId !== store.id) throw new ServiceError('FORBIDDEN', 'This return belongs to another store.');
    return r;
  }

  function ownedRefund(id: string): Refund {
    const store = requireStore();
    const f = ctx.db.refunds.find((x) => x.id === id);
    if (!f) throw new ServiceError('NOT_FOUND', 'This refund could not be found.');
    if (f.storeId !== store.id) throw new ServiceError('FORBIDDEN', 'This refund belongs to another store.');
    return f;
  }

  function transition(r: ReturnRequest, to: ReturnRequest['status']) {
    if (!canTransitionReturn(r.status, to)) {
      throw new ServiceError(
        'CONFLICT',
        `A return that is ${RETURN_STATUS_LABEL[r.status].toLowerCase()} can't change to ${RETURN_STATUS_LABEL[to].toLowerCase()}. Refresh to see its latest state.`,
      );
    }
    r.status = to;
  }

  return {
    list: (filters = {}) =>
      read(() => {
        const store = requireStore();
        const q = filters.search?.trim().toLowerCase();
        return ctx.db.returns
          .filter((r) => r.storeId === store.id)
          .filter((r) => !filters.status || filters.status === 'all' || r.status === filters.status)
          .filter((r) => !q || r.returnNumber.toLowerCase().includes(q) || r.orderNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }),

    get: (id) => read(() => detail(owned(id))),

    decide: (id, { decision, reason }) =>
      write(() => {
        const u = requireMerchant();
        const r = owned(id);
        if (decision === 'rejected' && reason.trim().length < 5) {
          throw new ServiceError('VALIDATION', 'A reason is required when rejecting a return.', { reason: 'A reason is required when rejecting a return.' });
        }
        transition(r, decision);
        r.merchantResponse = reason.trim() || null;
        r.decidedAt = nowIso();
        audit(u, `return.${decision}`, 'return', r.id, { order: r.orderNumber });
        notifyCustomer(
          r,
          decision === 'approved' ? 'Return approved' : 'Return rejected',
          decision === 'approved'
            ? `${r.returnNumber} for ${r.orderNumber} was approved. ${r.storeName} will confirm how to send the item back.`
            : `${r.returnNumber} was rejected: ${r.merchantResponse}. You can escalate this to BazarHQ if you disagree.`,
        );
        return detail(r);
      }),

    setReturnMethod: (id, method) =>
      write(() => {
        requireMerchant();
        const r = owned(id);
        if (r.status !== 'approved') throw new ServiceError('CONFLICT', 'Set the return method after approving and before receiving the item.');
        r.returnMethod = method;
        notifyCustomer(
          r,
          'Return method confirmed',
          method === 'customer_drop_off' ? `Please drop the item at ${r.storeName}.` : `${r.storeName} will arrange to collect the item.`,
        );
        return detail(r);
      }),

    confirmReceipt: (id, { restock, note, idempotencyKey }) =>
      write(() => {
        const u = requireMerchant();
        const r = owned(id);
        if (seen(`return-receipt:${r.id}`, idempotencyKey)) return detail(r);
        if (!r.returnMethod) throw new ServiceError('VALIDATION', 'Record how the item is being returned before confirming receipt.');
        transition(r, 'received');
        r.receivedAt = nowIso();
        const order = ctx.db.orders.find((o) => o.id === r.orderId)!;
        if (restock) {
          // FR-RET-08: restore inventory after receipt and inspection, recorded with reason "return".
          for (const it of order.items) {
            const p = ctx.db.products.find((x) => x.id === it.productId);
            if (!p) continue;
            if (p.productType === 'simple') p.stockQuantity = (p.stockQuantity ?? 0) + it.quantity;
            else {
              const v = p.variants.find((x) => x.id === it.variantId);
              if (v) v.stockQuantity += it.quantity;
            }
            recordMovement({
              storeId: r.storeId,
              productId: it.productId,
              variantId: it.variantId,
              productName: it.productName,
              variantLabel: it.variantLabel,
              quantityDelta: it.quantity,
              reason: 'return',
              actorId: u.profile.id,
              actorName: u.profile.fullName,
              referenceType: 'return',
              referenceId: r.returnNumber,
              note: note.trim() || null,
            });
          }
        }
        audit(u, 'return.received', 'return', r.id, { restocked: restock });
        notifyCustomer(r, 'Return received', `${r.storeName} received your returned item for ${r.orderNumber}. A refund will follow.`);
        return detail(r);
      }),

    createRefund: (id, { amount, method, idempotencyKey }) =>
      write(() => {
        const u = requireMerchant();
        const r = owned(id);
        if (seen(`refund-create:${r.id}`, idempotencyKey)) return detail(r);
        if (r.status !== 'received') throw new ServiceError('CONFLICT', 'A refund can be created only after the return is approved and the item is received.');
        if (ctx.db.refunds.some((f) => f.returnId === r.id)) throw new ServiceError('CONFLICT', 'A refund already exists for this return.');
        const order = ctx.db.orders.find((o) => o.id === r.orderId)!;
        if (!(amount > 0) || amount > order.totalAmount)
          throw new ServiceError('VALIDATION', 'Refund amount must be between ৳1 and the order total.', {
            amount: 'Refund amount must be between ৳1 and the order total.',
          });
        if (order.paymentMethod === 'cod' && method === 'original_method') {
          throw new ServiceError('VALIDATION', 'COD orders are refunded by bank transfer or mobile money.', {
            method: 'Choose bank transfer or a mobile wallet for COD orders.',
          });
        }
        const f: Refund = {
          id: newId('4545'),
          returnId: r.id,
          returnNumber: r.returnNumber,
          orderId: order.id,
          orderNumber: order.orderNumber,
          storeId: r.storeId,
          storeName: r.storeName,
          customerName: r.customerName,
          amount,
          method,
          status: 'initiated',
          gatewayReference: null,
          confirmationReference: null,
          initiatorId: u.profile.id,
          initiatorName: u.profile.fullName,
          processedAt: null,
          createdAt: nowIso(),
          events: [{ status: 'initiated', actorName: u.profile.fullName, note: null, createdAt: nowIso() }],
        };
        ctx.db.refunds.push(f);
        audit(u, 'refund.initiated', 'refund', f.id, { amount, method });
        notifyCustomer(r, 'Refund initiated', `A refund of ৳${amount} for ${order.orderNumber} has been initiated. Expect it within 5–7 working days.`, f);
        return detail(r);
      }),

    markRefundProcessing: (refundId, note) =>
      write(() => {
        const u = requireMerchant();
        const f = ownedRefund(refundId);
        addRefundEvent(f, 'processing', u, note.trim() || null);
        const r = ctx.db.returns.find((x) => x.id === f.returnId)!;
        notifyCustomer(r, 'Refund processing', `Your refund for ${f.orderNumber} is being processed.`, f);
        return detail(r);
      }),

    recordRefundSettlement: (refundId, { reference, note, idempotencyKey }) =>
      write(() => {
        const u = requireMerchant();
        const f = ownedRefund(refundId);
        const r = ctx.db.returns.find((x) => x.id === f.returnId)!;
        if (seen(`refund-settle:${f.id}`, idempotencyKey)) return detail(r);
        settle(f, u, reference, note);
        return detail(r);
      }),

    markRefundFailed: (refundId, note) =>
      write(() => {
        const u = requireMerchant();
        const f = ownedRefund(refundId);
        if (note.trim().length < 5) throw new ServiceError('VALIDATION', 'Explain why the refund failed.', { note: 'Explain why the refund failed.' });
        addRefundEvent(f, 'failed', u, note.trim());
        const r = ctx.db.returns.find((x) => x.id === f.returnId)!;
        audit(u, 'refund.failed', 'refund', f.id, { note: note.trim() });
        notifyCustomer(r, 'Refund failed', `Your refund for ${f.orderNumber} could not be completed. The store will retry or contact you.`, f);
        return detail(r);
      }),
  };
}
