/**
 * In-app notifications, Realtime subscriptions and push device tokens
 * (FR-M-24, FR-C-20, FR-SUP-*, MOB-08..10).
 *
 * Realtime is used only where the brief needs live updates. Every channel is a
 * postgres_changes subscription on a table in the supabase_realtime
 * publication; Supabase applies the subscriber's RLS to each change, so a
 * filter here only narrows traffic — it never widens access.
 *
 *   everyone     notifications  (user_id = me)       new orders, low stock, ticket replies, admin alerts
 *   merchant     orders         (store_id = my store) new orders and status changes
 *                support_tickets(store_id = my store) ticket updates
 *   customer     orders         (customer_id = me)    order tracking
 *                support_tickets(customer_id = me)
 *                returns        (customer_id = me)
 *   super admin  support_tickets(queue = platform)    escalations
 *
 * FCM tokens go through the device-tokens Edge Function; raw tokens are never
 * read back (only a masked hint), and no push credential exists client-side.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { DeviceToken, Notification } from '../../types';
import type { NotificationService } from '../contracts';
import type { AuthModule } from './auth';
import type { AdapterContext } from './core';
import { mapNotification } from './mappers';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST JSON is narrowed field by field */
type Row = Record<string, any>;

export function createNotifications(ctx: AdapterContext, auth: AuthModule) {
  const { sb } = ctx;

  async function uid(): Promise<string> {
    return (await auth.requireSession()).user.id;
  }

  /** Opens the role's channels; calls `onChange` (debounced) on any relevant change. */
  async function openChannels(onChange: () => void): Promise<RealtimeChannel[]> {
    const s = await auth.buildSession();
    if (!s || s.user.id === 'pending-verification') return [];
    const me = s.user.id;
    const subs: { table: string; filter: string }[] = [{ table: 'notifications', filter: `user_id=eq.${me}` }];
    if (s.user.role === 'merchant' && s.store) {
      subs.push({ table: 'orders', filter: `store_id=eq.${s.store.id}` }, { table: 'support_tickets', filter: `store_id=eq.${s.store.id}` });
    } else if (s.user.role === 'customer') {
      subs.push(
        { table: 'orders', filter: `customer_id=eq.${me}` },
        { table: 'support_tickets', filter: `customer_id=eq.${me}` },
        { table: 'returns', filter: `customer_id=eq.${me}` },
      );
    } else if (s.user.role === 'super_admin') {
      subs.push({ table: 'support_tickets', filter: 'queue=eq.platform' });
    }
    const channel = sb.channel(`bazarhq:${me}:${Date.now().toString(36)}`);
    for (const sub of subs) {
      channel.on('postgres_changes' as never, { event: '*', schema: 'public', table: sub.table, filter: sub.filter } as never, () => onChange());
    }
    channel.subscribe();
    return [channel];
  }

  const service: NotificationService = {
    async list(filters = {}) {
      const me = await uid();
      let query = sb.from('notifications').select('*').eq('user_id', me);
      if (filters.unreadOnly) query = query.eq('is_read', false);
      const rows = await ctx.q<Row[]>(query.order('created_at', { ascending: false }).limit(200));
      return rows.map((r): Notification => mapNotification(r));
    },

    async unreadCount() {
      const s = await auth.buildSession();
      if (!s || s.user.id === 'pending-verification') return 0;
      const { count, error } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', s.user.id).eq('is_read', false);
      if (error) return 0;
      return count ?? 0;
    },

    async markRead(id) {
      const me = await uid();
      await ctx.q(sb.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', me));
      ctx.emit();
    },

    async markAllRead() {
      await uid();
      await ctx.rpc('mark_all_notifications_read');
      ctx.emit();
    },

    subscribe(listener) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const fire = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          auth.invalidate();
          listener();
        }, 250);
      };
      let channels: RealtimeChannel[] = [];
      let closed = false;
      void openChannels(fire)
        .then((c) => {
          if (closed) for (const ch of c) void sb.removeChannel(ch);
          else channels = c;
        })
        .catch(() => undefined);
      const offLocal = ctx.listen(fire);
      // Re-open with the right filters after sign-in / sign-out.
      const { data: authSub } = sb.auth.onAuthStateChange((event) => {
        if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
        for (const ch of channels) void sb.removeChannel(ch);
        channels = [];
        void openChannels(fire).then((c) => (closed ? c.forEach((ch) => void sb.removeChannel(ch)) : (channels = c)));
        fire();
      });
      return () => {
        closed = true;
        if (timer) clearTimeout(timer);
        offLocal();
        authSub.subscription.unsubscribe();
        for (const ch of channels) void sb.removeChannel(ch);
      };
    },

    async registerDevice({ token, platform }) {
      const r = await ctx.invoke<Row>('device-tokens', { action: 'register', token, platform });
      return {
        id: r.id,
        userId: r.user_id,
        tokenHint: r.token_hint,
        platform: 'android',
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
      } satisfies DeviceToken;
    },

    async unregisterDevice(token) {
      try {
        await ctx.invoke('device-tokens', { action: 'unregister', token });
      } catch {
        // Signing out must not fail because the token was already removed.
      }
    },
  };

  /**
   * Live updates for one order page (customer order detail, merchant order
   * detail). Guests on the public tracking page have no JWT and keep polling,
   * because RLS gives anonymous users no order rows to stream.
   */
  function subscribeToOrder(orderId: string, listener: () => void): () => void {
    const channel = sb
      .channel(`order:${orderId}:${Date.now().toString(36)}`)
      .on('postgres_changes' as never, { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` } as never, () => listener())
      .on('postgres_changes' as never, { event: 'INSERT', schema: 'public', table: 'delivery_events', filter: `order_id=eq.${orderId}` } as never, () => listener())
      .subscribe();
    return () => void sb.removeChannel(channel);
  }

  return { service, subscribeToOrder };
}
