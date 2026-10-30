/**
 * escalate-support-ticket — FR-SUP-10. The ticket's customer can move it to the
 * Super Admin queue when the assigned merchant has not replied publicly within
 * 72 hours of creation. Reassignment never resets the timer (it counts from
 * created_at). The rule, audit entry and admin notification live in
 * public.escalate_ticket, which runs as the caller.
 */
import { requireActor } from '../_shared/auth.ts';
import { rpc, userClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { parse, uuid, z } from '../_shared/validation.ts';

const schema = z.object({ ticketId: uuid });

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await requireActor(req, ['customer']);
  return await rpc(userClient(actor.token), 'escalate_ticket', { p_ticket_id: input.ticketId });
});

if (import.meta.main) Deno.serve(serve);
