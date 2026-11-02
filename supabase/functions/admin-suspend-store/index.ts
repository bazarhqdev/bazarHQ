/**
 * admin-suspend-store — API-29/30 (FR-SA-11/12).
 *
 *   suspend   reason required; the merchant's store is unpublished (orders stay
 *             trackable), all their sessions end (profiles trigger, migration
 *             011) and new tokens are refused by the access-token hook.
 *   reinstate the account becomes active; the store stays unpublished until
 *             the merchant republishes it.
 * Super Admin with a verified TOTP session. Audited with actor and available request IP.
 */
import { requireSuperAdmin } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { invalid } from '../_shared/errors.ts';
import { handler } from '../_shared/http.ts';
import { optionalNote, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.object({ merchantId: uuid, action: z.enum(['suspend', 'reinstate']), reason: optionalNote(500) });

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  if (input.action === 'suspend' && (!input.reason || input.reason.length < 5)) {
    throw invalid('A suspension reason (5–500 characters) is required.', { reason: 'Required.' });
  }
  const admin = await requireSuperAdmin(req);
  return await rpc(serviceClient(), 'admin_set_merchant_status', {
    p_actor_id: admin.id,
    p_merchant_id: input.merchantId,
    p_action: input.action,
    p_reason: input.reason,
    p_ip: admin.ip,
  });
});

if (import.meta.main) Deno.serve(serve);
