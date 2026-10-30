/**
 * create-order — API-07 POST /orders (FR-C-13..19, atomic order creation).
 *
 * Auth: optional. Signed-in callers must be customers; no token = guest checkout.
 * The whole order runs in one transaction inside public.create_order: customer,
 * store and product checks, row locks in a fixed order, stock decrement,
 * order + items + first payment attempt + inventory movements. Any failure
 * rolls everything back. The idempotency key makes retries safe: the same key
 * and cart return the original order; the same key with a different cart is a
 * 409.
 */
import { clientIp, getActor } from '../_shared/auth.ts';
import { rateLimit, rpc, serviceClient } from '../_shared/db.ts';
import { forbidden } from '../_shared/errors.ts';
import { handler } from '../_shared/http.ts';
import { bdPhone, idempotencyKey, money, parse, paymentMethod, uuid, z } from '../_shared/validation.ts';

const schema = z.object({
  storeId: uuid,
  items: z
    .array(
      z.object({
        productId: uuid,
        variantId: uuid.nullable().default(null),
        quantity: z.number().int({ error: 'Quantity must be a whole number.' }).min(1).max(1000),
        expectedUnitPrice: money,
      }),
    )
    .min(1, { error: 'Your cart is empty.' })
    .max(50, { error: 'An order can have at most 50 lines.' }),
  delivery: z.object({
    recipientName: z.string().trim().min(2, { error: 'Enter the recipient’s full name.' }).max(100),
    phone: bdPhone,
    email: z.string().trim().email({ error: 'Enter a valid email address.' }).max(254).nullable().optional(),
    address: z.string().trim().min(5, { error: 'Enter the delivery address.' }).max(300),
    district: z.string().trim().min(2, { error: 'Choose a district.' }).max(60),
    postalCode: z.string().trim().regex(/^\d{4}$/, { error: 'Postal code must be 4 digits.' }).nullable().optional(),
  }),
  paymentMethod,
  saveAddress: z.boolean().default(false),
  idempotencyKey,
});

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await getActor(req);
  if (actor && actor.role !== 'customer') {
    throw forbidden('Only customer accounts can place orders.');
  }
  await rateLimit(`create-order:${actor?.id ?? clientIp(req) ?? 'unknown'}`, 20, 600, 'Too many orders in a short time. Please wait a few minutes.');

  return await rpc(serviceClient(), 'create_order', {
    p_actor_id: actor?.id ?? null,
    p_store_id: input.storeId,
    p_items: input.items.map((i) => ({
      product_id: i.productId,
      variant_id: i.variantId,
      quantity: i.quantity,
      expected_unit_price: i.expectedUnitPrice,
    })),
    p_delivery: {
      recipient_name: input.delivery.recipientName,
      phone: input.delivery.phone,
      email: input.delivery.email ?? null,
      address: input.delivery.address,
      district: input.delivery.district,
      postal_code: input.delivery.postalCode ?? null,
    },
    p_payment_method: input.paymentMethod,
    p_idempotency_key: input.idempotencyKey,
    p_save_address: actor ? input.saveAddress : false,
  });
});

if (import.meta.main) Deno.serve(serve);
