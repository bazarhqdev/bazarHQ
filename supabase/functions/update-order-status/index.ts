/**
 * update-order-status — API-09 / API-10 (§13.1 order state machine).
 *
 * Merchant only, own store only. public.transition_order_status validates the
 * transition (pending → confirmed → processing → shipped → out_for_delivery →
 * delivered; cancellation needs a reason and is blocked once out for delivery
 * or delivered), locks the order, writes the delivery_events row (actor,
 * previous/new status, note or reason, timestamp), releases stock once on
 * cancellation, notifies the customer and audits — all in one transaction.
 * Repeating the same target status is a no-op (idempotent).
 * Super Admins are refused here by design (§13.1).
 */
import { requireMerchant } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { invalid } from '../_shared/errors.ts';
import { handler } from '../_shared/http.ts';
import { idempotencyKey, optionalNote, orderStatus, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.object({
  orderId: uuid,
  toStatus: orderStatus,
  note: optionalNote(1000),
  reason: optionalNote(500),
  proofPath: z
    .string()
    .regex(/^orders\/[0-9a-f-]{36}\/delivery\/[A-Za-z0-9._-]{1,120}$/, { error: 'Delivery proof must be stored under orders/{order_id}/delivery/.' })
    .optional()
    .transform((v) => v ?? null),
  idempotencyKey,
});

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  if (input.toStatus === 'cancelled' && (!input.reason || input.reason.length < 3)) {
    throw invalid('Give the customer a reason for cancelling (3–500 characters).', { reason: 'Required when cancelling.' });
  }
  if (input.proofPath && !input.proofPath.startsWith(`orders/${input.orderId}/`)) {
    throw invalid('Delivery proof must belong to this order.', { proofPath: 'Wrong order folder.' });
  }
  const actor = await requireMerchant(req);
  return await rpc(serviceClient(), 'transition_order_status', {
    p_actor_id: actor.id,
    p_order_id: input.orderId,
    p_to_status: input.toStatus,
    p_note: input.note,
    p_reason: input.reason,
    p_proof_path: input.proofPath,
  });
});

if (import.meta.main) Deno.serve(serve);
