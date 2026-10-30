/**
 * create-support-ticket — API-18 (FR-SUP-01..03).
 *
 * Signed-in customers only (guests cannot open tickets). Runs as the caller
 * (user JWT), so create_support_ticket sees auth.uid(): it validates the
 * optional order reference belongs to the customer, routes store/order/
 * payment/delivery/return tickets to the store's active merchant and
 * account/other tickets — or tickets for an inactive merchant — to the Super
 * Admin queue, starts the 72-hour response timer and writes the first message
 * and audit entry. Attachments are uploaded afterwards to
 * support-attachments/tickets/{ticket_id}/… and linked with a reply.
 */
import { requireActor } from '../_shared/auth.ts';
import { rateLimit, rpc, userClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { note, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.object({
  category: z.enum(['order', 'payment', 'delivery', 'return_refund', 'account', 'other'], { error: 'Choose a category.' }),
  subject: note(5, 150, 'Subject'),
  description: note(10, 5000, 'Description'),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  orderId: uuid.nullable().default(null),
});

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await requireActor(req, ['customer']);
  await rateLimit(`ticket:${actor.id}`, 10, 3600, 'You have opened several tickets recently. Please wait before opening another.');
  return await rpc(userClient(actor.token), 'create_support_ticket', {
    p_category: input.category,
    p_subject: input.subject,
    p_description: input.description,
    p_priority: input.priority,
    p_order_id: input.orderId,
  });
});

if (import.meta.main) Deno.serve(serve);
