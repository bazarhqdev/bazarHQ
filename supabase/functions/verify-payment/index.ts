/**
 * verify-payment — API-43 and provider re-verification (Option B).
 *
 * mode = "provider": re-asks the wallet provider about the order's pending
 *   transaction ID (customer, owning merchant or Super Admin). Rate limited.
 * mode = "manual_review": the owning merchant or a Super Admin records an
 *   audited decision for a payment awaiting verification
 *   (pending_verification → paid | failed) with a mandatory reason. The
 *   database re-checks who may review (migration 004).
 */
import { clientIp, getActor, requireSuperAdmin } from '../_shared/auth.ts';
import { rateLimit, rpc, serviceClient, userClient } from '../_shared/db.ts';
import { conflict, forbidden, notFound, unauthenticated } from '../_shared/errors.ts';
import { handler } from '../_shared/http.ts';
import { verifyPendingWallet } from '../_shared/payments/verify.ts';
import { paymentSnapshot } from '../_shared/snapshot.ts';
import { idempotencyKey, note, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('provider'), orderId: uuid }),
  z.object({
    mode: z.literal('manual_review'),
    orderId: uuid,
    decision: z.enum(['paid', 'failed']),
    reason: note(5, 500, 'Reason'),
    idempotencyKey,
  }),
]);

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await getActor(req);
  if (!actor) throw unauthenticated('Please sign in to continue.');

  if (input.mode === 'provider') {
    const canRead = await rpc<boolean>(userClient(actor.token), 'can_read_order', { p_order_id: input.orderId });
    if (!canRead) throw notFound('Order not found');
    await rateLimit(`verify:${input.orderId}`, 6, 600);
    const outcome = await verifyPendingWallet(input.orderId, actor.id);
    return { outcome: outcome?.result ?? 'nothing_pending', ...(await paymentSnapshot(input.orderId)) };
  }

  // Manual review: owning merchant, or an AAL2-verified Super Admin.
  let reviewerIp: string | null = clientIp(req);
  if (actor.role === 'super_admin') {
    reviewerIp = (await requireSuperAdmin(req)).ip;
  } else if (actor.role === 'merchant') {
    // Same answer for "no such order" and "another store's order".
    const owns = await rpc<boolean>(userClient(actor.token), 'can_read_order', { p_order_id: input.orderId });
    if (!owns) throw notFound('Order not found');
  } else {
    throw forbidden();
  }
  const attempt = await rpc<{ id: string; amount: number; status: string } | null>(serviceClient(), 'pending_verification_attempt', {
    p_order_id: input.orderId,
  });
  if (!attempt) {
    const snap = await paymentSnapshot(input.orderId);
    // Idempotent replay: the same decision was already recorded.
    if (snap.paymentStatus === input.decision) return snap;
    throw conflict('Manual review is only for payments awaiting verification');
  }
  await rpc(serviceClient(), 'apply_payment_result', {
    p_transaction_id: attempt.id,
    p_result: input.decision,
    p_source: 'manual_review',
    p_provider_reference: null,
    p_actor_id: actor.id,
    p_reason: `${input.reason}${reviewerIp ? ` [ip ${reviewerIp}]` : ''}`.slice(0, 500),
    p_verified_amount: input.decision === 'paid' ? Number(attempt.amount) : null,
  });
  return await paymentSnapshot(input.orderId);
});

if (import.meta.main) Deno.serve(serve);
