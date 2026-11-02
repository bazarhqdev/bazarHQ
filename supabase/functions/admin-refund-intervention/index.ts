/**
 * admin-refund-intervention — FR-REF-07. A Super Admin can move a stalled
 * refund to processing, mark it failed, or settle it with evidence. Each step
 * is audited as refund.admin_intervention with the admin's id and available request IP.
 */
import { requireSuperAdmin } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { invalid } from '../_shared/errors.ts';
import { handler } from '../_shared/http.ts';
import { note, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.object({
  refundId: uuid,
  action: z.enum(['mark_processing', 'mark_failed', 'settle']),
  reference: z.string().trim().max(120).optional(),
  note: note(5, 500, 'Note'),
});

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  if (input.action === 'settle' && (!input.reference || input.reference.length < 3)) {
    throw invalid('Settling a refund needs the settlement reference.', { reference: 'Required.' });
  }
  const admin = await requireSuperAdmin(req);
  return await rpc(serviceClient(), 'admin_intervene_refund', {
    p_actor_id: admin.id,
    p_refund_id: input.refundId,
    p_action: input.action,
    p_reference: input.reference ?? null,
    p_note: `${input.note}${admin.ip ? ` [ip ${admin.ip}]` : ''}`.slice(0, 500),
  });
});

if (import.meta.main) Deno.serve(serve);
