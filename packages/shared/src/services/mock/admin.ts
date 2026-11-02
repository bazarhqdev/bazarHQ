/**
 * Super Admin mock services (SRS §12): secure login, platform oversight and
 * audited administrative actions. Super Admin has read-only access to
 * merchant business data and never sees payment credentials (FR-SA-10).
 */
import { ADMIN_LIMITS, LIMITS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, TICKET_STATUS_LABEL } from '../../constants';
import { canApprovePolicy } from '../../permissions';
import { canManuallyReviewPayment, canTransitionTicket } from '../../transitions';
import type {
  AdminCustomerRow,
  AdminMerchantDetail,
  AdminMerchantRow,
  Announcement,
  AnnouncementAudience,
  Dispute,
  HealthStatus,
  Order,
  SupportTicket,
  SupportTicketDetail,
  ThemeAdmin,
} from '../../types';
import { announcementSchema, policySchema, themeSchema, toFieldErrors } from '../../validation';
import { buildSeries, countByStatus, inRange, metric, previousRange, revenueOf } from '../analytics';
import { ServiceError, type AdminAuthService, type AdminService } from '../contracts';
import type { MockContext } from './context';
import { refundHelpers } from './returns';
import { DEMO_TOTP_CODE, type MockUser } from './seed';

export function createAdminServices(ctx: MockContext): { adminAuth: AdminAuthService; admin: AdminService } {
  const { read, write, nowIso, newId, requireAdmin, notify, audit, seen, orderDetail, sessionFor } = ctx;
  const { detail: returnDetail, addRefundEvent, notifyCustomer, settle } = refundHelpers(ctx);

  const storeOf = (id: string | null) => ctx.db.stores.find((s) => s.id === id) ?? null;
  const userById = (id: string) => ctx.db.users.find((u) => u.profile.id === id) ?? null;

  function merchantRow(u: MockUser): AdminMerchantRow {
    const store = ctx.db.stores.find((s) => s.ownerId === u.profile.id) ?? null;
    const orders = store ? ctx.db.orders.filter((o) => o.storeId === store.id) : [];
    return {
      merchant: u.profile,
      store,
      productCount: store ? ctx.db.products.filter((p) => p.storeId === store.id && !p.deletedAt).length : 0,
      orderCount: orders.length,
      revenue: revenueOf(orders),
    };
  }

  function merchantDetail(u: MockUser): AdminMerchantDetail {
    const row = merchantRow(u);
    return {
      ...row,
      recentOrders: row.store
        ? ctx.db.orders
            .filter((o) => o.storeId === row.store!.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 8)
        : [],
      openTickets: row.store ? ctx.db.tickets.filter((t) => t.storeId === row.store!.id && t.status !== 'closed' && t.status !== 'resolved').length : 0,
      activeSessions: (ctx.db.sessions[u.profile.id] ?? []).length,
    };
  }

  function merchantOrThrow(id: string): MockUser {
    const u = userById(id);
    if (!u || u.profile.role !== 'merchant' || u.profile.status === 'deleted') throw new ServiceError('NOT_FOUND', 'This merchant account no longer exists.');
    return u;
  }

  function customerRow(u: MockUser): AdminCustomerRow {
    const orders = ctx.db.orders.filter((o) => o.customerId === u.profile.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      customer: u.profile,
      orderCount: orders.length,
      totalSpent: revenueOf(orders),
      lastOrderAt: orders[0]?.createdAt ?? null,
      addresses: ctx.db.addresses.filter((a) => a.customerId === u.profile.id).length,
    };
  }

  function themeUsage(t: ThemeAdmin): ThemeAdmin {
    return { ...t, usedBy: ctx.db.stores.filter((s) => s.themeId === t.id).map((s) => ({ storeId: s.id, storeName: s.name })) };
  }

  function audience(a: AnnouncementAudience): MockUser[] {
    return ctx.db.users.filter(
      (u) => u.profile.status === 'active' && ((a !== 'customers' && u.profile.role === 'merchant') || (a !== 'merchants' && u.profile.role === 'customer')),
    );
  }

  function deliver(a: Announcement, actor: MockUser) {
    const recipients = audience(a.audience);
    for (const r of recipients)
      notify(r.profile.id, { type: 'announcement', title: a.title, body: a.body.slice(0, 240), referenceType: 'announcement', referenceId: a.id });
    a.status = 'sent';
    a.sentAt = nowIso();
    a.sentBy = actor.profile.id;
    a.sentByName = actor.profile.fullName;
    a.recipientCount = recipients.length;
    audit(actor, 'announcement.sent', 'announcement', a.id, { recipients: recipients.length, audience: a.audience });
  }

  /** Scheduled announcements are dispatched by a trusted job; the mock sweeps on read. */
  function sweepScheduled(actor: MockUser) {
    for (const a of ctx.db.announcements) if (a.status === 'scheduled' && a.scheduledAt && Date.parse(a.scheduledAt) <= ctx.now().getTime()) deliver(a, actor);
  }

  function ticketDetail(t: SupportTicket): SupportTicketDetail {
    return {
      ticket: t,
      messages: ctx.db.messages.filter((m) => m.ticketId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      audit: ctx.db.ticketAudit.filter((a) => a.ticketId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  function ticketOrThrow(id: string) {
    const t = ctx.db.tickets.find((x) => x.id === id || x.ticketNumber === id);
    if (!t) throw new ServiceError('NOT_FOUND', 'This ticket could not be found.');
    return t;
  }

  function addTicketAudit(
    t: SupportTicket,
    actor: string,
    eventType: SupportTicketDetail['audit'][number]['eventType'],
    prev: string | null,
    next: string | null,
  ) {
    ctx.db.ticketAudit.push({ id: newId('2224'), ticketId: t.id, actorName: actor, eventType, previousValue: prev, newValue: next, createdAt: nowIso() });
  }

  function adminReply(t: SupportTicket, actor: MockUser, body: string) {
    ctx.db.messages.push({
      id: newId('2223'),
      ticketId: t.id,
      senderId: actor.profile.id,
      senderName: 'BazarHQ Support',
      senderRole: 'super_admin',
      body,
      attachmentName: null,
      attachmentStoragePath: null,
      createdAt: nowIso(),
    });
    t.updatedAt = nowIso();
    addTicketAudit(t, actor.profile.fullName, 'reply', null, null);
    notify(t.customerId, {
      type: 'support_ticket',
      title: 'BazarHQ replied',
      body: `${t.ticketNumber}: ${body.slice(0, 120)}`,
      referenceType: 'support_ticket',
      referenceId: t.id,
    });
  }

  const adminAuth: AdminAuthService = {
    signIn: (email, password) =>
      write(() => {
        const u = ctx.db.users.find((x) => x.profile.email.toLowerCase() === email.trim().toLowerCase() && x.profile.role === 'super_admin');
        const generic = new ServiceError('UNAUTHENTICATED', 'Incorrect email or password.');
        if (!u) throw generic;
        if (u.lockedUntil && Date.parse(u.lockedUntil) > ctx.now().getTime()) {
          throw new ServiceError(
            'LOCKED',
            `This admin account is locked for ${LIMITS.lockoutMinutes} minutes after repeated failed attempts. An alert was emailed to the account.`,
          );
        }
        if (u.password !== password) {
          u.failedAttempts += 1;
          if (u.failedAttempts >= LIMITS.maxFailedLogins) {
            u.lockedUntil = new Date(ctx.now().getTime() + LIMITS.lockoutMinutes * 60_000).toISOString();
            u.failedAttempts = 0;
            audit(u, 'admin.locked', 'session', null, { reason: 'failed_attempts' });
            throw new ServiceError(
              'LOCKED',
              `This admin account is locked for ${LIMITS.lockoutMinutes} minutes after repeated failed attempts. An alert was emailed to the account.`,
            );
          }
          throw generic;
        }
        u.failedAttempts = 0;
        ctx.db.admin.pendingMfaUserId = u.profile.id;
        ctx.db.admin.mfaVerified = false;
        ctx.db.currentUserId = null;
        return { mfaRequired: true as const };
      }, 1.2),

    verifyTotp: (code) =>
      write(() => {
        const pending = ctx.db.admin.pendingMfaUserId;
        if (!pending) throw new ServiceError('UNAUTHENTICATED', 'Start again with your email and password.');
        const u = userById(pending)!;
        if (!/^\d{6}$/.test(code) || code !== DEMO_TOTP_CODE) {
          throw new ServiceError('VALIDATION', 'That code is not valid. Wait for the next code in your authenticator app and try again.', {
            code: 'Invalid code.',
          });
        }
        ctx.db.admin.pendingMfaUserId = null;
        ctx.db.admin.mfaVerified = true;
        ctx.db.admin.lastActivityAt = nowIso();
        ctx.db.currentUserId = u.profile.id;
        u.lastLoginAt = nowIso();
        u.lastLoginIp = ctx.db.admin.ip;
        audit(u, 'admin.login', 'session', null, { mfa: 'totp' });
        return sessionFor(u);
      }, 0.9),

    touch: () => read(() => sessionFor(requireAdmin()), 0.1),

    signOut: () =>
      write(() => {
        const u = ctx.currentUserOrNull();
        if (u?.profile.role === 'super_admin') audit(u, 'admin.logout', 'session', null);
        ctx.db.currentUserId = null;
        ctx.db.admin.mfaVerified = false;
        ctx.db.admin.pendingMfaUserId = null;
      }, 0.3),
  };

  const admin: AdminService = {
    dashboard: (range) =>
      read(() => {
        const actor = requireAdmin();
        sweepScheduled(actor);
        const prev = previousRange(range);
        const cur = ctx.db.orders.filter((o) => inRange(o.createdAt, range));
        const before = ctx.db.orders.filter((o) => inRange(o.createdAt, prev));
        const merchants = ctx.db.users.filter((u) => u.profile.role === 'merchant' && u.profile.status !== 'deleted');
        const merchantsBefore = merchants.filter((u) => u.profile.createdAt.slice(0, 10) < range.from).length;
        const customers = ctx.db.users.filter((u) => u.profile.role === 'customer' && u.profile.status === 'active');
        const customersBefore = customers.filter((u) => u.profile.createdAt.slice(0, 10) < range.from).length;
        const active = ctx.db.stores.filter((s) => s.status === 'published').length;
        const visitorsTotal: Record<string, number> = {};
        for (const v of Object.values(ctx.db.visitors)) for (const [d, n] of Object.entries(v)) visitorsTotal[d] = (visitorsTotal[d] ?? 0) + n;
        const byStore = new Map<string, { revenue: number; orders: number }>();
        for (const o of cur) {
          const e = byStore.get(o.storeId) ?? { revenue: 0, orders: 0 };
          e.orders += 1;
          if (o.status !== 'cancelled') e.revenue += o.totalAmount;
          byStore.set(o.storeId, e);
        }
        const valid = cur.filter((o) => o.status !== 'cancelled');
        const worst = ctx.db.health.reduce<HealthStatus>(
          (w, c) => (c.status === 'outage' || w === 'outage' ? 'outage' : c.status === 'degraded' || w === 'degraded' ? 'degraded' : 'operational'),
          'operational',
        );
        return {
          merchants: metric(merchants.length, merchantsBefore),
          activeStores: metric(active, active),
          orders: metric(cur.length, before.length),
          revenue: metric(revenueOf(cur), revenueOf(before)),
          customers: metric(customers.length, customersBefore),
          ordersByStatus: countByStatus(cur),
          series: buildSeries(ctx.db.orders, range, visitorsTotal),
          topMerchants: [...byStore.entries()]
            .map(([storeId, v]) => ({ storeId, storeName: storeOf(storeId)?.name ?? 'Unknown store', ...v }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5),
          paymentMethodBreakdown: PAYMENT_METHODS.map((m) => {
            const os = valid.filter((o) => o.paymentMethod === m);
            return { method: m, orders: os.length, revenue: os.reduce((s, o) => s + o.totalAmount, 0) };
          }),
          recentActivity: ctx.db.auditLogs.slice(0, 8),
          openDisputes:
            ctx.db.returns.filter((r) => r.dispute.status === 'open' || r.dispute.status === 'info_requested').length +
            ctx.db.tickets.filter((t) => t.dispute.status === 'open' || t.dispute.status === 'info_requested').length,
          stalledRefunds: ctx.db.refunds.filter((f) => f.status !== 'completed' && ctx.now().getTime() - Date.parse(f.createdAt) > 5 * 86_400_000).length,
          health: worst,
        };
      }, 1.3),

    health: () =>
      read(() => {
        requireAdmin();
        // Mock monitoring: refresh check times with small jitter; outages raise admin alerts in production.
        for (const c of ctx.db.health) {
          c.lastCheckedAt = nowIso();
          c.responseMs = Math.max(8, Math.round(c.responseMs * (0.9 + Math.random() * 0.2)));
        }
        const overall = ctx.db.health.some((c) => c.status === 'outage')
          ? 'outage'
          : ctx.db.health.some((c) => c.status === 'degraded')
            ? 'degraded'
            : 'operational';
        return {
          overall,
          components: ctx.db.health,
          recentLogs: [
            {
              id: 'l1',
              level: 'warn' as const,
              component: 'sms',
              message: 'SSL Wireless latency above 2 s; 6.5% of messages retried via secondary provider.',
              createdAt: new Date(ctx.now().getTime() - 12 * 60_000).toISOString(),
            },
            {
              id: 'l2',
              level: 'info' as const,
              component: 'edge_functions',
              message: 'Deployed payment-verify v1.4 (sandbox).',
              createdAt: new Date(ctx.now().getTime() - 3 * 3_600_000).toISOString(),
            },
            {
              id: 'l3',
              level: 'error' as const,
              component: 'email',
              message: '2 transactional emails bounced (invalid recipient); recorded as delivery failures.',
              createdAt: new Date(ctx.now().getTime() - 5 * 3_600_000).toISOString(),
            },
            {
              id: 'l4',
              level: 'info' as const,
              component: 'database',
              message: 'Nightly backup completed (PITR window 7 days).',
              createdAt: new Date(ctx.now().getTime() - 9 * 3_600_000).toISOString(),
            },
          ],
        };
      }, 0.7),

    listMerchants: (filters = {}) =>
      read(() => {
        requireAdmin();
        const q = filters.search?.trim().toLowerCase();
        return ctx.db.users
          .filter((u) => u.profile.role === 'merchant' && u.profile.status !== 'deleted')
          .map(merchantRow)
          .filter((r) => {
            if (!filters.status || filters.status === 'all') return true;
            if (filters.status === 'suspended') return r.merchant.status === 'suspended';
            if (filters.status === 'onboarding') return r.merchant.status === 'active' && (!r.store || r.store.status === 'draft');
            return r.merchant.status === 'active' && r.store?.status === 'published';
          })
          .filter(
            (r) =>
              !q ||
              r.merchant.fullName.toLowerCase().includes(q) ||
              r.merchant.email.toLowerCase().includes(q) ||
              (r.store?.name.toLowerCase().includes(q) ?? false) ||
              (r.store?.subdomain.includes(q) ?? false),
          )
          .sort((a, b) => b.revenue - a.revenue);
      }),

    getMerchant: (id) => read(() => (requireAdmin(), merchantDetail(merchantOrThrow(id)))),

    suspendMerchant: (id, reason) =>
      write(() => {
        const actor = requireAdmin();
        const u = merchantOrThrow(id);
        if (reason.trim().length < 10)
          throw new ServiceError('VALIDATION', 'A suspension reason of at least 10 characters is required.', {
            reason: 'A suspension reason of at least 10 characters is required.',
          });
        if (u.profile.status === 'suspended') throw new ServiceError('CONFLICT', 'This merchant is already suspended.');
        u.profile.status = 'suspended';
        u.profile.suspensionReason = reason.trim();
        ctx.db.sessions[u.profile.id] = []; // terminate sessions
        const store = ctx.db.stores.find((s) => s.ownerId === u.profile.id);
        if (store) store.status = 'suspended'; // unpublish; active orders stay trackable
        audit(actor, 'merchant.suspended', 'merchant', u.profile.id, { store: store?.name ?? null, reason: reason.trim() });
        notify(u.profile.id, {
          type: 'account',
          title: 'Account suspended',
          body: `Your merchant account was suspended: ${reason.trim()}`,
          referenceType: 'store',
          referenceId: store?.id ?? null,
        });
        return merchantDetail(u);
      }),

    reinstateMerchant: (id) =>
      write(() => {
        const actor = requireAdmin();
        const u = merchantOrThrow(id);
        if (u.profile.status !== 'suspended') throw new ServiceError('CONFLICT', 'Only suspended merchants can be reinstated.');
        u.profile.status = 'active';
        u.profile.suspensionReason = null;
        const store = ctx.db.stores.find((s) => s.ownerId === u.profile.id);
        if (store) store.status = 'draft'; // FR-SA-12: stays unpublished until the merchant republishes
        audit(actor, 'merchant.reinstated', 'merchant', u.profile.id, { store: store?.name ?? null });
        notify(u.profile.id, {
          type: 'account',
          title: 'Account reinstated',
          body: 'Your merchant account is active again. Republish your store from Store settings when ready.',
          referenceType: 'store',
          referenceId: store?.id ?? null,
        });
        return merchantDetail(u);
      }),

    deleteMerchant: (id, phrase) =>
      write(() => {
        const actor = requireAdmin();
        const u = merchantOrThrow(id);
        if (phrase !== `DELETE ${u.profile.email}`)
          throw new ServiceError('VALIDATION', `Type exactly: DELETE ${u.profile.email}`, { phrase: `Type exactly: DELETE ${u.profile.email}` });
        const store = ctx.db.stores.find((s) => s.ownerId === u.profile.id);
        if (store) store.status = 'suspended';
        u.profile.status = 'deleted';
        u.password = `deleted-${Math.random()}`;
        ctx.db.sessions[u.profile.id] = [];
        // Transaction history (orders, refunds, audit) is retained (§20.6).
        audit(actor, 'merchant.deleted', 'merchant', u.profile.id, { email: u.profile.email, store: store?.name ?? null });
      }, 1.2),

    listCustomers: (filters = {}) =>
      read(() => {
        requireAdmin();
        const q = filters.search?.trim().toLowerCase();
        return ctx.db.users
          .filter((u) => u.profile.role === 'customer' && u.profile.status !== 'deleted')
          .filter((u) => !q || u.profile.fullName.toLowerCase().includes(q) || u.profile.email.toLowerCase().includes(q) || (u.profile.phone ?? '').includes(q))
          .map(customerRow)
          .sort((a, b) => (b.lastOrderAt ?? '').localeCompare(a.lastOrderAt ?? ''));
      }),

    getCustomer: (id) =>
      read(() => {
        requireAdmin();
        const u = userById(id);
        if (!u || u.profile.role !== 'customer') throw new ServiceError('NOT_FOUND', 'This customer could not be found.');
        const orders = ctx.db.orders
          .filter((o) => o.customerId === u.profile.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((o) => ({ ...o, storeName: storeOf(o.storeId)?.name ?? 'Unknown store' }));
        return { ...customerRow(u), orders };
      }),

    listStores: (filters = {}) =>
      read(() => {
        requireAdmin();
        const q = filters.search?.trim().toLowerCase();
        return ctx.db.stores
          .filter((s) => !filters.status || filters.status === 'all' || s.status === filters.status)
          .filter((s) => !q || s.name.toLowerCase().includes(q) || s.subdomain.includes(q))
          .map((s) => {
            const owner = userById(s.ownerId)!;
            return {
              ...s,
              ownerName: owner.profile.fullName,
              ownerEmail: owner.profile.email,
              themeName: ctx.db.themes.find((t) => t.id === s.themeId)?.name ?? null,
              productCount: ctx.db.products.filter((p) => p.storeId === s.id && !p.deletedAt).length,
              orderCount: ctx.db.orders.filter((o) => o.storeId === s.id).length,
            };
          });
      }),

    listOrders: (filters = {}) =>
      read(() => {
        requireAdmin();
        const q = filters.search?.trim().toLowerCase();
        const items = ctx.db.orders
          .filter((o) => !filters.storeId || o.storeId === filters.storeId)
          .filter((o) => !filters.status || filters.status === 'all' || o.status === filters.status)
          .filter((o) => !filters.paymentStatus || filters.paymentStatus === 'all' || o.paymentStatus === filters.paymentStatus)
          .filter((o) => !filters.paymentMethod || filters.paymentMethod === 'all' || o.paymentMethod === filters.paymentMethod)
          .map((o) => ({ ...o, storeName: storeOf(o.storeId)?.name ?? 'Unknown store' }))
          .filter((o) => !q || o.orderNumber.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) || o.storeName.toLowerCase().includes(q))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { items, total: items.length };
      }),

    getOrder: (id) =>
      read(() => {
        requireAdmin();
        const o = ctx.db.orders.find((x) => x.id === id || x.orderNumber === id);
        if (!o) throw new ServiceError('NOT_FOUND', 'This order could not be found.');
        return { ...orderDetail(o), storeName: storeOf(o.storeId)?.name ?? 'Unknown store' };
      }),

    reviewPayment: (orderId, { decision, reason, idempotencyKey }) =>
      write(() => {
        const actor = requireAdmin();
        const o = ctx.db.orders.find((x) => x.id === orderId);
        if (!o) throw new ServiceError('NOT_FOUND', 'This order could not be found.');
        if (seen(`admin-payment-review:${o.id}`, idempotencyKey)) return { ...orderDetail(o), storeName: storeOf(o.storeId)!.name };
        if (!canManuallyReviewPayment(o)) throw new ServiceError('CONFLICT', 'Only payments awaiting verification can be reviewed manually.');
        if (reason.trim().length < 10)
          throw new ServiceError('VALIDATION', 'Explain what you checked (at least 10 characters).', { reason: 'Explain what you checked.' });
        const attempt = ctx.db.payments.filter((p) => p.orderId === o.id && p.status === 'pending_verification').at(-1);
        if (attempt) {
          attempt.status = decision;
          attempt.verifiedAt = nowIso();
        }
        o.paymentStatus = decision;
        o.updatedAt = nowIso();
        audit(actor, 'payment_transaction.manual_review', 'payment_transaction', attempt?.id ?? null, {
          order: o.orderNumber,
          decision,
          reason: reason.trim().slice(0, 200),
        });
        notify(storeOf(o.storeId)!.ownerId, {
          type: 'payment',
          title: `Payment ${decision === 'paid' ? 'verified' : 'rejected'} by BazarHQ`,
          body: `${PAYMENT_METHOD_LABEL[o.paymentMethod]} payment for ${o.orderNumber} was marked ${decision}.`,
          referenceType: 'order',
          referenceId: o.id,
        });
        return { ...orderDetail(o), storeName: storeOf(o.storeId)!.name };
      }),

    listThemes: () => read(() => (requireAdmin(), ctx.db.themes.map(themeUsage))),

    saveTheme: (input, id) =>
      write(() => {
        const actor = requireAdmin();
        const v = themeSchema.safeParse(input);
        if (!v.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(v.error));
        if (ctx.db.themes.some((t) => t.name.toLowerCase() === v.data.name.toLowerCase() && t.id !== id)) {
          throw new ServiceError('CONFLICT', 'A theme with that name already exists.', { name: 'A theme with that name already exists.' });
        }
        if (id) {
          const t = ctx.db.themes.find((x) => x.id === id);
          if (!t) throw new ServiceError('NOT_FOUND', 'This theme no longer exists.');
          const used = themeUsage(t).usedBy;
          if (!v.data.isActive && t.isActive && used.length) {
            // Deactivating hides it from new selections; existing stores keep it.
            audit(actor, 'theme.deactivated', 'theme', t.id, { inUseBy: used.length });
          }
          if (input.breaking && used.length) {
            // FR-SA-15: notify affected merchants at least 7 days before a breaking update.
            const effective = new Date(ctx.now().getTime() + ADMIN_LIMITS.breakingThemeNoticeDays * 86_400_000).toISOString();
            t.breakingChangeEffectiveAt = effective;
            for (const s of used) {
              const store = storeOf(s.storeId)!;
              notify(store.ownerId, {
                type: 'announcement',
                title: `Theme update: ${t.name}`,
                body: `A layout change to the ${t.name} theme takes effect on ${effective.slice(0, 10)}. Preview your store before then.`,
                referenceType: 'store',
                referenceId: store.id,
              });
            }
          }
          Object.assign(t, v.data);
          audit(actor, input.breaking ? 'theme.breaking_update_scheduled' : 'theme.updated', 'theme', t.id, {
            name: t.name,
            notified: input.breaking ? used.length : 0,
          });
          return themeUsage(t);
        }
        const t: ThemeAdmin = { id: newId('cccc'), ...v.data, previewUrl: null, usedBy: [], breakingChangeEffectiveAt: null, createdAt: nowIso() };
        ctx.db.themes.push(t);
        audit(actor, 'theme.created', 'theme', t.id, { name: t.name });
        return t;
      }),

    deleteTheme: (id) =>
      write(() => {
        const actor = requireAdmin();
        const t = ctx.db.themes.find((x) => x.id === id);
        if (!t) throw new ServiceError('NOT_FOUND', 'This theme no longer exists.');
        const used = themeUsage(t).usedBy;
        if (used.length) {
          throw new ServiceError(
            'CONFLICT',
            `This theme is used by ${used.length} store${used.length === 1 ? '' : 's'} (${used.map((s) => s.storeName).join(', ')}). Deactivate it instead, or wait until they switch.`,
          );
        }
        ctx.db.themes = ctx.db.themes.filter((x) => x.id !== id);
        audit(actor, 'theme.deleted', 'theme', id, { name: t.name });
      }),

    listAnnouncements: () =>
      read(() => {
        const actor = requireAdmin();
        sweepScheduled(actor);
        return [...ctx.db.announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }),

    recipientCount: (a) => read(() => (requireAdmin(), audience(a).length), 0.3),

    saveAnnouncement: (input, action, id) =>
      write(() => {
        const actor = requireAdmin();
        const v = announcementSchema.safeParse({ ...input, sendMode: action === 'schedule' ? 'schedule' : 'now', scheduledAt: input.scheduledAt ?? '' });
        if (!v.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(v.error));
        let a = id ? ctx.db.announcements.find((x) => x.id === id) : undefined;
        if (id && !a) throw new ServiceError('NOT_FOUND', 'This announcement no longer exists.');
        if (a?.status === 'sent') throw new ServiceError('CONFLICT', 'Sent announcements cannot be edited or recalled.');
        if (!a) {
          a = {
            id: newId('an01'),
            title: '',
            body: '',
            audience: 'merchants',
            status: 'draft',
            scheduledAt: null,
            sentAt: null,
            sentBy: null,
            sentByName: null,
            recipientCount: null,
            createdAt: nowIso(),
          };
          ctx.db.announcements.push(a);
        }
        a.title = v.data.title;
        a.body = v.data.body;
        a.audience = v.data.audience;
        if (action === 'send') deliver(a, actor);
        else if (action === 'schedule') {
          a.status = 'scheduled';
          a.scheduledAt = new Date(v.data.scheduledAt).toISOString();
          audit(actor, 'announcement.scheduled', 'announcement', a.id, { at: a.scheduledAt });
        } else {
          a.status = 'draft';
          a.scheduledAt = null;
          audit(actor, 'announcement.draft_saved', 'announcement', a.id);
        }
        return a;
      }),

    cancelAnnouncement: (id) =>
      write(() => {
        const actor = requireAdmin();
        const a = ctx.db.announcements.find((x) => x.id === id);
        if (!a) throw new ServiceError('NOT_FOUND', 'This announcement no longer exists.');
        if (a.status !== 'scheduled') throw new ServiceError('CONFLICT', 'Only scheduled announcements can be cancelled.');
        a.status = 'draft';
        a.scheduledAt = null;
        audit(actor, 'announcement.unscheduled', 'announcement', a.id);
        return a;
      }),

    deleteAnnouncement: (id) =>
      write(() => {
        const actor = requireAdmin();
        const a = ctx.db.announcements.find((x) => x.id === id);
        if (!a) throw new ServiceError('NOT_FOUND', 'This announcement no longer exists.');
        if (a.status === 'sent') throw new ServiceError('CONFLICT', 'Sent announcements cannot be deleted.');
        ctx.db.announcements = ctx.db.announcements.filter((x) => x.id !== id);
        audit(actor, 'announcement.deleted', 'announcement', id, { title: a.title });
      }),

    listPolicies: () => read(() => (requireAdmin(), [...ctx.db.policies].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))),

    submitPolicy: (input) =>
      write(() => {
        const actor = requireAdmin();
        const v = policySchema.safeParse(input);
        if (!v.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(v.error));
        if (ctx.db.policies.some((p) => p.type === v.data.type && p.version === v.data.version)) {
          throw new ServiceError('CONFLICT', `Version ${v.data.version} already exists. Use a new version number.`, {
            version: 'This version already exists.',
          });
        }
        const p = {
          id: newId('po01'),
          ...v.data,
          submittedBy: actor.profile.id,
          submittedByName: actor.profile.fullName,
          approvedBy: null,
          approvedByName: null,
          approvedAt: null,
          publishedAt: null,
          status: 'pending_approval' as const,
          createdAt: nowIso(),
        };
        ctx.db.policies.push(p);
        audit(actor, 'policy.submitted', 'policy', p.id, { type: p.type, version: p.version });
        for (const other of ctx.db.users.filter((x) => x.profile.role === 'super_admin' && x.profile.id !== actor.profile.id)) {
          notify(other.profile.id, {
            type: 'system',
            title: 'Policy awaiting your approval',
            body: `${actor.profile.fullName} submitted ${p.type === 'tos' ? 'Terms of Service' : 'Privacy Policy'} v${p.version}.`,
            referenceType: 'policy',
            referenceId: p.id,
          });
        }
        return p;
      }),

    approvePolicy: (id) =>
      write(() => {
        const actor = requireAdmin();
        const p = ctx.db.policies.find((x) => x.id === id);
        if (!p) throw new ServiceError('NOT_FOUND', 'This policy version no longer exists.');
        if (p.status !== 'pending_approval') throw new ServiceError('CONFLICT', 'Only versions awaiting approval can be approved.');
        // FR-SA-18 / DB-12: dual approval — the submitter can never approve.
        if (!canApprovePolicy(actor.profile.id, p.submittedBy)) {
          throw new ServiceError('FORBIDDEN', 'You submitted this version, so a different Super Admin must approve it.');
        }
        p.status = 'approved';
        p.approvedBy = actor.profile.id;
        p.approvedByName = actor.profile.fullName;
        p.approvedAt = nowIso();
        audit(actor, 'policy.approved', 'policy', p.id, { type: p.type, version: p.version, submitted_by: p.submittedByName });
        return p;
      }),

    publishPolicy: (id) =>
      write(() => {
        const actor = requireAdmin();
        const p = ctx.db.policies.find((x) => x.id === id);
        if (!p) throw new ServiceError('NOT_FOUND', 'This policy version no longer exists.');
        if (p.status !== 'approved' || !p.approvedBy || p.approvedBy === p.submittedBy) {
          throw new ServiceError('CONFLICT', 'A policy can be published only after a second Super Admin approves it.');
        }
        for (const old of ctx.db.policies) if (old.type === p.type && old.status === 'published') old.status = 'archived';
        p.status = 'published';
        p.publishedAt = nowIso();
        audit(actor, 'policy.published', 'policy', p.id, { type: p.type, version: p.version, effective: p.effectiveDate });
        return p;
      }),

    listTickets: (filters = {}) =>
      read(() => {
        requireAdmin();
        const q = filters.search?.trim().toLowerCase();
        return ctx.db.tickets
          .filter((t) => !filters.queue || filters.queue === 'all' || t.queue === filters.queue)
          .filter((t) => !filters.status || filters.status === 'all' || t.status === filters.status)
          .filter((t) => !filters.escalatedOnly || Boolean(t.escalationAt))
          .filter(
            (t) =>
              !q ||
              t.subject.toLowerCase().includes(q) ||
              t.ticketNumber.toLowerCase().includes(q) ||
              t.customerName.toLowerCase().includes(q) ||
              (t.storeName ?? '').toLowerCase().includes(q),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }),

    getTicket: (id) => read(() => (requireAdmin(), ticketDetail(ticketOrThrow(id)))),

    replyTicket: (id, { body }) =>
      write(() => {
        const actor = requireAdmin();
        const t = ticketOrThrow(id);
        if (t.status === 'closed') throw new ServiceError('CONFLICT', 'Closed tickets are read-only.');
        if (!body.trim()) throw new ServiceError('VALIDATION', 'Write a reply.', { body: 'Write a reply.' });
        adminReply(t, actor, body.trim());
        return ticketDetail(t);
      }),

    updateTicketStatus: (id, to, input = {}) =>
      write(() => {
        const actor = requireAdmin();
        const t = ticketOrThrow(id);
        if (!canTransitionTicket(t.status, to))
          throw new ServiceError('CONFLICT', `A ${TICKET_STATUS_LABEL[t.status].toLowerCase()} ticket can't move to ${TICKET_STATUS_LABEL[to].toLowerCase()}.`);
        if (to === 'resolved') {
          if ((input.resolutionNote?.trim().length ?? 0) < 5)
            throw new ServiceError('VALIDATION', 'A resolution note is required.', { resolutionNote: 'A resolution note is required.' });
          t.resolutionNote = input.resolutionNote!.trim();
        }
        addTicketAudit(t, actor.profile.fullName, to === 'closed' ? 'closed' : 'status_changed', t.status, to);
        t.status = to;
        t.updatedAt = nowIso();
        if (to === 'closed') t.closedAt = nowIso();
        notify(t.customerId, {
          type: 'support_ticket',
          title: 'Ticket updated',
          body: `${t.ticketNumber} is now ${TICKET_STATUS_LABEL[to].toLowerCase()}.`,
          referenceType: 'support_ticket',
          referenceId: t.id,
        });
        return ticketDetail(t);
      }),

    listDisputes: (filters = {}) =>
      read(() => {
        requireAdmin();
        const openOnly = (filters.status ?? 'open') === 'open';
        const keep = (s: string) => (openOnly ? s === 'open' || s === 'info_requested' : s !== 'none');
        const ds: Dispute[] = [
          ...ctx.db.returns
            .filter((r) => keep(r.dispute.status))
            .map((r) => ({
              kind: 'return' as const,
              id: r.id,
              reference: r.returnNumber,
              title: `Rejected return · ${r.orderNumber}`,
              storeName: r.storeName,
              customerName: r.customerName,
              status: r.dispute.status,
              escalatedAt: r.dispute.escalatedAt ?? r.createdAt,
            })),
          ...ctx.db.tickets
            .filter((t) => keep(t.dispute.status))
            .map((t) => ({
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
        return ds.sort((a, b) => b.escalatedAt.localeCompare(a.escalatedAt));
      }),

    getReturnDispute: (id) =>
      read(() => {
        requireAdmin();
        const r = ctx.db.returns.find((x) => x.id === id || x.returnNumber === id);
        if (!r) throw new ServiceError('NOT_FOUND', 'This return could not be found.');
        return returnDetail(r);
      }),

    resolveDispute: (kind, id, { action, note }) =>
      write(() => {
        const actor = requireAdmin();
        if (note.trim().length < 10)
          throw new ServiceError('VALIDATION', 'A note of at least 10 characters is required. It is audited.', {
            note: 'A note of at least 10 characters is required.',
          });
        if (kind === 'return') {
          const r = ctx.db.returns.find((x) => x.id === id);
          if (!r) throw new ServiceError('NOT_FOUND', 'This return could not be found.');
          if (r.dispute.status === 'resolved') throw new ServiceError('CONFLICT', 'This dispute is already resolved.');
          if (action === 'request_info') {
            r.dispute.status = 'info_requested';
            r.dispute.adminNote = note.trim();
            notifyCustomer(r, 'BazarHQ needs more information', `${r.returnNumber}: ${note.trim()}`);
          } else if (action === 'override') {
            // Override the merchant's rejection: the return becomes approved and continues the normal flow.
            if (r.status !== 'rejected') throw new ServiceError('CONFLICT', 'Only a rejected return can be overridden.');
            r.status = 'approved';
            r.decidedAt = nowIso();
            r.merchantResponse = `Approved by BazarHQ after review: ${note.trim()}`;
            r.dispute = { ...r.dispute, status: 'resolved', decision: 'overridden', adminNote: note.trim() };
            notifyCustomer(r, 'Dispute resolved in your favour', `${r.returnNumber} is now approved. ${r.storeName} will arrange the return.`);
            const owner = ctx.ownerOf(r.storeId);
            if (owner)
              notify(owner.profile.id, {
                type: 'dispute',
                title: 'Return decision overridden',
                body: `BazarHQ approved ${r.returnNumber}: ${note.trim()}`,
                referenceType: 'return',
                referenceId: r.id,
              });
          } else {
            r.dispute = { ...r.dispute, status: 'resolved', decision: 'upheld', adminNote: note.trim() };
            if (r.status === 'rejected') {
              r.status = 'closed';
              r.closedAt = nowIso();
            }
            notifyCustomer(r, 'Dispute closed', `${r.returnNumber}: ${note.trim()}`);
          }
          audit(actor, `dispute.${action}`, 'return', r.id, { reference: r.returnNumber, note: note.trim().slice(0, 200) });
          return;
        }
        const t = ticketOrThrow(id);
        if (t.dispute.status === 'resolved') throw new ServiceError('CONFLICT', 'This dispute is already resolved.');
        if (action === 'request_info') {
          t.dispute.status = 'info_requested';
          t.dispute.adminNote = note.trim();
          adminReply(t, actor, note.trim());
          if (t.status !== 'waiting_for_customer' && canTransitionTicket(t.status === 'open' ? 'in_progress' : t.status, 'waiting_for_customer')) {
            addTicketAudit(t, actor.profile.fullName, 'status_changed', t.status, 'waiting_for_customer');
            t.status = 'waiting_for_customer';
          }
        } else {
          t.dispute = { status: 'resolved', decision: action === 'override' ? 'overridden' : 'upheld', adminNote: note.trim() };
          adminReply(t, actor, note.trim());
          addTicketAudit(t, actor.profile.fullName, 'dispute_action', t.status, 'resolved');
          t.status = 'resolved';
          t.resolutionNote = note.trim();
        }
        audit(actor, `dispute.${action}`, 'support_ticket', t.id, { reference: t.ticketNumber, note: note.trim().slice(0, 200) });
      }),

    listRefunds: (filters = {}) =>
      read(() => {
        requireAdmin();
        const t = ctx.now().getTime();
        return ctx.db.refunds
          .filter((f) => !filters.status || filters.status === 'all' || f.status === filters.status)
          .filter((f) => !filters.stalledOnly || (f.status !== 'completed' && t - Date.parse(f.createdAt) > 5 * 86_400_000))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }),

    interveneRefund: (id, { action, reference, note }) =>
      write(() => {
        const actor = requireAdmin();
        const f = ctx.db.refunds.find((x) => x.id === id);
        if (!f) throw new ServiceError('NOT_FOUND', 'This refund could not be found.');
        if (note.trim().length < 10)
          throw new ServiceError('VALIDATION', 'A note of at least 10 characters is required. It is audited.', {
            note: 'A note of at least 10 characters is required.',
          });
        if (action === 'settle') settle(f, actor, reference ?? '', `BazarHQ intervention: ${note.trim()}`);
        else addRefundEvent(f, action === 'mark_failed' ? 'failed' : 'processing', actor, `BazarHQ intervention: ${note.trim()}`);
        audit(actor, `refund.intervention.${action}`, 'refund', f.id, { order: f.orderNumber, note: note.trim().slice(0, 200) });
        const owner = ctx.ownerOf(f.storeId);
        if (owner)
          notify(owner.profile.id, {
            type: 'refund',
            title: 'BazarHQ updated a refund',
            body: `${f.orderNumber}: ${note.trim().slice(0, 120)}`,
            referenceType: 'refund',
            referenceId: f.id,
          });
        return f;
      }),

    listAuditLogs: (filters = {}) =>
      read(() => {
        requireAdmin();
        const q = filters.search?.trim().toLowerCase();
        return ctx.db.auditLogs
          .filter((a) => !filters.resourceType || filters.resourceType === 'all' || a.resourceType === filters.resourceType)
          .filter((a) => !filters.from || a.createdAt.slice(0, 10) >= filters.from)
          .filter((a) => !filters.to || a.createdAt.slice(0, 10) <= filters.to)
          .filter(
            (a) =>
              !q || a.action.toLowerCase().includes(q) || (a.actorName ?? '').toLowerCase().includes(q) || JSON.stringify(a.metadata).toLowerCase().includes(q),
          );
      }),
  };

  void ({} as Order);
  return { adminAuth, admin };
}
