/**
 * track-order — API-21 public order tracking (FR-C-23..29).
 *
 * No sign-in. Order ID + the phone used at checkout. Any mismatch gives the
 * same "not found" (no enumeration). Rate limited per client IP and per order
 * number. Orders delivered more than 90 days ago return only an archived
 * marker. Merchant contact is limited to phone/email (FR-C-25).
 */
import { clientIp } from '../_shared/auth.ts';
import { rateLimit, rpc, serviceClient } from '../_shared/db.ts';
import { notFound } from '../_shared/errors.ts';
import { handler } from '../_shared/http.ts';
import { bdPhone, parse, z } from '../_shared/validation.ts';

const schema = z.object({
  orderNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^ORD-\d{8}-[A-Z0-9]{6,12}$/, { error: 'Enter the Order ID exactly as shown, e.g. ORD-20261021-BHQ123456.' }),
  phone: bdPhone,
});

const NOT_FOUND = 'We couldn’t find an order with that Order ID and phone number.';

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const ip = clientIp(req) ?? 'unknown';
  await rateLimit(`track:ip:${ip}`, 10, 60, 'Too many tracking attempts. Please wait a minute and try again.');
  await rateLimit(`track:order:${input.orderNumber}`, 20, 3600, 'Too many tracking attempts. Please wait a minute and try again.');
  const result = await rpc<Record<string, unknown> | null>(serviceClient(), 'track_order', {
    p_order_number: input.orderNumber,
    p_phone: input.phone,
  });
  if (!result) throw notFound(NOT_FOUND);
  return result;
});

if (import.meta.main) Deno.serve(serve);
