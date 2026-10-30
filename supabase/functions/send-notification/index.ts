/**
 * send-notification — scheduled dispatcher (MOB-08, FR-SA-16).
 *
 * Called by the scheduler (pg_cron + pg_net, or any cron) with the
 * x-cron-secret header — never by browsers or the app. Each run:
 *   1. sends announcements whose scheduled time has passed (in-app rows);
 *   2. claims undelivered notification rows (FOR UPDATE SKIP LOCKED, so
 *      parallel runs never double-send) and pushes them through FCM HTTP v1;
 *      tokens FCM reports as invalid are deleted.
 * In-app notifications and Realtime work without FCM; push is skipped (rows
 * are left unclaimed) until FCM credentials are configured.
 */
import { requireCronSecret } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { env } from '../_shared/env.ts';
import { handler, logError } from '../_shared/http.ts';
import { sendPush } from '../_shared/push.ts';

interface Claimed {
  id: string;
  type: string;
  title: string;
  body: string;
  reference_type: string | null;
  reference_id: string | null;
  tokens: string[];
}

export const serve = handler({ cors: false, body: 'none' }, async ({ req, requestId }) => {
  requireCronSecret(req);
  const db = serviceClient();
  const announcements = await rpc<number>(db, 'dispatch_due_announcements');

  const fcm = env.fcm;
  if (!fcm) return { announcements, pushed: 0, invalidTokens: 0, failed: 0, push: 'not_configured' };

  const claimed = await rpc<Claimed[]>(db, 'claim_pending_push_notifications', { p_limit: 200 });
  let pushed = 0;
  let failed = 0;
  const invalid = new Set<string>();
  for (const n of claimed) {
    for (const token of n.tokens) {
      try {
        const result = await sendPush(fcm, {
          token,
          title: n.title,
          body: n.body,
          data: { notificationId: n.id, type: n.type, referenceType: n.reference_type ?? '', referenceId: n.reference_id ?? '' },
        });
        if (result === 'sent') pushed++;
        else if (result === 'invalid_token') invalid.add(token);
        else failed++;
      } catch (e) {
        failed++;
        logError(requestId, 'fcm.send', e);
      }
    }
  }
  if (invalid.size) await db.from('device_tokens').delete().in('token', [...invalid]);
  return { announcements, notifications: claimed.length, pushed, invalidTokens: invalid.size, failed };
});

if (import.meta.main) Deno.serve(serve);
