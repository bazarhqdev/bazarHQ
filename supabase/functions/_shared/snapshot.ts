/** Current payment state of an order, in the frontend's camelCase shape. */
import { rpc, serviceClient } from './db.ts';

export interface PaymentSnapshot {
  orderId: string;
  paymentStatus: string;
  payment: {
    id: string;
    orderId: string;
    method: string;
    provider: string;
    status: string;
    amount: number;
    currency: string;
    providerReferenceMasked: string | null;
    createdAt: string;
    verifiedAt: string | null;
  } | null;
}

export async function paymentSnapshot(orderId: string): Promise<PaymentSnapshot> {
  // payment_transactions is not readable by service_role (migration 003); use the trusted reader (migration 014).
  const snap = await rpc<PaymentSnapshot | null>(serviceClient(), 'payment_snapshot', { p_order_id: orderId });
  if (!snap) return { orderId, paymentStatus: 'pending', payment: null };
  return {
    orderId: snap.orderId,
    paymentStatus: snap.paymentStatus,
    payment: snap.payment ? { ...snap.payment, amount: Number(snap.payment.amount) } : null,
  };
}
