/**
 * Super Admin console on Supabase (SRS §12, API-27..36, FR-SA-*).
 *
 * Every call first refreshes the admin session (TOTP/AAL2 + approved network +
 * 30-minute idle timer). The database re-checks the same gate in
 * is_super_admin(), so this client check is only for UX.
 *
 * Reads: Super Admin RLS policies and admin_* SECURITY DEFINER read RPCs.
 * Privileged writes (suspend, delete, governance, refund intervention, return
 * disputes, manual payment review): Edge Functions that verify TOTP and the
 * caller's network, and write audit_logs with the admin's id and IP.
 * There is no admin path that changes an ordinary order or delivery status.
 */
import { ORDER_STATUSES, PAYMENT_METHODS } from '../../constants';
import type {
  AccountUser,
  AdminCustomerRow,
  AdminDashboard,
  AdminMerchantRow,
  Announcement,
  Dispute,
  HealthStatus,
  OrderStatus,
  Policy,
  Refund,
  SeriesPoint,
  Store,
  SystemHealth,
  ThemeAdmin,
} from '../../types';
import { daysInRange, metric } from '../analytics';
import { ServiceError, type AdminOrderRow, type AdminService, type AdminStoreRow } from '../contracts';
import type { AuthModule } from './auth';
import { toServiceError, type AdapterContext } from './core';
import {
  mapAnnouncement,
  mapAuditLog,
  mapOrder,
  mapPolicy,
  mapReturn,
  mapStore,
  mapTheme,
  ORDER_COLUMNS,
  REFUND_COLUMNS,
  RETURN_COLUMNS,
  STORE_COLUMNS,
  TICKET_COLUMNS,
} from './mappers';
import type { MerchantModule } from './merchant';

/* eslint-disable @typescript-eslint/no-explicit-any -- RPC and PostgREST JSON is narrowed field by field */
type Row = Record<string, any>;

const DAY = 86_400_000;
const startOf = (day: string) => `${day.slice(0, 10)}T00:00:00+06:00`;
const endOf = (day: string) => new Date(Date.parse(`${day.slice(0, 10)}T00:00:00+06:00`) + DAY).toISOString();
const STALLED_MS = 3 * DAY; // same rule as admin_dashboard().stalled_refunds

export function createAdmin(
  ctx: AdapterContext,
  auth: AuthModule,
  shared: Pick<MerchantModule, 'orderDetail' | 'returnDetail' | 'refundWithEvents' | 'ticketDetail' | 'ticketsWithNames' | 'replyWithAttachment'>,
) {
  const { sb } = ctx;
  const gate = () => auth.requireAdminSession();

  async function namesOf(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await ctx.q<Row[]>(sb.from('profiles').select('id, full_name').in('id', unique));
    return new Map(rows.map((r) => [r.id as string, r.full_name as string]));
  }

  function accountUser(r: Row, role: AccountUser['role']): AccountUser {
    return {
      id: r.id,
      email: r.email ?? '',
      emailVerified: r.email_verified !== false,
      pendingEmail: null,
      authProvider: 'email',
      twoFactorEnabled: false,
      createdAt: r.created_at,
      fullName: r.full_name,
      phone: r.phone ?? null,
      avatarUrl: null,
      role,
      status: r.status,
      suspensionReason: r.suspension_reason ?? null,
    };
  }

  async function storesByOwner(ownerIds: string[]): Promise<Map<string, Store>> {
    if (!ownerIds.length) return new Map();
    const rows = await ctx.q<Row[]>(sb.from('stores').select(STORE_COLUMNS).in('owner_id', ownerIds));
    const urls = await ctx.signedUrls(
      'store-logos',
      rows.flatMap((r) => [r.logo_url, r.banner_url]),
    );
    return new Map(rows.map((r) => [r.owner_id as string, mapStore(r, { logo: urls.get(r.logo_url) ?? null, banner: urls.get(r.banner_url) ?? null })]));
  }

  async function merchantRows(search?: string, status: string = 'all'): Promise<AdminMerchantRow[]> {
    const rows = await ctx.rpc<Row[]>('admin_list_merchants', { p_search: search?.trim() || null, p_status: status });
    const stores = await storesByOwner(rows.map((r) => r.id));
    return rows.map((r) => ({
      merchant: accountUser(r, 'merchant'),
      store: stores.get(r.id) ?? null,
      productCount: Number(r.product_count ?? 0),
      orderCount: Number(r.order_count ?? 0),
      revenue: Number(r.revenue ?? 0),
    }));
  }

  async function merchantDetail(id: string) {
    const row = (await merchantRows()).find((m) => m.merchant.id === id);
    if (!row) throw new ServiceError('NOT_FOUND', 'This merchant could not be found.');
    const [orders, tickets, sessions] = await Promise.all([
      row.store
        ? ctx.q<Row[]>(sb.from('orders').select(ORDER_COLUMNS).eq('store_id', row.store.id).order('created_at', { ascending: false }).limit(10))
        : Promise.resolve([] as Row[]),
      row.store
        ? sb.from('support_tickets').select('id', { count: 'exact', head: true }).eq('store_id', row.store.id).in('status', ['open', 'in_progress', 'waiting_for_customer'])
        : Promise.resolve({ count: 0 }),
      ctx.rpc<number>('admin_user_session_count', { p_user_id: id }).catch(() => 0),
    ]);
    return { ...row, recentOrders: orders.map((o) => mapOrder(o)), openTickets: tickets.count ?? 0, activeSessions: Number(sessions ?? 0) };
  }

  async function customerRows(search?: string): Promise<AdminCustomerRow[]> {
    const rows = await ctx.rpc<Row[]>('admin_list_customers', { p_search: search?.trim() || null });
    return rows.map((r) => ({
      customer: accountUser(r, 'customer'),
      orderCount: Number(r.order_count ?? 0),
      totalSpent: Number(r.total_spent ?? 0),
      lastOrderAt: r.last_order_at ?? null,
      addresses: Number(r.addresses ?? 0),
    }));
  }

  async function themeRows(): Promise<ThemeAdmin[]> {
    const [themes, stores] = await Promise.all([
      ctx.q<Row[]>(sb.from('themes').select('*').order('name')),
      ctx.q<Row[]>(sb.from('stores').select('id, name, theme_id').not('theme_id', 'is', null)),
    ]);
    return themes.map((t) => ({
      ...mapTheme(t),
      usedBy: stores.filter((s) => s.theme_id === t.id).map((s) => ({ storeId: s.id, storeName: s.name })),
      breakingChangeEffectiveAt: t.breaking_change_effective_at ?? null,
      createdAt: t.created_at,
    }));
  }

  async function announcements(): Promise<Announcement[]> {
    const rows = await ctx.q<Row[]>(sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(500));
    const names = await namesOf(rows.map((r) => r.sent_by));
    return rows.map((r) => mapAnnouncement(r, names));
  }

  async function policies(): Promise<Policy[]> {
    const rows = await ctx.q<Row[]>(sb.from('policies').select('*').order('created_at', { ascending: false }).limit(500));
    const names = await namesOf(rows.flatMap((r) => [r.submitted_by, r.approved_by]));
    return rows.map((r) => mapPolicy(r, names));
  }

  async function refundById(id: string): Promise<Refund> {
    const row = await ctx.q<Row | null>(sb.from('refunds').select(REFUND_COLUMNS).eq('id', id).maybeSingle());
    if (!row) throw new ServiceError('NOT_FOUND', 'This refund could not be found.');
    return await shared.refundWithEvents(row);
  }

  async function orderWithStore(id: string) {
    const row = await ctx.q<Row | null>(sb.from('orders').select('id, store:stores(name)').eq('id', id).maybeSingle());
    if (!row) throw new ServiceError('NOT_FOUND', 'Order not found.');
    return { ...(await shared.orderDetail(id, 'any')), storeName: row.store?.name ?? 'Unknown store' };
  }

  async function health(): Promise<SystemHealth> {
    const r = await ctx.invoke<SystemHealth>('admin-health', {});
    return { overall: r.overall, components: r.components ?? [], recentLogs: r.recentLogs ?? [] };
  }

  const admin: AdminService = {
    async dashboard(range) {
      await gate();
      const [d, logs, h] = await Promise.all([
        ctx.rpc<Row>('admin_dashboard', { p_from: startOf(range.from), p_to: endOf(range.to) }),
        ctx.q<Row[]>(sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(8)),
        health().catch(() => ({ overall: 'degraded' as HealthStatus })),
      ]);
      const names = await namesOf(logs.map((l) => l.actor_id));
      const byDay = new Map(((d.series ?? []) as Row[]).map((p) => [String(p.date).slice(0, 10), p]));
      const series: SeriesPoint[] = daysInRange(range).map((day) => {
        const p = byDay.get(day);
        return {
          date: day,
          revenue: Number(p?.revenue ?? 0),
          orders: Number(p?.orders ?? 0),
          cancelled: Number(p?.cancelled ?? 0),
          visitors: Number(p?.visitors ?? 0),
        };
      });
      const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, Number((d.orders_by_status ?? {})[s] ?? 0)])) as Record<OrderStatus, number>;
      const pm = new Map(((d.payment_methods ?? []) as Row[]).map((m) => [m.method as string, m]));
      return {
        merchants: metric(Number(d.merchants ?? 0), Number(d.merchants_previous ?? d.merchants ?? 0)),
        activeStores: metric(Number(d.active_stores ?? 0), Number(d.active_stores ?? 0)),
        // Both periods count non-cancelled orders (dashboard_payload).
        orders: metric(Number(d.orders ?? 0), Number(d.previous_orders ?? 0)),
        revenue: metric(Number(d.revenue ?? 0), Number(d.previous_revenue ?? 0)),
        customers: metric(Number(d.customers_total ?? 0), Number(d.customers_previous ?? d.customers_total ?? 0)),
        ordersByStatus: byStatus,
        series,
        topMerchants: ((d.top_merchants ?? []) as Row[]).map((t) => ({ storeId: t.store_id, storeName: t.store_name, revenue: Number(t.revenue), orders: Number(t.orders) })),
        paymentMethodBreakdown: PAYMENT_METHODS.map((method) => ({
          method,
          orders: Number(pm.get(method)?.orders ?? 0),
          revenue: Number(pm.get(method)?.revenue ?? 0),
        })),
        recentActivity: logs.map((l) => mapAuditLog(l, names)),
        openDisputes: Number(d.open_disputes ?? 0),
        stalledRefunds: Number(d.stalled_refunds ?? 0),
        health: h.overall,
      } satisfies AdminDashboard;
    },

    async health() {
      await gate();
      return await health();
    },

    async listMerchants(filters = {}) {
      await gate();
      return await merchantRows(filters.search, filters.status ?? 'all');
    },

    async getMerchant(id) {
      await gate();
      return await merchantDetail(id);
    },

    async suspendMerchant(id, reason) {
      await gate();
      await ctx.invoke('admin-suspend-store', { merchantId: id, action: 'suspend', reason });
      return await merchantDetail(id);
    },

    async reinstateMerchant(id) {
      await gate();
      await ctx.invoke('admin-suspend-store', { merchantId: id, action: 'reinstate' });
      return await merchantDetail(id);
    },

    async deleteMerchant(id, phrase) {
      await gate();
      await ctx.invoke('admin-delete-merchant', { merchantId: id, confirmation: phrase });
    },

    async listCustomers(filters = {}) {
      await gate();
      return await customerRows(filters.search);
    },

    async getCustomer(id) {
      await gate();
      const row = (await customerRows()).find((c) => c.customer.id === id);
      if (!row) throw new ServiceError('NOT_FOUND', 'This customer could not be found.');
      const orders = await ctx.q<Row[]>(
        sb.from('orders').select(`${ORDER_COLUMNS}, store:stores(name)`).eq('customer_id', id).order('created_at', { ascending: false }).limit(200),
      );
      return { ...row, orders: orders.map((o) => ({ ...mapOrder(o), storeName: o.store?.name ?? 'Unknown store' })) };
    },

    async listStores(filters = {}) {
      await gate();
      let query = sb.from('stores').select(STORE_COLUMNS);
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      const [rows, merchants, themes] = await Promise.all([
        ctx.q<Row[]>(query.order('created_at', { ascending: false }).limit(1000)),
        ctx.rpc<Row[]>('admin_list_merchants', { p_search: null, p_status: 'all' }),
        ctx.q<Row[]>(sb.from('themes').select('id, name')),
      ]);
      const owner = new Map(merchants.map((m) => [m.id as string, m]));
      const themeName = new Map(themes.map((t) => [t.id as string, t.name as string]));
      const urls = await ctx.signedUrls(
        'store-logos',
        rows.flatMap((r) => [r.logo_url, r.banner_url]),
      );
      const q = filters.search?.trim().toLowerCase();
      return rows
        .map(
          (r): AdminStoreRow => ({
            ...mapStore(r, { logo: urls.get(r.logo_url) ?? null, banner: urls.get(r.banner_url) ?? null }),
            ownerName: owner.get(r.owner_id)?.full_name ?? 'Deleted merchant',
            ownerEmail: owner.get(r.owner_id)?.email ?? '',
            themeName: r.theme_id ? (themeName.get(r.theme_id) ?? null) : null,
            productCount: Number(owner.get(r.owner_id)?.product_count ?? 0),
            orderCount: Number(owner.get(r.owner_id)?.order_count ?? 0),
          }),
        )
        .filter((s) => !q || s.name.toLowerCase().includes(q) || s.subdomain.includes(q) || s.ownerName.toLowerCase().includes(q));
    },

    async listOrders(filters = {}) {
      await gate();
      let query = sb.from('orders').select(`${ORDER_COLUMNS}, store:stores(name)`, { count: 'exact' });
      if (filters.storeId) query = query.eq('store_id', filters.storeId);
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      if (filters.paymentStatus && filters.paymentStatus !== 'all') query = query.eq('payment_status', filters.paymentStatus);
      if (filters.paymentMethod && filters.paymentMethod !== 'all') query = query.eq('payment_method', filters.paymentMethod);
      if (filters.from) query = query.gte('created_at', startOf(filters.from));
      if (filters.to) query = query.lt('created_at', endOf(filters.to));
      const { data, count, error } = await query.order('created_at', { ascending: false }).limit(1000);
      if (error) throw toServiceError(error);
      const q = filters.search?.trim().toLowerCase();
      const items = ((data ?? []) as Row[])
        .map((o): AdminOrderRow => ({ ...mapOrder(o), storeName: o.store?.name ?? 'Unknown store' }))
        .filter((o) => !q || o.orderNumber.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) || o.storeName.toLowerCase().includes(q));
      return { items, total: q ? items.length : (count ?? items.length) };
    },

    async getOrder(id) {
      await gate();
      return await orderWithStore(id);
    },

    async reviewPayment(orderId, { decision, reason, idempotencyKey }) {
      await gate();
      await ctx.invoke('verify-payment', { mode: 'manual_review', orderId, decision, reason, idempotencyKey });
      return await orderWithStore(orderId);
    },

    async listThemes() {
      await gate();
      return await themeRows();
    },

    async saveTheme(input, id) {
      await gate();
      const row = await ctx.invoke<Row>('admin-governance', {
        op: 'theme.save',
        ...(id ? { id } : {}),
        name: input.name,
        description: input.description,
        accent: input.accent,
        isActive: input.isActive,
        breaking: !!input.breaking,
      });
      const saved = (await themeRows()).find((t) => t.id === row.id);
      if (!saved) throw new ServiceError('NOT_FOUND', 'Theme not found.');
      return saved;
    },

    async deleteTheme(id) {
      await gate();
      await ctx.invoke('admin-governance', { op: 'theme.delete', id });
    },

    async listAnnouncements() {
      await gate();
      return await announcements();
    },

    async recipientCount(audience) {
      await gate();
      return Number(await ctx.rpc<number>('admin_announcement_recipient_count', { p_audience: audience }));
    },

    async saveAnnouncement(input, action, id) {
      await gate();
      const row = await ctx.invoke<Row>('admin-governance', {
        op: 'announcement.save',
        ...(id ? { id } : {}),
        title: input.title,
        body: input.body,
        audience: input.audience,
        scheduledAt: action === 'schedule' ? input.scheduledAt : null,
        action,
      });
      return mapAnnouncement(row, await namesOf([row.sent_by]));
    },

    async cancelAnnouncement(id) {
      await gate();
      const row = await ctx.invoke<Row>('admin-governance', { op: 'announcement.unschedule', id });
      return mapAnnouncement(row, new Map());
    },

    async deleteAnnouncement(id) {
      await gate();
      await ctx.invoke('admin-governance', { op: 'announcement.delete', id });
    },

    async listPolicies() {
      await gate();
      return await policies();
    },

    async submitPolicy(input) {
      await gate();
      const row = await ctx.invoke<Row>('admin-governance', { op: 'policy.submit', ...input });
      return mapPolicy(row, await namesOf([row.submitted_by, row.approved_by]));
    },

    async approvePolicy(id) {
      await gate();
      const row = await ctx.invoke<Row>('admin-governance', { op: 'policy.approve', id });
      return mapPolicy(row, await namesOf([row.submitted_by, row.approved_by]));
    },

    async publishPolicy(id) {
      await gate();
      const row = await ctx.invoke<Row>('admin-governance', { op: 'policy.publish', id });
      return mapPolicy(row, await namesOf([row.submitted_by, row.approved_by]));
    },

    async listTickets(filters = {}) {
      await gate();
      let query = sb.from('support_tickets').select(TICKET_COLUMNS);
      if (filters.queue && filters.queue !== 'all') query = query.eq('queue', filters.queue);
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      if (filters.escalatedOnly) query = query.not('escalation_at', 'is', null);
      const rows = await ctx.q<Row[]>(query.order('updated_at', { ascending: false }).limit(1000));
      const tickets = await shared.ticketsWithNames(rows);
      const q = filters.search?.trim().toLowerCase();
      return tickets.filter(
        (t) =>
          !q ||
          t.subject.toLowerCase().includes(q) ||
          t.ticketNumber.toLowerCase().includes(q) ||
          t.customerName.toLowerCase().includes(q) ||
          (t.storeName ?? '').toLowerCase().includes(q),
      );
    },

    async getTicket(id) {
      await gate();
      return await shared.ticketDetail(id);
    },

    async replyTicket(id, { body }) {
      await gate();
      await shared.replyWithAttachment(id, body, null);
      return await shared.ticketDetail(id);
    },

    async updateTicketStatus(id, to, input = {}) {
      await gate();
      await ctx.rpc('update_ticket_status', { p_ticket_id: id, p_to_status: to, p_resolution_note: input.resolutionNote ?? null });
      return await shared.ticketDetail(id);
    },

    async listDisputes(filters = {}) {
      await gate();
      const statuses = (filters.status ?? 'open') === 'open' ? ['open', 'info_requested'] : ['open', 'info_requested', 'resolved'];
      const [returns, ticketRows] = await Promise.all([
        ctx.q<Row[]>(sb.from('returns').select(RETURN_COLUMNS).in('dispute_status', statuses).limit(500)),
        ctx.q<Row[]>(sb.from('support_tickets').select(TICKET_COLUMNS).in('dispute_status', statuses).limit(500)),
      ]);
      const tickets = await shared.ticketsWithNames(ticketRows);
      const out: Dispute[] = [
        ...returns.map((row) => {
          const r = mapReturn(row);
          return {
            kind: 'return' as const,
            id: r.id,
            reference: r.returnNumber,
            title: `Rejected return · ${r.orderNumber}`,
            storeName: r.storeName || null,
            customerName: r.customerName,
            status: r.dispute.status,
            escalatedAt: r.dispute.escalatedAt ?? r.createdAt,
          };
        }),
        ...tickets.map((t) => ({
          kind: 'ticket' as const,
          id: t.id,
          reference: t.ticketNumber,
          title: t.subject,
          storeName: t.storeName,
          customerName: t.customerName,
          status: t.dispute.status,
          escalatedAt: t.escalationAt ?? t.createdAt,
        })),
      ];
      return out.sort((a, b) => b.escalatedAt.localeCompare(a.escalatedAt));
    },

    async getReturnDispute(id) {
      await gate();
      return await shared.returnDetail(id);
    },

    async resolveDispute(kind, id, { action, note }) {
      await gate();
      if (kind === 'return') await ctx.invoke('admin-resolve-dispute', { returnId: id, action, note });
      else await ctx.rpc('admin_resolve_ticket_dispute', { p_ticket_id: id, p_action: action, p_note: note });
    },

    async listRefunds(filters = {}) {
      await gate();
      let query = sb.from('refunds').select(`${REFUND_COLUMNS}, updated_at`);
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      if (filters.stalledOnly) query = query.in('status', ['initiated', 'processing']).lt('updated_at', new Date(Date.now() - STALLED_MS).toISOString());
      const rows = await ctx.q<Row[]>(query.order('created_at', { ascending: false }).limit(300));
      return await Promise.all(rows.map((r) => shared.refundWithEvents(r)));
    },

    async interveneRefund(id, { action, reference, note }) {
      await gate();
      await ctx.invoke('admin-refund-intervention', { refundId: id, action, reference: reference || undefined, note });
      return await refundById(id);
    },

    async listAuditLogs(filters = {}) {
      await gate();
      let query = sb.from('audit_logs').select('*');
      if (filters.resourceType && filters.resourceType !== 'all') query = query.eq('resource_type', filters.resourceType);
      if (filters.from) query = query.gte('created_at', startOf(filters.from));
      if (filters.to) query = query.lt('created_at', endOf(filters.to));
      const rows = await ctx.q<Row[]>(query.order('created_at', { ascending: false }).limit(1000));
      const names = await namesOf(rows.map((r) => r.actor_id));
      const q = filters.search?.trim().toLowerCase();
      return rows
        .map((r) => mapAuditLog(r, names))
        .filter(
          (a) => !q || a.action.toLowerCase().includes(q) || (a.actorName ?? '').toLowerCase().includes(q) || JSON.stringify(a.metadata).toLowerCase().includes(q),
        );
    },
  };

  return admin;
}
