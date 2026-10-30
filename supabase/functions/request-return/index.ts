/**
 * request-return — API-15 customer returns (§14.1, FR-RET-01..09).
 *
 *   create          one return per delivered order, inside the store's return
 *                   window (default 7 calendar days from delivery); reason and
 *                   condition description required
 *   attach_evidence link a photo the customer uploaded to
 *                   return-evidence/returns/{return_id}/{file} (Storage RLS
 *                   only lets the return's customer upload there)
 *   escalate        ask BazarHQ to review a rejected return (once)
 * The window, ownership and state rules are enforced in the database.
 */
import { requireActor } from '../_shared/auth.ts';
import { rpc, serviceClient, userClient } from '../_shared/db.ts';
import { HttpError } from '../_shared/errors.ts';
import { handler } from '../_shared/http.ts';
import { idempotencyKey, money, note, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    orderId: uuid,
    reason: z.enum(['wrong_item', 'damaged', 'not_as_described', 'change_of_mind', 'other'], { error: 'Choose a reason.' }),
    conditionDescription: note(10, 1000, 'Description'),
    refundAmountRequested: money.optional(),
    idempotencyKey,
  }),
  z.object({
    action: z.literal('attach_evidence'),
    returnId: uuid,
    storagePath: z.string().regex(/^returns\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/, { error: 'Upload the photo first.' }),
  }),
  z.object({ action: z.literal('escalate'), returnId: uuid, note: note(10, 1000, 'Note') }),
]);

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await requireActor(req, ['customer']);
  if (input.action === 'create') {
    try {
      return await rpc(serviceClient(), 'request_return', {
        p_actor_id: actor.id,
        p_order_id: input.orderId,
        p_reason: input.reason,
        p_condition_description: input.conditionDescription,
        p_refund_amount_requested: input.refundAmountRequested ?? null,
      });
    } catch (e) {
      // Idempotent retry: the same customer already requested a return for this order.
      if (e instanceof HttpError && e.reason === '23505') {
        const { data } = await serviceClient()
          .from('returns')
          .select('*')
          .eq('order_id', input.orderId)
          .eq('customer_id', actor.id)
          .maybeSingle();
        if (data) return { return: data, refund: null, replayed: true };
      }
      throw e;
    }
  }
  if (input.action === 'attach_evidence') {
    if (!input.storagePath.startsWith(`returns/${input.returnId}/`)) {
      throw new HttpError(422, 'VALIDATION', 'The photo belongs to a different return.');
    }
    return await rpc(userClient(actor.token), 'attach_return_evidence', { p_return_id: input.returnId, p_storage_path: input.storagePath });
  }
  return await rpc(serviceClient(), 'escalate_return', { p_actor_id: actor.id, p_return_id: input.returnId, p_note: input.note });
});

if (import.meta.main) Deno.serve(serve);
