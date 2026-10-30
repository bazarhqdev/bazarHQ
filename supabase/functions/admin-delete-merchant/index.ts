/**
 * admin-delete-merchant — API-31 (FR-SA-13). Requires the phrase
 * "DELETE <merchant email>". Personal data is removed or anonymised while
 * orders, payments and audit history are retained (§20.6). Audited.
 */
import { requireSuperAdmin } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { parse, uuid, z } from '../_shared/validation.ts';

const schema = z.object({ merchantId: uuid, confirmation: z.string().trim().min(8).max(300) });

export const serve = handler({}, async ({ req, body }) => {
  const input = parse(schema, body);
  const admin = await requireSuperAdmin(req);
  await rpc(serviceClient(), 'admin_delete_merchant', {
    p_actor_id: admin.id,
    p_merchant_id: input.merchantId,
    p_confirmation: input.confirmation,
    p_ip: admin.ip,
  });
  return { deleted: true };
});

if (import.meta.main) Deno.serve(serve);
