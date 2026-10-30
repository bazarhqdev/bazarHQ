/**
 * adjust-inventory — FR-M-22 trusted stock adjustment.
 *
 * Merchant only. One manual_adjustment row in the append-only
 * inventory_movements ledger per call; the stock row is locked, and stock can
 * never go below zero (database CHECK + function guard). The idempotency key
 * makes retries return the original movement instead of adjusting twice.
 */
import { requireMerchant } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { idempotencyKey, note, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.object({
  productId: uuid,
  variantId: uuid.nullable().default(null),
  delta: z
    .number()
    .int({ error: 'Use a whole number.' })
    .min(-100000)
    .max(100000)
    .refine((v) => v !== 0, { error: 'Adjustment cannot be zero.' }),
  note: note(3, 500, 'Note'),
  idempotencyKey,
});

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await requireMerchant(req);
  return await rpc(serviceClient(), 'adjust_inventory', {
    p_actor_id: actor.id,
    p_product_id: input.productId,
    p_variant_id: input.variantId,
    p_delta: input.delta,
    p_note: input.note,
    p_idempotency_key: input.idempotencyKey,
  });
});

if (import.meta.main) Deno.serve(serve);
