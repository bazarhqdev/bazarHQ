/** Registered customer account: orders, addresses, returns, tickets (FR-C-30..36, §14, §15). */
import { ADMIN_LIMITS } from '../../constants';
import { formatPublicId } from '../../formatters';
import {
  canCustomerChangePriority,
  canCustomerEscalateTicket,
  canCustomerReopenTicket,
  canEscalateReturn,
  canReplyToTicket,
  returnEligibility,
} from '../../transitions';
import type { Address, ReturnRequest, SupportTicket, SupportTicketDetail } from '../../types';
import { addressSchema, returnRequestSchema, ticketCreateSchema, toFieldErrors } from '../../validation';
import { validateAttachmentFile, validateImageFile } from '../../validation/files';
import { ServiceError, type CustomerAccountService } from '../contracts';
import type { MockContext } from './context';

export function createAccountServices(ctx: MockContext): CustomerAccountService {
  const { read, write, nowIso, newId, requireCustomer, notify, notifyAdmins, seen, audit, orderDetail, deliveredAt, ownerOf } = ctx;

  function myOrder(id: string) {
    const u = requireCustomer();
    const o = ctx.db.orders.find((x) => x.id === id || x.orderNumber === id);
    if (!o) throw new ServiceError('NOT_FOUND', 'This order could not be found.');
    if (o.customerId !== u.profile.id) throw new ServiceError('FORBIDDEN', 'This order belongs to another account.');
    return o;
  }

  function myAddresses(customerId: string): Address[] {
    return ctx.db.addresses
      .filter((a) => a.customerId === customerId)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt));
  }

  function myTicket(id: string): SupportTicket {
    const u = requireCustomer();
    const t = ctx.db.tickets.find((x) => x.id === id || x.ticketNumber === id);
    if (!t) throw new ServiceError('NOT_FOUND', 'This ticket could not be found.');
    if (t.customerId !== u.profile.id) throw new ServiceError('FORBIDDEN', 'This ticket belongs to another account.');
    return t;
  }

  function ticketDetail(t: SupportTicket): SupportTicketDetail {
    return {
      ticket: t,
      messages: ctx.db.messages.filter((m) => m.ticketId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      audit: ctx.db.ticketAudit.filter((a) => a.ticketId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  function myReturn(id: string): ReturnRequest {
    const u = requireCustomer();
    const r = ctx.db.returns.find((x) => x.id === id || x.returnNumber === id);
    if (!r) throw new ServiceError('NOT_FOUND', 'This return could not be found.');
    if (r.customerId !== u.profile.id) throw new ServiceError('FORBIDDEN', 'This return belongs to another account.');
    return r;
  }

  function ticketAudit(
    t: SupportTicket,
    actor: string,
    eventType: SupportTicketDetail['audit'][number]['eventType'],
    prev: string | null,
    next: string | null,
  ) {
    ctx.db.ticketAudit.push({ id: newId('2224'), ticketId: t.id, actorName: actor, eventType, previousValue: prev, newValue: next, createdAt: nowIso() });
  }

  function notifyAssignee(t: SupportTicket, title: string, body: string) {
    if (t.queue === 'store' && t.storeId && !t.escalationAt) {
      const store = ctx.db.stores.find((s) => s.id === t.storeId)!;
      notify(store.ownerId, { type: 'support_ticket', title, body, referenceType: 'support_ticket', referenceId: t.id });
    } else {
      notifyAdmins({ type: 'support_ticket', title, body, referenceType: 'support_ticket', referenceId: t.id });
    }
  }

  return {
    listOrders: () =>
      read(() => {
        const u = requireCustomer();
        return ctx.db.orders
          .filter((o) => o.customerId === u.profile.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((o) => {
            const s = ctx.db.stores.find((x) => x.id === o.storeId)!;
            return { ...o, storeName: s.name, storeSubdomain: s.subdomain };
          });
      }),

    getOrder: (id) =>
      read(() => {
        const o = myOrder(id);
        const s = ctx.db.stores.find((x) => x.id === o.storeId)!;
        const existing = ctx.db.returns.some((r) => r.orderId === o.id);
        return {
          ...orderDetail(o),
          storeName: s.name,
          storeSubdomain: s.subdomain,
          returnEligibility: returnEligibility(o, deliveredAt(o.id), s.returnWindowDays, existing, ctx.now()),
        };
      }),

    listAddresses: () => read(() => myAddresses(requireCustomer().profile.id), 0.4),

    saveAddress: (input, id) =>
      write(() => {
        const u = requireCustomer();
        const v = addressSchema.safeParse({ ...input, postalCode: input.postalCode ?? '' });
        if (!v.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(v.error));
        const mine = myAddresses(u.profile.id);
        if (!id && mine.length >= ADMIN_LIMITS.maxSavedAddresses) {
          throw new ServiceError('CONFLICT', `You can save up to ${ADMIN_LIMITS.maxSavedAddresses} addresses. Delete one to add another.`);
        }
        const data = { ...v.data, postalCode: v.data.postalCode || null };
        if (data.isDefault || mine.length === 0) for (const a of mine) a.isDefault = false;
        if (id) {
          const a = ctx.db.addresses.find((x) => x.id === id && x.customerId === u.profile.id);
          if (!a) throw new ServiceError('NOT_FOUND', 'This address no longer exists.');
          Object.assign(a, data, { updatedAt: nowIso() });
        } else {
          ctx.db.addresses.push({
            id: newId('ad01'),
            customerId: u.profile.id,
            ...data,
            isDefault: data.isDefault || mine.length === 0,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          });
        }
        const after = myAddresses(u.profile.id);
        if (!after.some((a) => a.isDefault) && after[0]) after[0].isDefault = true;
        return myAddresses(u.profile.id);
      }, 0.7),

    deleteAddress: (id) =>
      write(() => {
        const u = requireCustomer();
        const a = ctx.db.addresses.find((x) => x.id === id && x.customerId === u.profile.id);
        if (!a) throw new ServiceError('NOT_FOUND', 'This address no longer exists.');
        ctx.db.addresses = ctx.db.addresses.filter((x) => x.id !== id);
        const rest = myAddresses(u.profile.id);
        if (a.isDefault && rest[0]) rest[0].isDefault = true;
        return myAddresses(u.profile.id);
      }, 0.5),

    setDefaultAddress: (id) =>
      write(() => {
        const u = requireCustomer();
        const mine = myAddresses(u.profile.id);
        if (!mine.some((a) => a.id === id)) throw new ServiceError('NOT_FOUND', 'This address no longer exists.');
        for (const a of mine) a.isDefault = a.id === id;
        return myAddresses(u.profile.id);
      }, 0.5),

    listReturns: () =>
      read(() => {
        const u = requireCustomer();
        return ctx.db.returns.filter((r) => r.customerId === u.profile.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }),

    getReturn: (id) =>
      read(() => {
        const r = myReturn(id);
        return { returnRequest: r, refund: ctx.db.refunds.find((f) => f.returnId === r.id) ?? null };
      }),

    createReturn: (orderId, input) =>
      write(() => {
        const u = requireCustomer();
        const o = myOrder(orderId);
        const s = ctx.db.stores.find((x) => x.id === o.storeId)!;
        if (seen(`return-create:${o.id}`, input.idempotencyKey)) {
          const existing = ctx.db.returns.find((r) => r.orderId === o.id);
          if (existing) return existing;
        }
        const v = returnRequestSchema.safeParse(input);
        if (!v.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(v.error));
        // FR-RET-03: eligibility re-checked server-side.
        const eligibility = returnEligibility(
          o,
          deliveredAt(o.id),
          s.returnWindowDays,
          ctx.db.returns.some((r) => r.orderId === o.id),
          ctx.now(),
        );
        if (!eligibility.eligible) throw new ServiceError('CONFLICT', eligibility.reason ?? 'This order is not eligible for a return.');
        if (input.evidence) {
          const err = validateImageFile(input.evidence);
          if (err) throw new ServiceError('VALIDATION', err, { evidence: err });
        }
        const rid = newId('4444');
        const r: ReturnRequest = {
          id: rid,
          returnNumber: formatPublicId('RET', ctx.now(), ++ctx.db.seq.ret),
          orderId: o.id,
          orderNumber: o.orderNumber,
          storeId: s.id,
          storeName: s.name,
          customerId: u.profile.id,
          customerName: u.profile.fullName,
          reason: v.data.reason,
          conditionDescription: v.data.conditionDescription,
          evidenceStoragePath: input.evidence ? `returns/${rid}/${input.evidence.name}` : null,
          evidenceUrl: input.evidence?.previewUrl ?? null,
          status: 'requested',
          merchantResponse: null,
          returnMethod: null,
          refundAmountRequested: o.subtotal,
          createdAt: nowIso(),
          decidedAt: null,
          receivedAt: null,
          closedAt: null,
          dispute: { status: 'none', escalatedAt: null, decision: null, adminNote: null },
        };
        ctx.db.returns.push(r);
        // FR-RET-04: merchant notified immediately.
        notify(s.ownerId, {
          type: 'return',
          title: 'Return requested',
          body: `${r.returnNumber} for ${o.orderNumber} — ${v.data.reason.replace(/_/g, ' ')}`,
          referenceType: 'return',
          referenceId: r.id,
        });
        notify(u.profile.id, {
          type: 'return',
          title: 'Return requested',
          body: `${r.returnNumber} was sent to ${s.name}. You'll be notified when they respond.`,
          referenceType: 'return',
          referenceId: r.id,
        });
        return r;
      }, 1.1),

    escalateReturn: (id, note) =>
      write(() => {
        const u = requireCustomer();
        const r = myReturn(id);
        if (!canEscalateReturn(r)) throw new ServiceError('CONFLICT', 'Only a rejected return can be escalated, and only once.');
        if (note.trim().length < 10)
          throw new ServiceError('VALIDATION', 'Tell us why you disagree (at least 10 characters).', {
            note: 'Tell us why you disagree (at least 10 characters).',
          });
        r.dispute = { status: 'open', escalatedAt: nowIso(), decision: null, adminNote: null };
        audit(u, 'return.escalated', 'return', r.id, { note: note.trim().slice(0, 200) });
        notifyAdmins({
          type: 'dispute',
          title: 'Return dispute escalated',
          body: `${r.returnNumber} (${r.storeName}): ${note.trim().slice(0, 120)}`,
          referenceType: 'return',
          referenceId: r.id,
        });
        const owner = ownerOf(r.storeId);
        if (owner)
          notify(owner.profile.id, {
            type: 'dispute',
            title: 'Return escalated to BazarHQ',
            body: `${r.customerName} disputed your rejection of ${r.returnNumber}.`,
            referenceType: 'return',
            referenceId: r.id,
          });
        return r;
      }),

    listTickets: () =>
      read(() => {
        const u = requireCustomer();
        return ctx.db.tickets.filter((t) => t.customerId === u.profile.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }),

    getTicket: (id) => read(() => ticketDetail(myTicket(id))),

    createTicket: (input) =>
      write(() => {
        const u = requireCustomer();
        const v = ticketCreateSchema.safeParse({ ...input, orderId: input.orderId ?? '' });
        if (!v.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(v.error));
        if (input.attachment) {
          const err = validateAttachmentFile(input.attachment);
          if (err) throw new ServiceError('VALIDATION', err, { attachment: err });
        }
        const order = input.orderId ? myOrder(input.orderId) : null;
        // FR-SUP-03: store/order/payment/delivery/return tickets route to the store's active Merchant;
        // account/other tickets — or an inactive Merchant — route to the Super Admin queue.
        const storeCategory = ['order_issue', 'payment_issue', 'delivery_issue', 'return_refund'].includes(v.data.category);
        const store = order ? ctx.db.stores.find((s) => s.id === order.storeId)! : null;
        const owner = store ? ownerOf(store.id) : null;
        const merchantActive = owner?.profile.status === 'active' && store?.status !== 'suspended';
        if (storeCategory && !order) throw new ServiceError('VALIDATION', 'Choose the order this is about.', { orderId: 'Choose the order this is about.' });
        const queue: SupportTicket['queue'] = storeCategory && merchantActive ? 'store' : 'platform';
        const admin = ctx.db.users.find((x) => x.profile.role === 'super_admin' && x.profile.status === 'active');
        const tid = newId('2222');
        const t: SupportTicket = {
          id: tid,
          queue,
          storeName: store?.name ?? null,
          ticketNumber: formatPublicId('TKT', ctx.now(), ++ctx.db.seq.ticket),
          customerId: u.profile.id,
          customerName: u.profile.fullName,
          storeId: store?.id ?? null,
          orderId: order?.id ?? null,
          orderNumber: order?.orderNumber ?? null,
          category: v.data.category,
          subject: v.data.subject,
          description: v.data.description,
          priority: v.data.priority,
          status: 'open',
          assignedTo: queue === 'store' ? owner!.profile.id : (admin?.profile.id ?? null),
          resolutionNote: null,
          firstMerchantResponseAt: null,
          escalationAt: null,
          closedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          dispute: { status: 'none', decision: null, adminNote: null },
        };
        ctx.db.tickets.push(t);
        if (input.attachment) {
          const mid = newId('2223');
          ctx.db.messages.push({
            id: mid,
            ticketId: tid,
            senderId: u.profile.id,
            senderName: u.profile.fullName,
            senderRole: 'customer',
            body: 'Attachment added with the ticket.',
            attachmentName: input.attachment.name,
            attachmentStoragePath: `tickets/${tid}/${mid}-${input.attachment.name}`,
            createdAt: nowIso(),
          });
        }
        ticketAudit(t, u.profile.fullName, 'created', null, 'open');
        notifyAssignee(t, 'New support ticket', `${t.ticketNumber}: ${t.subject}`);
        notify(u.profile.id, {
          type: 'support_ticket',
          title: 'Ticket received',
          body: `${t.ticketNumber} was sent to ${queue === 'store' ? store!.name : 'BazarHQ support'}.`,
          referenceType: 'support_ticket',
          referenceId: t.id,
        });
        return ticketDetail(t);
      }, 1.1),

    replyTicket: (id, { body, attachment }) =>
      write(() => {
        const u = requireCustomer();
        const t = myTicket(id);
        if (!canReplyToTicket(t.status)) throw new ServiceError('CONFLICT', 'This ticket is closed. Reopen it to continue the conversation.');
        if (!body.trim()) throw new ServiceError('VALIDATION', 'Write a reply.', { body: 'Write a reply.' });
        if (attachment) {
          const err = validateAttachmentFile(attachment);
          if (err) throw new ServiceError('VALIDATION', err, { attachment: err });
        }
        const mid = newId('2223');
        ctx.db.messages.push({
          id: mid,
          ticketId: t.id,
          senderId: u.profile.id,
          senderName: u.profile.fullName,
          senderRole: 'customer',
          body: body.trim(),
          attachmentName: attachment?.name ?? null,
          attachmentStoragePath: attachment ? `tickets/${t.id}/${mid}-${attachment.name}` : null,
          createdAt: nowIso(),
        });
        // FR-SUP-06: a customer reply moves Waiting for Customer → In Progress.
        if (t.status === 'waiting_for_customer') {
          ticketAudit(t, u.profile.fullName, 'status_changed', t.status, 'in_progress');
          t.status = 'in_progress';
        }
        if (t.dispute.status === 'info_requested') t.dispute.status = 'open';
        t.updatedAt = nowIso();
        ticketAudit(t, u.profile.fullName, 'reply', null, null);
        notifyAssignee(t, 'Customer replied', `${t.ticketNumber}: ${body.trim().slice(0, 100)}`);
        return ticketDetail(t);
      }, 0.8),

    setTicketPriority: (id, priority) =>
      write(() => {
        const u = requireCustomer();
        const t = myTicket(id);
        if (!canCustomerChangePriority(t.status)) throw new ServiceError('CONFLICT', 'Priority can’t be changed after a ticket is resolved.');
        ticketAudit(t, u.profile.fullName, 'priority_changed', t.priority, priority);
        t.priority = priority;
        t.updatedAt = nowIso();
        return ticketDetail(t);
      }, 0.5),

    reopenTicket: (id) =>
      write(() => {
        const u = requireCustomer();
        const t = myTicket(id);
        if (!canCustomerReopenTicket(t, ctx.now()))
          throw new ServiceError('CONFLICT', 'Closed tickets can be reopened within 7 days of closure. Please open a new ticket.');
        ticketAudit(t, u.profile.fullName, 'reopened', 'closed', 'open');
        t.status = 'open';
        t.closedAt = null;
        t.updatedAt = nowIso();
        notifyAssignee(t, 'Ticket reopened', `${t.ticketNumber} was reopened by the customer.`);
        return ticketDetail(t);
      }),

    escalateTicket: (id) =>
      write(() => {
        const u = requireCustomer();
        const t = myTicket(id);
        if (!canCustomerEscalateTicket(t, ctx.now())) {
          throw new ServiceError('CONFLICT', 'You can escalate to BazarHQ when the store hasn’t replied within 72 hours of the ticket being opened.');
        }
        const admin = ctx.db.users.find((x) => x.profile.role === 'super_admin' && x.profile.status === 'active');
        t.escalationAt = nowIso();
        t.assignedTo = admin?.profile.id ?? null;
        t.dispute = { status: 'open', decision: null, adminNote: null };
        t.updatedAt = nowIso();
        ticketAudit(t, u.profile.fullName, 'escalated', null, 'super_admin');
        audit(u, 'ticket.escalated', 'support_ticket', t.id, { ticket: t.ticketNumber });
        notifyAdmins({
          type: 'dispute',
          title: 'Ticket escalated',
          body: `${t.ticketNumber} (${t.storeName ?? 'platform'}): ${t.subject}`,
          referenceType: 'support_ticket',
          referenceId: t.id,
        });
        return ticketDetail(t);
      }),

    deleteAccount: (confirmation) =>
      write(() => {
        const u = requireCustomer();
        if (confirmation !== 'DELETE') throw new ServiceError('VALIDATION', 'Type DELETE to confirm.', { confirmation: 'Type DELETE to confirm.' });
        // FR-C-36: access to history is lost; merchants keep transaction records (retention, §20.6).
        u.profile.status = 'deleted';
        u.password = `deleted-${Math.random()}`;
        ctx.db.addresses = ctx.db.addresses.filter((a) => a.customerId !== u.profile.id);
        audit(u, 'customer.account_deleted', 'profile', u.profile.id);
        ctx.db.currentUserId = null;
      }, 1.2),
  };
}
