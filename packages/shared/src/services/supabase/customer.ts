/**
 * Signed-in customer account on Supabase (FR-C-30..36, §14 returns, §15 support).
 *
 * Reads: RLS-scoped to the caller (orders_select_customer, returns/tickets
 * participant policies, customer_addresses owner policies).
 * Writes: addresses directly under RLS (the database enforces the 3-address
 * limit and one default); returns, tickets and escalations through Edge
 * Functions or caller-scoped RPCs that re-check ownership and state.
 */
import { ADMIN_LIMITS } from '../../constants';
import { returnEligibility } from '../../transitions';
import type { Address, CustomerOrderDetail, ReturnRequest, SupportTicket } from '../../types';
import { addressSchema, returnRequestSchema, ticketCreateSchema, toFieldErrors } from '../../validation';
import { validateAttachmentFile, validateImageFile } from '../../validation/files';
import { ServiceError, type CustomerAccountService } from '../contracts';
import type { AuthModule } from './auth';
import { objectName, toServiceError, type AdapterContext } from './core';
import { mapAddress, mapOrder, mapReturn, mapTicket, ORDER_COLUMNS, RETURN_COLUMNS, TICKET_COLUMNS } from './mappers';
import type { MerchantModule } from './merchant';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST JSON is narrowed field by field */
type Row = Record<string, any>;

export function createCustomer(ctx: AdapterContext, auth: AuthModule, shared: Pick<MerchantModule, 'orderDetail' | 'returnDetail' | 'ticketDetail' | 'replyWithAttachment'>) {
  const { sb } = ctx;

  async function me() {
    const s = await auth.requireSession();
    if (s.user.role !== 'customer') throw new ServiceError('FORBIDDEN', 'This area is only available to customer accounts.');
    if (s.user.status === 'suspended') throw new ServiceError('SUSPENDED', 'This account is suspended.');
    return s;
  }

  async function myAddresses(): Promise<Address[]> {
    const s = await me();
    const rows = await ctx.q<Row[]>(sb.from('customer_addresses').select('*').eq('customer_id', s.user.id).order('created_at'));
    return rows.map(mapAddress).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt));
  }

  /** At most one default (partial unique index): clear first, then set. */
  async function makeDefault(customerId: string, id: string) {
    await ctx.q(sb.from('customer_addresses').update({ is_default: false }).eq('customer_id', customerId).eq('is_default', true).neq('id', id));
    await ctx.q(sb.from('customer_addresses').update({ is_default: true }).eq('id', id));
  }

  async function myReturnRow(id: string): Promise<Row> {
    const s = await me();
    const row = await ctx.q<Row | null>(sb.from('returns').select(RETURN_COLUMNS).eq('id', id).eq('customer_id', s.user.id).maybeSingle());
    if (!row) throw new ServiceError('NOT_FOUND', 'This return could not be found.');
    return row;
  }

  async function myTickets(): Promise<SupportTicket[]> {
    const s = await me();
    const rows = await ctx.q<Row[]>(sb.from('support_tickets').select(TICKET_COLUMNS).eq('customer_id', s.user.id).order('updated_at', { ascending: false }).limit(200));
    return rows.map((r) => mapTicket(r, s.user.fullName));
  }

  const account: CustomerAccountService = {
    async listOrders() {
      const s = await me();
      const rows = await ctx.q<Row[]>(
        sb
          .from('orders')
          .select(`${ORDER_COLUMNS}, store:stores(name, subdomain)`)
          .eq('customer_id', s.user.id)
          .order('created_at', { ascending: false })
          .limit(500),
      );
      return rows.map((r) => ({ ...mapOrder(r), storeName: r.store?.name ?? 'Store', storeSubdomain: r.store?.subdomain ?? '' }));
    },

    async getOrder(id) {
      const s = await me();
      const row = await ctx.q<Row | null>(
        sb.from('orders').select('id, store_id, status, delivered_at, store:stores(name, subdomain, return_window_days)').eq('id', id).eq('customer_id', s.user.id).maybeSingle(),
      );
      if (!row) throw new ServiceError('NOT_FOUND', 'This order could not be found.');
      const detail = await shared.orderDetail(id, 'any');
      const deliveredAt = row.delivered_at ?? detail.events.filter((e) => e.eventType === 'delivered').at(-1)?.createdAt ?? null;
      const windowDays = Number(row.store?.return_window_days ?? 7);
      return {
        ...detail,
        storeName: row.store?.name ?? 'Store',
        storeSubdomain: row.store?.subdomain ?? '',
        returnEligibility: returnEligibility(detail.order, deliveredAt, windowDays, Boolean(detail.returnRequest)),
      } satisfies CustomerOrderDetail;
    },

    listAddresses: () => myAddresses(),

    async saveAddress(input, id) {
      const s = await me();
      const v = addressSchema.safeParse({ ...input, postalCode: input.postalCode ?? '' });
      if (!v.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(v.error));
      const mine = await myAddresses();
      if (!id && mine.length >= ADMIN_LIMITS.maxSavedAddresses) {
        throw new ServiceError('CONFLICT', `You can save up to ${ADMIN_LIMITS.maxSavedAddresses} addresses. Delete one to add another.`);
      }
      const row = {
        label: v.data.label,
        recipient_name: v.data.recipientName,
        phone: v.data.phone,
        address: v.data.address,
        district: v.data.district,
        postal_code: v.data.postalCode || null,
      };
      let savedId = id;
      if (id) {
        const updated = await ctx.q<Row[]>(sb.from('customer_addresses').update(row).eq('id', id).eq('customer_id', s.user.id).select('id'));
        if (!updated.length) throw new ServiceError('NOT_FOUND', 'This address no longer exists.');
      } else {
        try {
          const created = await ctx.q<Row>(sb.from('customer_addresses').insert({ ...row, customer_id: s.user.id, is_default: false }).select('id').single());
          savedId = created.id;
        } catch (e) {
          const err = toServiceError(e);
          if (err.code === 'CONFLICT' || err.code === 'VALIDATION') {
            throw new ServiceError('CONFLICT', `You can save up to ${ADMIN_LIMITS.maxSavedAddresses} addresses. Delete one to add another.`);
          }
          throw err;
        }
      }
      if (savedId && (v.data.isDefault || mine.length === 0 || !mine.some((a) => a.isDefault && a.id !== savedId))) await makeDefault(s.user.id, savedId);
      return await myAddresses();
    },

    async deleteAddress(id) {
      const s = await me();
      const removed = await ctx.q<Row[]>(sb.from('customer_addresses').delete().eq('id', id).eq('customer_id', s.user.id).select('id, is_default'));
      if (!removed.length) throw new ServiceError('NOT_FOUND', 'This address no longer exists.');
      const rest = await myAddresses();
      if (removed[0]!.is_default && rest[0]) await makeDefault(s.user.id, rest[0].id);
      return await myAddresses();
    },

    async setDefaultAddress(id) {
      const s = await me();
      if (!(await myAddresses()).some((a) => a.id === id)) throw new ServiceError('NOT_FOUND', 'This address no longer exists.');
      await makeDefault(s.user.id, id);
      return await myAddresses();
    },

    async listReturns() {
      const s = await me();
      const rows = await ctx.q<Row[]>(sb.from('returns').select(RETURN_COLUMNS).eq('customer_id', s.user.id).order('created_at', { ascending: false }).limit(200));
      return rows.map((r) => mapReturn(r));
    },

    async getReturn(id) {
      await myReturnRow(id);
      const d = await shared.returnDetail(id);
      return { returnRequest: d.returnRequest, refund: d.refund };
    },

    async createReturn(orderId, input) {
      await me();
      const v = returnRequestSchema.safeParse(input);
      if (!v.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(v.error));
      if (input.evidence) {
        const err = validateImageFile(input.evidence);
        if (err) throw new ServiceError('VALIDATION', err, { evidence: err });
      }
      const r = await ctx.invoke<{ return: Row }>('request-return', {
        action: 'create',
        orderId,
        reason: v.data.reason,
        conditionDescription: v.data.conditionDescription,
        idempotencyKey: input.idempotencyKey,
      });
      const returnId = r.return.id as string;
      if (input.evidence) {
        // Storage RLS only lets the return's customer write to returns/{return_id}/.
        const path = `returns/${returnId}/${objectName(input.evidence)}`;
        await ctx.upload('return-evidence', path, input.evidence);
        await ctx.invoke('request-return', { action: 'attach_evidence', returnId, storagePath: path });
      }
      ctx.emit();
      const row = await myReturnRow(returnId);
      return mapReturn(row, await ctx.signedUrl('return-evidence', row.evidence_storage_path)) satisfies ReturnRequest;
    },

    async escalateReturn(id, note) {
      await myReturnRow(id);
      await ctx.invoke('request-return', { action: 'escalate', returnId: id, note });
      return mapReturn(await myReturnRow(id));
    },

    listTickets: () => myTickets(),

    async getTicket(id) {
      const s = await me();
      const d = await shared.ticketDetail(id);
      if (d.ticket.customerId !== s.user.id) throw new ServiceError('NOT_FOUND', 'This ticket could not be found.');
      return { ...d, ticket: { ...d.ticket, customerName: s.user.fullName } };
    },

    async createTicket(input) {
      await me();
      const v = ticketCreateSchema.safeParse({ ...input, orderId: input.orderId ?? '' });
      if (!v.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(v.error));
      if (input.attachment) {
        const err = validateAttachmentFile(input.attachment);
        if (err) throw new ServiceError('VALIDATION', err, { attachment: err });
      }
      if (['order', 'payment', 'delivery', 'return_refund'].includes(v.data.category) && !input.orderId) {
        throw new ServiceError('VALIDATION', 'Choose the order this is about.', { orderId: 'Choose the order this is about.' });
      }
      const t = await ctx.invoke<Row>('create-support-ticket', {
        category: v.data.category,
        subject: v.data.subject,
        description: v.data.description,
        priority: v.data.priority,
        orderId: input.orderId || null,
      });
      if (input.attachment) await shared.replyWithAttachment(t.id, `Attachment: ${input.attachment.name}`.slice(0, 200), input.attachment);
      ctx.emit();
      return await account.getTicket(t.id);
    },

    async replyTicket(id, { body, attachment }) {
      await account.getTicket(id);
      await shared.replyWithAttachment(id, body, attachment);
      return await account.getTicket(id);
    },

    async setTicketPriority(id, priority) {
      await ctx.rpc('set_ticket_priority', { p_ticket_id: id, p_priority: priority });
      return await account.getTicket(id);
    },

    async reopenTicket(id) {
      await ctx.rpc('reopen_ticket', { p_ticket_id: id });
      return await account.getTicket(id);
    },

    async escalateTicket(id) {
      await ctx.invoke('escalate-support-ticket', { ticketId: id });
      return await account.getTicket(id);
    },

    async deleteAccount(confirmation) {
      await me();
      await auth.auth.deleteAccount(confirmation);
    },
  };

  return account;
}
