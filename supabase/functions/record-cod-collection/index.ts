/**
 * record-cod-collection — DM-05. The owning merchant records the cash actually
 * collected for a COD order once it is out for delivery or delivered. The
 * amount must equal the order total. payment_status moves cod_pending →
 * cod_collected and a delivery_events row (cod_collected, amount) is written.
 * A second call is an idempotent no-op.
 */
import { requireMerchant } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { idempotencyKey, money, optionalNote, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.object({ orderId: uuid, amount: money, note: optionalNote(1000), idempotencyKey });

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await requireMerchant(req);
  return await rpc(serviceClient(), 'record_cod_collection', {
    p_actor_id: actor.id,
    p_order_id: input.orderId,
    p_amount: input.amount,
    p_note: input.note,
  });
});

if (import.meta.main) Deno.serve(serve);
