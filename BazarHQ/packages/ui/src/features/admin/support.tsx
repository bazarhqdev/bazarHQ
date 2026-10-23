'use client';

/** Super Admin: platform support queue, escalations, disputes (FR-SA-19..21) and refund oversight. */
import { useState } from 'react';
import { AlertTriangle, Banknote, ChevronRight, Gavel, LifeBuoy } from 'lucide-react';
import {
  canReplyToTicket,
  DISPUTE_STATUS_LABEL,
  errorMessage,
  formatBDT,
  formatDateTime,
  formatRelative,
  REFUND_METHOD_LABEL,
  REFUND_STATUS_LABEL,
  REFUND_STATUSES,
  RETURN_REASON_LABEL,
  resolutionSchema,
  TICKET_CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_TRANSITIONS,
  toFieldErrors,
  type DisputeKind,
  type Refund,
  type RefundStatus,
  type SupportTicketDetail,
  type TicketStatus,
} from '@bazarhq/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  Modal,
  PageHeader,
  ReturnStatusBadge,
  SearchInput,
  Skeleton,
  SkeletonRows,
  Switch,
  Tabs,
  TextArea,
  TextField,
  TicketPriorityBadge,
  TicketStatusBadge,
  useToast,
} from '../../components';
import { useAdminPaths, useAsync, useDebounced, useNavigation, useServiceEvents, useServices } from '../../context';
import { BackLink } from '../customer/account';
import { ChatMessage } from '../support';

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

export function AdminTicketsView() {
  const services = useServices();
  const { Link } = useNavigation();
  const a = useAdminPaths();
  const [queue, setQueue] = useState<'all' | 'platform' | 'store'>('platform');
  const [status, setStatus] = useState<TicketStatus | 'all'>('all');
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useAsync(() => services.admin.listTickets({ queue, status, escalatedOnly, search: q }), [queue, status, escalatedOnly, q]);
  useServiceEvents(() => void list.reload());
  return (
    <>
      <PageHeader
        title="Support"
        description="The platform queue holds account issues, tickets for unavailable stores and escalations after 72 hours without a merchant reply."
      />
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <Tabs
            label="Queue"
            value={queue}
            onChange={setQueue}
            items={[
              { value: 'platform', label: 'Platform queue' },
              { value: 'store', label: 'Store tickets' },
              { value: 'all', label: 'All' },
            ]}
          />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_200px_auto] md:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Subject, ticket, customer or store" label="Search tickets" />
            <select
              aria-label="Ticket status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TicketStatus | 'all')}
              className="h-10 rounded-lg border border-line-strong bg-white px-3 text-sm"
            >
              <option value="all">Any status</option>
              {(Object.keys(TICKET_STATUS_LABEL) as TicketStatus[]).map((s) => (
                <option key={s} value={s}>
                  {TICKET_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <Switch checked={escalatedOnly} onChange={setEscalatedOnly} label="Escalated only" />
          </div>
        </div>
        {list.loading ? (
          <SkeletonRows rows={5} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon={<LifeBuoy className="size-6" aria-hidden />} title="Queue is clear" />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.map((t) => (
              <li key={t.id}>
                <Link href={a.ticket(t.id)} className="flex items-center gap-3 px-5 py-3.5 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{t.subject}</p>
                    <p className="truncate text-[12.5px] text-ink-muted">
                      {t.ticketNumber} · {t.customerName} · {t.queue === 'platform' ? 'Platform' : t.storeName} · {formatRelative(t.updatedAt)}
                    </p>
                  </div>
                  {t.escalationAt && <Badge tone="violet">Escalated</Badge>}
                  {t.dispute.status !== 'none' && <Badge tone="violet">Dispute</Badge>}
                  <TicketPriorityBadge priority={t.priority} />
                  <TicketStatusBadge status={t.status} />
                  <ChevronRight className="size-4 text-ink-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

const statusAction: Partial<Record<TicketStatus, string>> = {
  in_progress: 'Mark in progress',
  waiting_for_customer: 'Waiting for customer',
  resolved: 'Resolve',
  closed: 'Close',
};

export function AdminTicketView({ id }: { id: string }) {
  const services = useServices();
  const toast = useToast();
  const { Link } = useNavigation();
  const a = useAdminPaths();
  const state = useAsync<SupportTicketDetail>(() => services.admin.getTicket(id), [id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [resolve, setResolve] = useState(false);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState<string>();
  const [dispute, setDispute] = useState<'request_info' | 'override' | 'close' | null>(null);
  useServiceEvents(() => void state.reload());
  if (state.loading) return <Skeleton className="h-96 w-full" />;
  if (state.error || !state.data) return <ErrorState message={state.error ?? 'Ticket not found.'} onRetry={state.reload} />;
  const { ticket: t, messages, audit } = state.data;

  const run = async (key: string, fn: () => Promise<SupportTicketDetail>, ok: string) => {
    setBusy(key);
    try {
      state.setData(await fn());
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error('Action failed', errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        back={<BackLink href={a.support} label="Support" />}
        title={t.subject}
        description={
          <>
            {t.ticketNumber} · {TICKET_CATEGORY_LABEL[t.category]} · {t.queue === 'platform' ? 'Platform queue' : `Store: ${t.storeName}`}
            {t.orderId && t.orderNumber && (
              <>
                {' · '}
                <Link href={a.order(t.orderId)} className="font-semibold text-brand-700 hover:underline">
                  {t.orderNumber}
                </Link>
              </>
            )}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TicketStatusBadge status={t.status} />
            <TicketPriorityBadge priority={t.priority} />
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex flex-col">
          <div className="space-y-4 p-5" aria-label="Conversation">
            <ChatMessage name={t.customerName} mine={false} roleLabel="Customer" at={t.createdAt} body={t.description} />
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                name={m.senderName}
                mine={m.senderRole === 'super_admin'}
                roleLabel={m.senderRole === 'merchant' ? 'Store' : m.senderRole === 'customer' ? 'Customer' : 'BazarHQ'}
                at={m.createdAt}
                body={m.body}
                attachment={m.attachmentName}
              />
            ))}
            {t.resolutionNote && (t.status === 'resolved' || t.status === 'closed') && (
              <Alert tone="success" title="Resolution">
                {t.resolutionNote}
              </Alert>
            )}
          </div>
          {canReplyToTicket(t.status) ? (
            <form
              className="mt-auto border-t border-line p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (body.trim()) void run('reply', () => services.admin.replyTicket(t.id, { body }), 'Reply sent').then((ok) => ok && setBody(''));
              }}
            >
              <TextArea label="Reply as BazarHQ Support" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="mt-2 flex justify-end">
                <Button type="submit" loading={busy === 'reply'} disabled={!body.trim()}>
                  Send reply
                </Button>
              </div>
            </form>
          ) : (
            <p className="mt-auto border-t border-line p-4 text-[13px] text-ink-muted">Closed tickets are read-only.</p>
          )}
        </Card>
        <aside className="space-y-4">
          <Card className="space-y-2 p-4">
            <p className="text-sm font-semibold">Workflow</p>
            <div className="flex flex-wrap gap-2">
              {TICKET_TRANSITIONS[t.status].map((to) => (
                <Button
                  key={to}
                  size="sm"
                  variant={to === 'resolved' ? 'brand' : 'secondary'}
                  loading={busy === to}
                  onClick={() =>
                    to === 'resolved'
                      ? setResolve(true)
                      : void run(to, () => services.admin.updateTicketStatus(t.id, to), `Ticket ${TICKET_STATUS_LABEL[to].toLowerCase()}`)
                  }
                >
                  {statusAction[to]}
                </Button>
              ))}
            </div>
          </Card>
          {(t.escalationAt || t.dispute.status !== 'none') && (
            <Card className="space-y-2 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <Gavel className="size-4" aria-hidden /> Dispute{' '}
                {t.dispute.status !== 'none' && <Badge tone="violet">{DISPUTE_STATUS_LABEL[t.dispute.status]}</Badge>}
              </p>
              {t.escalationAt && <p className="text-[13px] text-ink-muted">Escalated {formatDateTime(t.escalationAt)}.</p>}
              {t.dispute.adminNote && <p className="text-[13px] text-ink-muted">Note: {t.dispute.adminNote}</p>}
              {t.dispute.status !== 'resolved' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => setDispute('request_info')}>
                    Request info
                  </Button>
                  <Button size="sm" variant="brand" onClick={() => setDispute('override')}>
                    Decide for customer
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDispute('close')}>
                    Close
                  </Button>
                </div>
              )}
            </Card>
          )}
          <details className="rounded-xl border border-line bg-white px-4 py-3 text-[12.5px] text-ink-muted">
            <summary className="cursor-pointer font-semibold text-ink">History ({audit.length})</summary>
            <ul className="mt-2 space-y-1">
              {audit.map((x) => (
                <li key={x.id}>
                  {formatDateTime(x.createdAt)} — {x.actorName}: {x.eventType.replace('_', ' ')}
                  {x.newValue ? ` → ${x.newValue}` : ''}
                </li>
              ))}
            </ul>
          </details>
        </aside>
      </div>
      <Modal
        open={resolve}
        onClose={() => setResolve(false)}
        title="Resolve ticket"
        busy={busy === 'resolved'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolve(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              loading={busy === 'resolved'}
              onClick={async () => {
                const v = resolutionSchema.safeParse({ note });
                if (!v.success) return setNoteErr(toFieldErrors(v.error).note);
                if (await run('resolved', () => services.admin.updateTicketStatus(t.id, 'resolved', { resolutionNote: note }), 'Ticket resolved'))
                  setResolve(false);
              }}
            >
              Resolve
            </Button>
          </>
        }
      >
        <TextArea label="Resolution note" required value={note} onChange={(e) => setNote(e.target.value)} error={noteErr} />
      </Modal>
      <DisputeModal
        kind="ticket"
        id={t.id}
        action={dispute}
        onClose={() => setDispute(null)}
        onDone={() => {
          setDispute(null);
          void state.reload();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Disputes                                                            */
/* ------------------------------------------------------------------ */

const disputeCopy = {
  request_info: { title: 'Request more information', button: 'Send request', hint: 'Sent to the customer; the store sees it in the case.' },
  override: {
    title: 'Override the merchant’s decision',
    button: 'Override decision',
    hint: 'The return becomes approved (or the ticket resolved in the customer’s favour). Both parties are notified.',
  },
  close: { title: 'Close the dispute', button: 'Close dispute', hint: 'Upholds the merchant’s decision. The customer sees your note.' },
} as const;

function DisputeModal({
  kind,
  id,
  action,
  onClose,
  onDone,
}: {
  kind: DisputeKind;
  id: string;
  action: keyof typeof disputeCopy | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const services = useServices();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const c = action ? disputeCopy[action] : null;
  return (
    <Modal
      open={Boolean(action)}
      onClose={onClose}
      busy={busy}
      title={c?.title ?? ''}
      description={c?.hint}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === 'override' ? 'brand' : 'primary'}
            loading={busy}
            onClick={async () => {
              const v = resolutionSchema.safeParse({ note });
              if (!v.success) return setError(toFieldErrors(v.error).note);
              setBusy(true);
              try {
                await services.admin.resolveDispute(kind, id, { action: action!, note });
                toast.success('Dispute updated', 'Recorded in the audit log.');
                setNote('');
                onDone();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {c?.button}
          </Button>
        </>
      }
    >
      <TextArea label="Note" required hint="At least 10 characters. Audited." value={note} onChange={(e) => setNote(e.target.value)} error={error} />
    </Modal>
  );
}

export function DisputesView() {
  const services = useServices();
  const { Link } = useNavigation();
  const a = useAdminPaths();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const list = useAsync(() => services.admin.listDisputes({ status }), [status]);
  useServiceEvents(() => void list.reload());
  return (
    <>
      <PageHeader title="Disputes" description="Rejected returns and support cases the customer escalated to BazarHQ." />
      <Card>
        <div className="border-b border-line p-3">
          <Tabs
            label="Dispute status"
            value={status}
            onChange={setStatus}
            items={[
              { value: 'open', label: 'Open' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
        {list.loading ? (
          <SkeletonRows rows={4} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon={<Gavel className="size-6" aria-hidden />} title="No disputes" description="Escalated returns and tickets appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.map((d) => (
              <li key={`${d.kind}-${d.id}`}>
                <Link href={d.kind === 'ticket' ? a.ticket(d.id) : a.dispute(d.kind, d.id)} className="flex items-center gap-3 px-5 py-3.5 hover:bg-canvas">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
                    <Gavel className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.title}</p>
                    <p className="truncate text-[12.5px] text-ink-muted">
                      {d.reference} · {d.customerName} vs {d.storeName ?? 'store'} · escalated {formatRelative(d.escalatedAt)}
                    </p>
                  </div>
                  <Badge tone={d.kind === 'return' ? 'info' : 'navy'}>{d.kind === 'return' ? 'Return' : 'Ticket'}</Badge>
                  <Badge tone="violet">{DISPUTE_STATUS_LABEL[d.status]}</Badge>
                  <ChevronRight className="size-4 text-ink-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function ReturnDisputeView({ id }: { id: string }) {
  const services = useServices();
  const a = useAdminPaths();
  const { Link } = useNavigation();
  const d = useAsync(() => services.admin.getReturnDispute(id), [id]);
  const [action, setAction] = useState<'request_info' | 'override' | 'close' | null>(null);
  if (d.loading) return <Skeleton className="h-96 w-full" />;
  if (d.error || !d.data) return <ErrorState message={d.error ?? 'Not found.'} onRetry={d.reload} />;
  const { returnRequest: r, order, refund } = d.data;
  return (
    <>
      <PageHeader
        back={<BackLink href={a.disputes} label="Disputes" />}
        title={`Return dispute · ${r.returnNumber}`}
        description={
          <>
            {r.customerName} vs {r.storeName} ·{' '}
            <Link href={a.order(order.id)} className="font-semibold text-brand-700 hover:underline">
              {r.orderNumber}
            </Link>
          </>
        }
        actions={
          <div className="flex gap-2">
            <ReturnStatusBadge status={r.status} />
            <Badge tone="violet">{DISPUTE_STATUS_LABEL[r.dispute.status]}</Badge>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KeyValue label="Customer’s reason">{RETURN_REASON_LABEL[r.reason]}</KeyValue>
            <KeyValue label="Amount at stake">{formatBDT(r.refundAmountRequested)}</KeyValue>
          </div>
          <KeyValue label="Customer’s description">{r.conditionDescription}</KeyValue>
          {r.evidenceUrl && (
            <KeyValue label="Evidence">
              <img src={r.evidenceUrl} alt="Customer evidence" className="mt-1 max-h-56 rounded-lg ring-1 ring-line" />
            </KeyValue>
          )}
          <KeyValue label="Store’s decision">{r.merchantResponse ?? '—'}</KeyValue>
          <KeyValue label="Timeline">
            Requested {formatDateTime(r.createdAt)}
            {r.decidedAt && ` · decided ${formatDateTime(r.decidedAt)}`}
            {r.dispute.escalatedAt && ` · escalated ${formatDateTime(r.dispute.escalatedAt)}`}
          </KeyValue>
          {r.dispute.adminNote && (
            <Alert tone="info" title="Latest admin note">
              {r.dispute.adminNote}
            </Alert>
          )}
          {refund && (
            <KeyValue label="Refund">
              {formatBDT(refund.amount)} · {REFUND_STATUS_LABEL[refund.status]}
            </KeyValue>
          )}
        </Card>
        <aside className="space-y-4">
          {r.dispute.status !== 'resolved' ? (
            <Card className="space-y-2 p-4">
              <p className="text-sm font-semibold">Decision</p>
              <Button block variant="secondary" onClick={() => setAction('request_info')}>
                Request more information
              </Button>
              <Button block variant="brand" disabled={r.status !== 'rejected'} onClick={() => setAction('override')}>
                Override — approve the return
              </Button>
              <Button block variant="ghost" onClick={() => setAction('close')}>
                Uphold store decision & close
              </Button>
            </Card>
          ) : (
            <Alert tone="success" title={`Resolved — ${r.dispute.decision === 'overridden' ? 'overridden for customer' : 'store decision upheld'}`}>
              {r.dispute.adminNote}
            </Alert>
          )}
          <p className="text-[12.5px] text-ink-muted">
            Super Admins can’t change order status. After an override, the store completes the return and refund in its normal flow.
          </p>
        </aside>
      </div>
      <DisputeModal
        kind="return"
        id={r.id}
        action={action}
        onClose={() => setAction(null)}
        onDone={() => {
          setAction(null);
          void d.reload();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

const refundTone = { initiated: 'info', processing: 'warning', completed: 'success', failed: 'danger' } as const;

export function RefundsView() {
  const services = useServices();
  const [status, setStatus] = useState<RefundStatus | 'all'>('all');
  const [stalled, setStalled] = useState(false);
  const list = useAsync(() => services.admin.listRefunds({ status, stalledOnly: stalled }), [status, stalled]);
  const [target, setTarget] = useState<{ refund: Refund; action: 'mark_processing' | 'mark_failed' | 'settle' } | null>(null);
  const [now] = useState(() => Date.now());
  return (
    <>
      <PageHeader
        title="Refunds"
        description="Refunds are processed by stores. Intervene only when a refund is stuck — every action is audited and the store is notified."
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <Tabs
            label="Refund status"
            value={status}
            onChange={setStatus}
            items={[{ value: 'all' as const, label: 'All' }, ...REFUND_STATUSES.map((s) => ({ value: s, label: REFUND_STATUS_LABEL[s] }))]}
          />
          <Switch checked={stalled} onChange={setStalled} label="Stalled > 5 days" />
        </div>
        {list.loading ? (
          <SkeletonRows rows={4} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon={<Banknote className="size-6" aria-hidden />} title="No refunds match" />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.map((f) => {
              const isStalled = f.status !== 'completed' && now - Date.parse(f.createdAt) > 5 * 86_400_000;
              return (
                <li key={f.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {formatBDT(f.amount)} · {f.storeName} <Badge tone={refundTone[f.status]}>{REFUND_STATUS_LABEL[f.status]}</Badge>
                      {isStalled && (
                        <Badge tone="danger">
                          <AlertTriangle className="mr-1 inline size-3" aria-hidden />
                          Stalled
                        </Badge>
                      )}
                    </p>
                    <p className="text-[12.5px] text-ink-muted">
                      {f.orderNumber} · {f.returnNumber} · {f.customerName} · {REFUND_METHOD_LABEL[f.method]} · started {formatRelative(f.createdAt)}
                    </p>
                  </div>
                  {f.status !== 'completed' && (
                    <div className="flex flex-wrap gap-2">
                      {f.status !== 'processing' && (
                        <Button size="sm" variant="secondary" onClick={() => setTarget({ refund: f, action: 'mark_processing' })}>
                          Mark processing
                        </Button>
                      )}
                      <Button size="sm" variant="brand" onClick={() => setTarget({ refund: f, action: 'settle' })}>
                        Record settlement
                      </Button>
                      {f.status !== 'failed' && (
                        <Button size="sm" variant="ghost" onClick={() => setTarget({ refund: f, action: 'mark_failed' })}>
                          Mark failed
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {target && (
        <InterveneModal
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            void list.reload();
          }}
        />
      )}
    </>
  );
}

function InterveneModal({
  target,
  onClose,
  onDone,
}: {
  target: { refund: Refund; action: 'mark_processing' | 'mark_failed' | 'settle' };
  onClose: () => void;
  onDone: () => void;
}) {
  const services = useServices();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const label = target.action === 'settle' ? 'Record settlement' : target.action === 'mark_failed' ? 'Mark failed' : 'Mark processing';
  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`${label} · ${formatBDT(target.refund.amount)}`}
      description={`${target.refund.storeName} · ${target.refund.orderNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={target.action === 'mark_failed' ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await services.admin.interveneRefund(target.refund.id, { action: target.action, reference: reference || undefined, note });
                toast.success('Refund updated', 'Audited; the store was notified.');
                onDone();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {target.action === 'settle' && (
          <TextField
            label="Settlement reference"
            required
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            hint="Evidence is required to complete a refund."
          />
        )}
        <TextArea label="Reason for intervention" required hint="At least 10 characters. Audited." value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
