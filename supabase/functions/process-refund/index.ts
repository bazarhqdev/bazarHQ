/**
 * process-refund — API-17 / API-42 refunds (§14.2).
 *
 *   create          initiated refund for a received return (one per return,
 *                   amount ≤ order total; COD orders cannot use original_method)
 *   mark_processing initiated → processing
 *   settle          → completed; needs the provider reference or manual
 *                   settlement evidence; marks the order payment refunded
 *   mark_failed     → failed with an explanation
 * Merchant of the order's store only (Super Admin uses
 * admin-refund-intervention). Clients can never complete a refund directly;
 * every transition is audited (refund history, FR-REF-06).
 */
import { requireMerchant } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { idempotencyKey, money, note, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    returnId: uuid,
    amount: money,
    method: z.enum(['original_method', 'bkash', 'nagad', 'rocket', 'bank_transfer'], { error: 'Choose a refund method.' }),
    idempotencyKey,
  }),
  z.object({ action: z.literal('mark_processing'), refundId: uuid, note: note(3, 500, 'Note') }),
  z.object({
    action: z.literal('settle'),
    refundId: uuid,
    reference: z.string().trim().min(3, { error: 'Enter the settlement reference.' }).max(120),
    referenceKind: z.enum(['confirmation', 'gateway']).default('confirmation'),
    note: note(3, 500, 'Note'),
    idempotencyKey,
  }),
  z.object({ action: z.literal('mark_failed'), refundId: uuid, note: note(3, 500, 'Reason') }),
]);

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await requireMerchant(req);
  const db = serviceClient();
  if (input.action === 'create') {
    return await rpc(db, 'create_refund', { p_actor_id: actor.id, p_return_id: input.returnId, p_amount: input.amount, p_method: input.method });
  }
  const to = input.action === 'mark_processing' ? 'processing' : input.action === 'settle' ? 'completed' : 'failed';
  return await rpc(db, 'update_refund_status', {
    p_actor_id: actor.id,
    p_refund_id: input.refundId,
    p_to_status: to,
    p_reference: input.action === 'settle' ? input.reference : null,
    p_note: input.note,
    p_reference_kind: input.action === 'settle' ? input.referenceKind : 'confirmation',
  });
});

if (import.meta.main) Deno.serve(serve);
