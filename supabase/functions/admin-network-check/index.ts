/**
 * admin-network-check — FR-SA-01 / AUTH-08. Tells the admin sign-in screen
 * whether this request comes from an allowlisted network. It only answers for
 * the caller's own IP and is rate limited; the real enforcement is in
 * is_super_admin() (database) and the web middleware.
 */
import { clientIp } from '../_shared/auth.ts';
import { rateLimit, rpc, serviceClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';

export const serve = handler({ methods: ['POST', 'GET'], body: 'none' }, async ({ req }) => {
  const ip = clientIp(req);
  await rateLimit(`admin-network:${ip ?? 'unknown'}`, 30, 60);
  const allowed = ip ? await rpc<boolean>(serviceClient(), 'admin_network_check', { p_ip: ip }) : false;
  return { allowed, ip: ip ?? 'unknown' };
});

if (import.meta.main) Deno.serve(serve);
