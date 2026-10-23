'use client';

import { useRef, useState } from 'react';
import { Clock, Paperclip, Send, X } from 'lucide-react';
import {
  canReplyToTicket,
  errorMessage,
  formatDateTime,
  formatRelative,
  resolutionNoteSchema,
  TICKET_CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_TRANSITIONS,
  ticketEscalationDueAt,
  toFieldErrors,
  type SupportTicketDetail,
  type TicketStatus,
  type UploadFile,
} from '@bazarhq/shared';
import { cn } from '../cn';
import { useNavigation, useServices } from '../context';
import { readAttachmentFile } from '../files';
import { Modal, useToast } from '../components';
import { Alert, Avatar, Button, TextArea } from '../components';
import { TicketPriorityBadge, TicketStatusBadge } from '../components';

const actionLabel: Partial<Record<TicketStatus, string>> = {
  in_progress: 'Mark in progress',
  waiting_for_customer: 'Waiting for customer',
  resolved: 'Resolve',
  closed: 'Close ticket',
};

export function TicketThread({ detail, onChange }: { detail: SupportTicketDetail; onChange: (d: SupportTicketDetail) => void }) {
  const services = useServices();
  const toast = useToast();
  const { Link, paths } = useNavigation();
  const { ticket, messages, audit } = detail;
  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState<UploadFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState<TicketStatus | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const canReply = canReplyToTicket(ticket.status);
  const due = ticketEscalationDueAt(ticket.createdAt);
  const [now] = useState(() => Date.now());
  const overdue = due.getTime() < now;
  const awaitingFirstReply = !ticket.firstMerchantResponseAt && ticket.status !== 'closed';

  const send = async () => {
    if (!body.trim()) {
      setError('Write a reply.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const d = await services.support.reply(ticket.id, { body, attachment });
      onChange(d);
      setBody('');
      setAttachment(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (to: TicketStatus, resolutionNote?: string) => {
    setStatusBusy(to);
    try {
      const d = await services.support.updateStatus(ticket.id, to, { resolutionNote });
      onChange(d);
      toast.success(`Ticket ${TICKET_STATUS_LABEL[to].toLowerCase()}`);
      setResolveOpen(false);
      setNote('');
    } catch (e) {
      toast.error('Couldn’t update the ticket', errorMessage(e));
    } finally {
      setStatusBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-ink-subtle">{ticket.ticketNumber}</span>
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
        </div>
        <h2 className="mt-1 text-lg font-bold text-ink">{ticket.subject}</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          {ticket.customerName} · {TICKET_CATEGORY_LABEL[ticket.category]} · opened {formatRelative(ticket.createdAt)}
          {ticket.orderId && ticket.orderNumber && (
            <>
              {' · '}
              <Link href={paths.order(ticket.orderId)} className="font-semibold text-brand-700 hover:underline">
                {ticket.orderNumber}
              </Link>
            </>
          )}
        </p>
        {awaitingFirstReply && (
          <p
            className={cn(
              'mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium',
              overdue ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800',
            )}
          >
            <Clock className="size-3.5" aria-hidden />
            {overdue
              ? 'The customer can now escalate this ticket to BazarHQ (72 h without a reply).'
              : `Reply before ${formatDateTime(due.toISOString())} to avoid escalation.`}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {TICKET_TRANSITIONS[ticket.status].map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === 'resolved' ? 'brand' : to === 'closed' ? 'primary' : 'secondary'}
              loading={statusBusy === to}
              onClick={() => (to === 'resolved' ? setResolveOpen(true) : void changeStatus(to))}
            >
              {actionLabel[to]}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-label="Conversation">
        <ChatMessage name={ticket.customerName} mine={false} at={ticket.createdAt} body={ticket.description} />
        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            name={m.senderName}
            mine={m.senderRole === 'merchant'}
            roleLabel={m.senderRole === 'super_admin' ? 'BazarHQ' : undefined}
            at={m.createdAt}
            body={m.body}
            attachment={m.attachmentName}
          />
        ))}
        {ticket.resolutionNote && (ticket.status === 'resolved' || ticket.status === 'closed') && (
          <Alert tone="success" title="Resolution note">
            {ticket.resolutionNote}
          </Alert>
        )}
        <details className="rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] text-ink-muted">
          <summary className="cursor-pointer font-semibold text-ink">Ticket history ({audit.length})</summary>
          <ul className="mt-2 space-y-1">
            {audit.map((a) => (
              <li key={a.id}>
                {formatDateTime(a.createdAt)} — {a.actorName ?? 'System'}: {a.eventType.replace(/_/g, ' ')}
                {a.newValue && a.previousValue && ` (${a.previousValue.replace(/_/g, ' ')} → ${a.newValue.replace(/_/g, ' ')})`}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="border-t border-line bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {canReply ? (
          <div className="space-y-2">
            {error && <Alert tone="danger">{error}</Alert>}
            <TextArea
              label="Reply to customer"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Replies are visible to the customer and cannot be edited later."
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" icon={<Paperclip className="size-4" aria-hidden />} onClick={() => fileRef.current?.click()}>
                  Attach
                </Button>
                {attachment && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-[12px]">
                    {attachment.name}
                    <button type="button" aria-label="Remove attachment" onClick={() => setAttachment(null)}>
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const { upload, error: err } = await readAttachmentFile(f);
                    if (err) setError(err);
                    else setAttachment(upload ?? null);
                    e.target.value = '';
                  }}
                />
              </div>
              <Button variant="brand" size="sm" icon={<Send className="size-4" aria-hidden />} loading={sending} onClick={() => void send()}>
                Send reply
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-center text-[13px] text-ink-muted">
            This ticket is closed and read-only. The customer can reopen it within 7 days if the issue recurs.
          </p>
        )}
      </div>

      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        busy={statusBusy === 'resolved'}
        title="Resolve ticket"
        description="A resolution note is required and is visible to the customer."
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              loading={statusBusy === 'resolved'}
              onClick={() => {
                const v = resolutionNoteSchema.safeParse({ resolutionNote: note });
                if (!v.success) return setNoteError(toFieldErrors(v.error).resolutionNote);
                void changeStatus('resolved', note);
              }}
            >
              Resolve
            </Button>
          </>
        }
      >
        <TextArea label="Resolution note" required value={note} onChange={(e) => setNote(e.target.value)} error={noteError} rows={3} data-autofocus />
      </Modal>
    </div>
  );
}

/** One chat bubble. `mine` aligns it to the right in the viewer's own colour. */
export function ChatMessage({
  name,
  mine,
  at,
  body,
  attachment,
  roleLabel,
}: {
  name: string;
  mine: boolean;
  at: string;
  body: string;
  attachment?: string | null;
  roleLabel?: string;
}) {
  return (
    <div className={cn('flex gap-2.5', mine && 'flex-row-reverse')}>
      <Avatar name={name} size={32} />
      <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2.5', mine ? 'rounded-tr-sm bg-navy-900 text-white' : 'rounded-tl-sm bg-canvas text-ink')}>
        <p className={cn('text-[12px] font-semibold', mine ? 'text-white/80' : 'text-ink-muted')}>
          {name}
          {roleLabel && (
            <span className={cn('ml-1.5 rounded px-1 py-px text-[10.5px] uppercase tracking-wide', mine ? 'bg-white/15' : 'bg-white text-navy-800')}>
              {roleLabel}
            </span>
          )}{' '}
          · <time dateTime={at}>{formatDateTime(at)}</time>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{body}</p>
        {attachment && (
          <p className={cn('mt-1.5 inline-flex items-center gap-1 text-[12px]', mine ? 'text-white/80' : 'text-ink-muted')}>
            <Paperclip className="size-3.5" aria-hidden /> {attachment}
          </p>
        )}
      </div>
    </div>
  );
}
