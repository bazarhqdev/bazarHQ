/**
 * manage-return — API-16 merchant return workflow (§14.1).
 *
 *   decide          requested → approved | rejected (reason required to reject;
 *                   optional return method on approval)
 *   set_method      choose customer drop-off or merchant-coordinated pickup
 *   confirm_receipt approved → received, optionally restocking the returned
 *                   items once (inventory_movements reason "return")
 *   close           close a rejected or settled return
 * Merchant of the order's store only; every step is audited and notifies the
 * customer. Stock is only restored here, server-side.
 */
import { requireMerchant } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { idempotencyKey, note, optionalNote, parse, uuid, z } from '../_shared/validation.ts';

const returnMethod = z.enum(['customer_drop_off', 'merchant_coordinated'], { error: 'Choose a return method.' });

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('decide'),
    returnId: uuid,
    decision: z.enum(['approved', 'rejected']),
    reason: optionalNote(1000),
    returnMethod: returnMethod.optional(),
  }),
  z.object({ action: z.literal('set_method'), returnId: uuid, method: returnMethod }),
  z.object({ action: z.literal('confirm_receipt'), returnId: uuid, restock: z.boolean(), note: note(3, 1000, 'Inspection note'), idempotencyKey }),
  z.object({ action: z.literal('close'), returnId: uuid, note: optionalNote(1000) }),
]);

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await requireMerchant(req);
  const db = serviceClient();
  switch (input.action) {
    case 'decide':
      return await rpc(db, 'decide_return', {
        p_actor_id: actor.id,
        p_return_id: input.returnId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_return_method: input.returnMethod ?? null,
      });
    case 'set_method':
      return await rpc(db, 'set_return_method', { p_actor_id: actor.id, p_return_id: input.returnId, p_method: input.method });
    case 'confirm_receipt':
      return await rpc(db, 'confirm_return_receipt', {
        p_actor_id: actor.id,
        p_return_id: input.returnId,
        p_restock: input.restock,
        p_note: input.note,
      });
    case 'close':
      return await rpc(db, 'close_return', { p_actor_id: actor.id, p_return_id: input.returnId, p_note: input.note });
  }
});

if (import.meta.main) Deno.serve(serve);
