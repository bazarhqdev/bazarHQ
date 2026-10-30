/**
 * admin-resolve-dispute — API-36 / FR-SA-21 for escalated returns: request
 * more information, override the merchant's rejection (the return becomes
 * approved) or close with the decision upheld. Audited. Ticket disputes are
 * resolved with the admin_resolve_ticket_dispute RPC directly from the admin
 * console (it runs as the caller and re-checks the Super Admin gate).
 */
import { requireSuperAdmin } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { note, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.object({ returnId: uuid, action: z.enum(['request_info', 'override', 'close']), note: note(5, 1000, 'Note') });

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const admin = await requireSuperAdmin(req);
  return await rpc(serviceClient(), 'admin_resolve_return_dispute', {
    p_actor_id: admin.id,
    p_return_id: input.returnId,
    p_action: input.action,
    p_note: `${input.note}`.slice(0, 1000),
  });
});

if (import.meta.main) Deno.serve(serve);
