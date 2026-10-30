/**
 * device-tokens — MOB-08 / AUTH-13. Stores or removes this device's FCM token
 * for the signed-in user (any role). The raw token is never returned; the
 * response carries a masked hint only.
 */
import { requireActor } from '../_shared/auth.ts';
import { rateLimit, rpc, serviceClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { parse, z } from '../_shared/validation.ts';

const token = z.string().trim().min(20, { error: 'Invalid device token.' }).max(4096, { error: 'Invalid device token.' });
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register'), token, platform: z.enum(['android', 'web']).default('android') }),
  z.object({ action: z.literal('unregister'), token }),
]);

export const serve = handler({ maxBytes: 8 * 1024 }, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await requireActor(req, ['customer', 'merchant', 'super_admin']);
  await rateLimit(`device-token:${actor.id}`, 30, 3600);
  if (input.action === 'register') {
    return await rpc(serviceClient(), 'register_device_token', { p_actor_id: actor.id, p_token: input.token, p_platform: input.platform });
  }
  await rpc(serviceClient(), 'unregister_device_token', { p_actor_id: actor.id, p_token: input.token });
  return { removed: true };
});

if (import.meta.main) Deno.serve(serve);
