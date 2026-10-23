'use client';

/**
 * Logged-in Customer area (SRS §11.6, §14, §15): orders, returns, support
 * tickets, notifications, addresses and account settings. Every call is
 * re-authorized by the service layer; these screens are UX only.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Headset,
  Home,
  LifeBuoy,
  LogIn,
  MapPin,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingBag,
  Star,
  Trash2,
  User,
} from 'lucide-react';
import { Controller } from 'react-hook-form';
import {
  addressSchema,
  ADMIN_LIMITS,
  BD_DISTRICTS,
  canCancelOrder,
  canCustomerChangePriority,
  canCustomerEscalateTicket,
  canCustomerReopenTicket,
  canEscalateReturn,
  canReplyToTicket,
  changePasswordSchema,
  DISPUTE_STATUS_LABEL,
  errorMessage,
  formatBDT,
  formatDate,
  formatDateTime,
  formatRelative,
  newIdempotencyKey,
  PAYMENT_METHOD_LABEL,
  profileSchema,
  REFUND_METHOD_LABEL,
  REFUND_STATUS_LABEL,
  RETURN_METHOD_LABEL,
  RETURN_REASON_LABEL,
  returnRequestSchema,
  TICKET_CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  ticketCreateSchema,
  ticketEscalationDueAt,
  type Address,
  type ReturnReason,
  type SupportTicketDetail,
  type TicketCategory,
  type UploadFile,
} from '@bazarhq/shared';
import { cn } from '../../cn';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  KeyValue,
  Modal,
  OrderStatusBadge,
  PageHeader,
  PaymentMethodMark,
  PaymentStatusBadge,
  ReturnStatusBadge,
  SelectField,
  Skeleton,
  SkeletonRows,
  Spinner,
  Tabs,
  TextArea,
  TextField,
  TicketPriorityBadge,
  TicketStatusBadge,
  useToast,
} from '../../components';
import { customerNotificationHref, useAsync, useCustomerPaths, useNavigation, useServiceEvents, useServices, useSession } from '../../context';
import { readAttachmentFile, readImageFile } from '../../files';
import { useNative } from '../../native';
import { applyServerErrors, useZodForm } from '../../form';
import { NotificationList } from '../dashboard';
import { ChatMessage } from '../support';
import { TrackingTimeline } from './public';

/* ------------------------------------------------------------------ */
/* Navigation + guard                                                  */
/* ------------------------------------------------------------------ */

export function customerNav(p: ReturnType<typeof useCustomerPaths>) {
  return [
    { href: p.account, label: 'Overview', icon: Home },
    { href: p.orders, label: 'Orders', icon: ShoppingBag },
    { href: p.returns, label: 'Returns', icon: RotateCcw },
    { href: p.support, label: 'Support', icon: LifeBuoy },
    { href: p.notifications, label: 'Notifications', icon: Bell },
    { href: p.profile, label: 'Profile', icon: User },
  ];
}

/** UX guard only: sends guests to sign in and other roles to their own home. */
export function RequireCustomer({ children, loginHref }: { children: ReactNode; loginHref: string }) {
  const { session, status } = useSession();
  const { navigate, Link } = useNavigation();
  const p = useCustomerPaths();
  useEffect(() => {
    if (status === 'ready' && !session) navigate(loginHref, { replace: true });
  }, [status, session, navigate, loginHref]);
  if (status === 'loading' || !session) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label="Checking your session" />
      </div>
    );
  }
  if (session.user.role !== 'customer') {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <LogIn className="mx-auto size-10 text-navy-700" aria-hidden />
        <h1 className="mt-3 text-xl font-bold">Customer accounts only</h1>
        <p className="mt-2 text-sm text-ink-muted">
          You’re signed in as {session.user.email} ({session.user.role.replace('_', ' ')}). Sign in with a customer account to see orders and returns.
        </p>
        <Link href={p.home} className="mt-5 inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white">
          Go to BazarHQ home
        </Link>
      </main>
    );
  }
  return <>{children}</>;
}

/** Small "← Back" link above a page title. */
export function BackLink({ href, label }: { href: string; label: string }) {
  const { Link } = useNavigation();
  return (
    <Link href={href} className="mb-1 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink">
      <ArrowLeft className="size-3.5" aria-hidden /> {label}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export function CustomerHome() {
  const services = useServices();
  const { session } = useSession();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const orders = useAsync(() => services.account.listOrders(), []);
  const returns = useAsync(() => services.account.listReturns(), []);
  const tickets = useAsync(() => services.account.listTickets(), []);
  useServiceEvents(() => {
    void orders.reload();
    void returns.reload();
    void tickets.reload();
  });
  const active = (orders.data ?? []).filter((o) => !['delivered', 'cancelled'].includes(o.status));
  const openReturns = (returns.data ?? []).filter((r) => r.status !== 'closed');
  const openTickets = (tickets.data ?? []).filter((t) => t.status !== 'closed');
  const first = session?.user.fullName.split(' ')[0] ?? '';

  return (
    <>
      <PageHeader title={`Hi, ${first}`} description="Your orders across BazarHQ stores, in one place." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Active orders', value: active.length, href: p.orders, icon: Package },
          { label: 'Open returns', value: openReturns.length, href: p.returns, icon: RotateCcw },
          { label: 'Open tickets', value: openTickets.length, href: p.support, icon: Headset },
        ].map((s) => (
          <Link key={s.label} href={s.href} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 hover:border-line-strong">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <s.icon className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block text-2xl font-extrabold tabular text-ink">{orders.loading ? '–' : s.value}</span>
              <span className="text-[13px] text-ink-muted">{s.label}</span>
            </span>
          </Link>
        ))}
      </div>
      <Card className="mt-5">
        <CardHeader
          title="Recent orders"
          action={
            <Link href={p.orders} className="text-sm font-semibold text-brand-700 hover:underline">
              View all
            </Link>
          }
        />
        {orders.loading ? (
          <SkeletonRows rows={4} />
        ) : orders.error ? (
          <ErrorState message={orders.error} onRetry={orders.reload} />
        ) : (
          <OrderRows orders={(orders.data ?? []).slice(0, 5)} />
        )}
      </Card>
    </>
  );
}

function OrderRows({ orders }: { orders: Awaited<ReturnType<ReturnType<typeof useServices>['account']['listOrders']>> }) {
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  if (orders.length === 0)
    return (
      <EmptyState
        icon={<ShoppingBag className="size-6" aria-hidden />}
        title="No orders yet"
        description="Orders you place while signed in appear here."
        action={
          <Link href={p.stores()} className="text-sm font-semibold text-brand-700 hover:underline">
            Find a store
          </Link>
        }
      />
    );
  return (
    <ul className="divide-y divide-line">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={p.order(o.id)} className="flex items-center gap-3 px-5 py-3.5 hover:bg-canvas">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {o.orderNumber} <span className="font-normal text-ink-muted">· {o.storeName}</span>
              </p>
              <p className="text-[12.5px] text-ink-muted">
                {formatDate(o.createdAt)} · {o.items.reduce((s, i) => s + i.quantity, 0)} item{o.items.length === 1 && o.items[0]!.quantity === 1 ? '' : 's'} ·{' '}
                {formatBDT(o.totalAmount)}
              </p>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <OrderStatusBadge status={o.status} />
              <PaymentStatusBadge status={o.paymentStatus} />
            </div>
            <ChevronRight className="size-4 text-ink-subtle" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Orders (FR-C-32)                                                    */
/* ------------------------------------------------------------------ */

export function CustomerOrders() {
  const services = useServices();
  const orders = useAsync(() => services.account.listOrders(), []);
  const [tab, setTab] = useState<'all' | 'active' | 'delivered' | 'cancelled'>('all');
  useServiceEvents(() => void orders.reload());
  const list = (orders.data ?? []).filter((o) => (tab === 'all' ? true : tab === 'active' ? !['delivered', 'cancelled'].includes(o.status) : o.status === tab));
  return (
    <>
      <PageHeader title="My orders" description="Every order you placed while signed in, from every BazarHQ store." />
      <Card>
        <div className="border-b border-line p-3">
          <Tabs
            label="Filter orders"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        </div>
        {orders.loading ? (
          <SkeletonRows rows={6} />
        ) : orders.error ? (
          <ErrorState message={orders.error} onRetry={orders.reload} />
        ) : (
          <OrderRows orders={list} />
        )}
      </Card>
    </>
  );
}

export function CustomerOrderView({ id }: { id: string }) {
  const services = useServices();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const order = useAsync(() => services.account.getOrder(id), [id]);
  const returns = useAsync(() => services.account.listReturns(), [id]);
  const [returnOpen, setReturnOpen] = useState(false);
  useServiceEvents(() => void order.reload());

  if (order.loading) return <Skeleton className="h-96 w-full" />;
  if (order.error || !order.data) return <ErrorState message={order.error ?? 'Order not found.'} onRetry={order.reload} />;
  const d = order.data;
  const o = d.order;
  const existingReturn = (returns.data ?? []).find((r) => r.orderId === o.id);

  return (
    <>
      <PageHeader
        back={<BackLink href={p.orders} label="Orders" />}
        title={o.orderNumber}
        description={
          <>
            from{' '}
            <Link href={p.store(d.storeSubdomain)} className="font-semibold text-brand-700 hover:underline">
              {d.storeName}
            </Link>{' '}
            · placed {formatDateTime(o.createdAt)}
          </>
        }
        actions={
          <>
            <Link
              href={p.newTicket(o.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-white px-3 text-sm font-semibold hover:bg-canvas"
            >
              <LifeBuoy className="size-4" aria-hidden /> Get help
            </Link>
            {existingReturn ? (
              <Link
                href={p.returnDetail(existingReturn.id)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-navy-900 px-3 text-sm font-semibold text-white"
              >
                View return
              </Link>
            ) : (
              d.returnEligibility.eligible && (
                <Button size="sm" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setReturnOpen(true)}>
                  Request return
                </Button>
              )
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              <OrderStatusBadge status={o.status} />
              <PaymentStatusBadge status={o.paymentStatus} />
            </div>
            <TrackingTimeline status={o.status} events={d.events} cancellationReason={o.cancellationReason} />
          </Card>
          <Card>
            <CardHeader title="Items" />
            <ul className="divide-y divide-line">
              {o.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    <span className="font-semibold">{i.productName}</span>
                    {i.variantLabel && <span className="text-ink-muted"> · {i.variantLabel}</span>}
                    <span className="block text-[12.5px] text-ink-muted">
                      {i.quantity} × {formatBDT(i.unitPrice)}
                    </span>
                  </span>
                  <span className="font-semibold tabular">{formatBDT(i.subtotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-line px-5 py-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Subtotal</dt>
                <dd className="tabular">{formatBDT(o.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Delivery</dt>
                <dd className="tabular">{formatBDT(o.deliveryCharge)}</dd>
              </div>
              <div className="flex justify-between text-base font-bold">
                <dt>Total</dt>
                <dd className="tabular">{formatBDT(o.totalAmount)}</dd>
              </div>
            </dl>
          </Card>
        </div>
        <aside className="space-y-5">
          <Card className="space-y-3 p-5 text-sm">
            <KeyValue label="Payment">
              <span className="inline-flex items-center gap-2">
                <PaymentMethodMark method={o.paymentMethod} size={22} /> {PAYMENT_METHOD_LABEL[o.paymentMethod]}
              </span>
            </KeyValue>
            <KeyValue label="Deliver to">
              {o.deliveryAddress.recipientName} · {o.deliveryAddress.phone}
              <br />
              {o.deliveryAddress.address}, {o.deliveryAddress.district}
            </KeyValue>
          </Card>
          <Card className="p-5 text-sm" aria-labelledby="cancel-h">
            <p id="cancel-h" className="font-semibold text-ink">
              Cancellation
            </p>
            {o.status === 'cancelled' ? (
              <p className="mt-1 text-ink-muted">Cancelled by the store{o.cancellationReason ? `: ${o.cancellationReason}` : '.'}</p>
            ) : canCancelOrder(o.status) ? (
              <>
                <p className="mt-1 text-ink-muted">
                  This order can still be cancelled — only {d.storeName} can cancel it, because stock and payment are released on their side.
                </p>
                <Link href={p.newTicket(o.id)} className="mt-2 inline-block text-[13px] font-semibold text-brand-700 hover:underline">
                  Ask the store to cancel →
                </Link>
              </>
            ) : (
              <p className="mt-1 text-ink-muted">
                This order can no longer be cancelled because it is {o.status === 'delivered' ? 'delivered' : 'out for delivery'}.
                {o.status === 'delivered' ? ' You can request a return instead.' : ''}
              </p>
            )}
          </Card>
          <Card className="p-5 text-sm">
            <p className="font-semibold text-ink">Returns</p>
            {existingReturn ? (
              <p className="mt-1 text-ink-muted">
                Return {existingReturn.returnNumber} is <ReturnStatusBadge status={existingReturn.status} />
              </p>
            ) : d.returnEligibility.eligible ? (
              <p className="mt-1 text-ink-muted">You can request a return until {formatDateTime(d.returnEligibility.windowEndsAt!)}.</p>
            ) : (
              <p className="mt-1 text-ink-muted">{d.returnEligibility.reason}</p>
            )}
          </Card>
        </aside>
      </div>
      <ReturnRequestModal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        orderId={o.id}
        orderNumber={o.orderNumber}
        onCreated={() => void returns.reload()}
      />
    </>
  );
}

function ReturnRequestModal({
  open,
  onClose,
  orderId,
  orderNumber,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: string;
  onCreated: () => void;
}) {
  const services = useServices();
  const toast = useToast();
  const { navigate } = useNavigation();
  const p = useCustomerPaths();
  const native = useNative();
  const [evidence, setEvidence] = useState<UploadFile | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [idem] = useState(() => newIdempotencyKey('return'));
  const form = useZodForm(returnRequestSchema, { reason: '' as ReturnReason, conditionDescription: '' });
  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const r = await services.account.createReturn(orderId, { ...v, evidence, idempotencyKey: idem });
      toast.success('Return requested', `${r.returnNumber} was sent to the store.`);
      onCreated();
      onClose();
      navigate(p.returnDetail(r.id));
    } catch (err) {
      if (!applyServerErrors(form, err)) toast.error('Couldn’t request the return', errorMessage(err));
    } finally {
      setBusy(false);
    }
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Request a return"
      description={`For ${orderNumber}. One return request is allowed per order.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Submit request
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <SelectField
          label="Reason"
          required
          placeholder="Choose a reason"
          options={Object.entries(RETURN_REASON_LABEL).map(([value, label]) => ({ value, label }))}
          {...form.register('reason')}
          error={form.formState.errors.reason?.message}
        />
        <TextArea
          label="Item condition"
          required
          hint="Describe what’s wrong and the item’s current condition."
          {...form.register('conditionDescription')}
          error={form.formState.errors.conditionDescription?.message}
        />
        <div>
          <label className="text-sm font-semibold text-ink" htmlFor="evidence">
            Photo (optional)
          </label>
          <input
            id="evidence"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-semibold"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return setEvidence(null);
              const r = await readImageFile(f);
              setFileError(r.error);
              setEvidence(r.upload ?? null);
            }}
          />
          {native.pickImage && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={async () => {
                const f = await native.pickImage!();
                if (!f) return;
                const r = await readImageFile(f);
                setFileError(r.error);
                setEvidence(r.upload ?? null);
              }}
            >
              {evidence ? 'Retake photo' : 'Take a photo'}
            </Button>
          )}
          {evidence && <p className="mt-1 text-[12.5px] text-ink-muted">Attached: {evidence.name}</p>}
          {fileError && <p className="mt-1 text-[13px] text-red-700">{fileError}</p>}
          <p className="mt-1 text-[12px] text-ink-subtle">JPG, PNG or WebP up to 5 MB.</p>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Returns + refunds (§14)                                             */
/* ------------------------------------------------------------------ */

export function CustomerReturns() {
  const services = useServices();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const list = useAsync(() => services.account.listReturns(), []);
  useServiceEvents(() => void list.reload());
  return (
    <>
      <PageHeader title="Returns" description="Request returns from an order’s page within the store’s return window." />
      <Card>
        {list.loading ? (
          <SkeletonRows rows={4} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (list.data?.length ?? 0) === 0 ? (
          <EmptyState icon={<RotateCcw className="size-6" aria-hidden />} title="No returns" description="Open a delivered order to request a return." />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.map((r) => (
              <li key={r.id}>
                <Link href={p.returnDetail(r.id)} className="flex items-center gap-3 px-5 py-3.5 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {r.returnNumber} <span className="font-normal text-ink-muted">· {r.storeName}</span>
                    </p>
                    <p className="text-[12.5px] text-ink-muted">
                      {r.orderNumber} · {RETURN_REASON_LABEL[r.reason]} · {formatRelative(r.createdAt)}
                    </p>
                  </div>
                  {r.dispute.status !== 'none' && <Badge tone="violet">Dispute: {DISPUTE_STATUS_LABEL[r.dispute.status]}</Badge>}
                  <ReturnStatusBadge status={r.status} />
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

export function CustomerReturnView({ id }: { id: string }) {
  const services = useServices();
  const toast = useToast();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const state = useAsync(() => services.account.getReturn(id), [id]);
  const [escalate, setEscalate] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useServiceEvents(() => void state.reload());
  if (state.loading) return <Skeleton className="h-80 w-full" />;
  if (state.error || !state.data) return <ErrorState message={state.error ?? 'Return not found.'} onRetry={state.reload} />;
  const { returnRequest: r, refund } = state.data;
  const steps: { label: string; at: string | null; done: boolean; bad?: boolean }[] = [
    { label: 'Requested', at: r.createdAt, done: true },
    {
      label: r.status === 'rejected' || (r.status === 'closed' && !r.receivedAt && r.decidedAt) ? 'Rejected' : 'Approved',
      at: r.decidedAt,
      done: Boolean(r.decidedAt),
      bad: r.status === 'rejected',
    },
    { label: 'Item received', at: r.receivedAt, done: Boolean(r.receivedAt) },
    { label: 'Closed', at: r.closedAt, done: r.status === 'closed' },
  ];
  return (
    <>
      <PageHeader
        back={<BackLink href={p.returns} label="Returns" />}
        title={r.returnNumber}
        description={
          <>
            for{' '}
            <Link href={p.order(r.orderId)} className="font-semibold text-brand-700 hover:underline">
              {r.orderNumber}
            </Link>{' '}
            · {r.storeName}
          </>
        }
        actions={<ReturnStatusBadge status={r.status} />}
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <ol className="space-y-3">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-[11px] font-bold',
                    s.bad ? 'bg-red-600 text-white' : s.done ? 'bg-brand-600 text-white' : 'border-2 border-line-strong text-transparent',
                  )}
                >
                  ✓
                </span>
                <span className={cn('text-sm', s.done ? 'font-semibold text-ink' : 'text-ink-subtle')}>{s.label}</span>
                {s.at && <span className="ml-auto text-[12px] text-ink-subtle">{formatDateTime(s.at)}</span>}
              </li>
            ))}
          </ol>
          <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
            <KeyValue label="Reason">{RETURN_REASON_LABEL[r.reason]}</KeyValue>
            <KeyValue label="Condition">{r.conditionDescription}</KeyValue>
            {r.evidenceUrl && (
              <KeyValue label="Photo">
                <img src={r.evidenceUrl} alt="Return evidence" className="mt-1 max-h-40 rounded-lg ring-1 ring-line" />
              </KeyValue>
            )}
            {r.returnMethod && <KeyValue label="Return method">{RETURN_METHOD_LABEL[r.returnMethod]}</KeyValue>}
            {r.merchantResponse && <KeyValue label="Store response">{r.merchantResponse}</KeyValue>}
          </dl>
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <p className="text-sm font-bold">Refund</p>
            {!refund ? (
              <p className="mt-1 text-sm text-ink-muted">
                {r.status === 'rejected' ? 'No refund — the return was rejected.' : 'A refund is created after the store receives the item.'}
              </p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-extrabold tabular">{formatBDT(refund.amount)}</p>
                <p className="text-[13px] text-ink-muted">
                  {REFUND_METHOD_LABEL[refund.method]} ·{' '}
                  <Badge tone={refund.status === 'completed' ? 'success' : refund.status === 'failed' ? 'danger' : 'info'}>
                    {REFUND_STATUS_LABEL[refund.status]}
                  </Badge>
                </p>
                <ol className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
                  {refund.events.map((e, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>
                        <strong>{REFUND_STATUS_LABEL[e.status]}</strong>
                        {e.note && <span className="text-ink-muted"> — {e.note}</span>}
                      </span>
                      <span className="shrink-0 text-ink-subtle">{formatDate(e.createdAt)}</span>
                    </li>
                  ))}
                </ol>
                {refund.confirmationReference && <p className="mt-2 text-[12.5px] text-ink-muted">Reference: {refund.confirmationReference}</p>}
              </>
            )}
          </Card>
          {r.dispute.status !== 'none' ? (
            <Alert tone={r.dispute.status === 'resolved' ? 'success' : 'info'} title={`Escalated to BazarHQ — ${DISPUTE_STATUS_LABEL[r.dispute.status]}`}>
              {r.dispute.adminNote ?? 'A BazarHQ team member is reviewing the store’s decision.'}
            </Alert>
          ) : (
            canEscalateReturn(r) && (
              <Card className="p-5">
                <p className="text-sm font-bold">Disagree with the decision?</p>
                <p className="mt-1 text-[13px] text-ink-muted">Escalate to BazarHQ. A platform admin reviews the evidence from both sides.</p>
                <Button className="mt-3" variant="secondary" onClick={() => setEscalate(true)}>
                  Escalate to BazarHQ
                </Button>
              </Card>
            )
          )}
        </div>
      </div>
      <Modal
        open={escalate}
        onClose={() => setEscalate(false)}
        busy={busy}
        title="Escalate this return"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEscalate(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await services.account.escalateReturn(r.id, note);
                  toast.success('Escalated', 'BazarHQ will review and reply.');
                  setEscalate(false);
                  void state.reload();
                } catch (err) {
                  toast.error('Couldn’t escalate', errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Escalate
            </Button>
          </>
        }
      >
        <TextArea label="Why do you disagree?" required hint="At least 10 characters." value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Support (§15)                                                       */
/* ------------------------------------------------------------------ */

export function CustomerTickets() {
  const services = useServices();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const list = useAsync(() => services.account.listTickets(), []);
  useServiceEvents(() => void list.reload());
  return (
    <>
      <PageHeader
        title="Support"
        description="Order, payment and delivery questions go to the store. Account questions — or stores that are unavailable — go to BazarHQ."
        actions={
          <Link
            href={p.newTicket()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-navy-900 px-3 text-sm font-semibold text-white hover:bg-navy-800"
          >
            <Plus className="size-4" aria-hidden /> New ticket
          </Link>
        }
      />
      <Card>
        {list.loading ? (
          <SkeletonRows rows={4} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (list.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<LifeBuoy className="size-6" aria-hidden />}
            title="No tickets"
            description="Need help with an order? Open a ticket and the store will reply."
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.map((t) => (
              <li key={t.id}>
                <Link href={p.ticket(t.id)} className="flex items-center gap-3 px-5 py-3.5 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{t.subject}</p>
                    <p className="text-[12.5px] text-ink-muted">
                      {t.ticketNumber} · {t.queue === 'platform' ? 'BazarHQ support' : t.storeName} · updated {formatRelative(t.updatedAt)}
                    </p>
                  </div>
                  {t.escalationAt && <Badge tone="violet">Escalated</Badge>}
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

export function NewTicketForm({ orderId }: { orderId?: string }) {
  const services = useServices();
  const toast = useToast();
  const { navigate } = useNavigation();
  const p = useCustomerPaths();
  const orders = useAsync(() => services.account.listOrders(), []);
  const [attachment, setAttachment] = useState<UploadFile | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const form = useZodForm(ticketCreateSchema, {
    category: (orderId ? 'order_issue' : '') as TicketCategory,
    subject: '',
    description: '',
    priority: 'normal',
    orderId: orderId ?? '',
  });
  const category = form.watch('category');
  const storeCategory = ['order_issue', 'payment_issue', 'delivery_issue', 'return_refund'].includes(category);
  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const d = await services.account.createTicket({ ...v, orderId: v.orderId || null, attachment });
      toast.success('Ticket created', `${d.ticket.ticketNumber} · ${d.ticket.queue === 'platform' ? 'BazarHQ support' : d.ticket.storeName} will reply.`);
      navigate(p.ticket(d.ticket.id), { replace: true });
    } catch (err) {
      if (!applyServerErrors(form, err)) toast.error('Couldn’t create the ticket', errorMessage(err));
      setBusy(false);
    }
  });
  return (
    <>
      <PageHeader back={<BackLink href={p.support} label="Support" />} title="New support ticket" />
      <Card className="max-w-2xl p-5">
        <form onSubmit={submit} noValidate className="space-y-4">
          <SelectField
            label="Category"
            required
            placeholder="Choose a category"
            options={Object.entries(TICKET_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
            {...form.register('category')}
            error={form.formState.errors.category?.message}
          />
          {(storeCategory || form.watch('orderId')) && (
            <SelectField
              label="Order"
              required={storeCategory}
              placeholder={orders.loading ? 'Loading orders…' : 'Choose the order'}
              options={(orders.data ?? []).map((o) => ({ value: o.id, label: `${o.orderNumber} · ${o.storeName}` }))}
              hint="Order issues are sent to that order’s store."
              {...form.register('orderId')}
              error={form.formState.errors.orderId?.message}
            />
          )}
          <TextField label="Subject" required {...form.register('subject')} error={form.formState.errors.subject?.message} />
          <TextArea label="Describe the issue" required rows={5} {...form.register('description')} error={form.formState.errors.description?.message} />
          <Controller
            control={form.control}
            name="priority"
            render={({ field }) => (
              <Checkbox
                label="Mark as urgent"
                description="Use for problems that stop you from receiving or paying for an order."
                checked={field.value === 'urgent'}
                onChange={(c) => field.onChange(c ? 'urgent' : 'normal')}
              />
            )}
          />
          <div>
            <label htmlFor="ticket-file" className="text-sm font-semibold text-ink">
              Attachment (optional)
            </label>
            <input
              id="ticket-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-semibold"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return setAttachment(null);
                const r = await readAttachmentFile(f);
                setFileError(r.error);
                setAttachment(r.upload ?? null);
              }}
            />
            {fileError && <p className="mt-1 text-[13px] text-red-700">{fileError}</p>}
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              Create ticket
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}

export function CustomerTicketView({ id }: { id: string }) {
  const services = useServices();
  const toast = useToast();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const state = useAsync<SupportTicketDetail>(() => services.account.getTicket(id), [id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  useServiceEvents(() => void state.reload());
  if (state.loading) return <Skeleton className="h-96 w-full" />;
  if (state.error || !state.data) return <ErrorState message={state.error ?? 'Ticket not found.'} onRetry={state.reload} />;
  const { ticket: t, messages } = state.data;

  const act = async (key: string, fn: () => Promise<SupportTicketDetail>, ok: string) => {
    setBusy(key);
    try {
      state.setData(await fn());
      toast.success(ok);
    } catch (err) {
      toast.error('Something went wrong', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const canEscalate = canCustomerEscalateTicket(t, now);
  const due = ticketEscalationDueAt(t.createdAt);

  return (
    <>
      <PageHeader
        back={<BackLink href={p.support} label="Support" />}
        title={t.subject}
        description={
          <>
            {t.ticketNumber} · {t.queue === 'platform' ? 'BazarHQ support' : t.storeName}
            {t.orderId && t.orderNumber && (
              <>
                {' · '}
                <Link href={p.order(t.orderId)} className="font-semibold text-brand-700 hover:underline">
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
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="flex flex-col">
          <div className="space-y-4 p-5" aria-label="Conversation">
            <ChatMessage name={t.customerName} mine at={t.createdAt} body={t.description} />
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                name={m.senderName}
                mine={m.senderRole === 'customer'}
                roleLabel={m.senderRole === 'super_admin' ? 'BazarHQ' : m.senderRole === 'merchant' ? 'Store' : undefined}
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
                if (!body.trim()) return;
                void act('reply', () => services.account.replyTicket(t.id, { body }), 'Reply sent').then(() => setBody(''));
              }}
            >
              <TextArea label="Reply" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message…" />
              <div className="mt-2 flex justify-end">
                <Button type="submit" loading={busy === 'reply'} disabled={!body.trim()}>
                  Send
                </Button>
              </div>
            </form>
          ) : (
            <p className="mt-auto border-t border-line p-4 text-[13px] text-ink-muted">This ticket is closed and read-only.</p>
          )}
        </Card>
        <aside className="space-y-4">
          <Card className="space-y-3 p-4 text-sm">
            <KeyValue label="Category">{TICKET_CATEGORY_LABEL[t.category]}</KeyValue>
            <KeyValue label="Status">{TICKET_STATUS_LABEL[t.status]}</KeyValue>
            <KeyValue label="Opened">{formatDateTime(t.createdAt)}</KeyValue>
            {canCustomerChangePriority(t.status) && (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === 'priority'}
                icon={<Star className="size-4" aria-hidden />}
                onClick={() =>
                  act('priority', () => services.account.setTicketPriority(t.id, t.priority === 'urgent' ? 'normal' : 'urgent'), 'Priority updated')
                }
              >
                {t.priority === 'urgent' ? 'Mark as normal' : 'Mark as urgent'}
              </Button>
            )}
          </Card>
          {t.queue === 'store' && !t.escalationAt && !t.firstMerchantResponseAt && t.status !== 'closed' && (
            <Card className="p-4 text-sm">
              <p className="font-semibold">No reply from the store?</p>
              <p className="mt-1 text-[13px] text-ink-muted">
                {canEscalate
                  ? 'It’s been over 72 hours. You can escalate this ticket to BazarHQ.'
                  : `If the store hasn’t replied by ${formatDateTime(due.toISOString())}, you can escalate to BazarHQ.`}
              </p>
              <Button
                size="sm"
                className="mt-3"
                disabled={!canEscalate}
                loading={busy === 'escalate'}
                onClick={() => act('escalate', () => services.account.escalateTicket(t.id), 'Escalated to BazarHQ')}
              >
                Escalate to BazarHQ
              </Button>
            </Card>
          )}
          {t.escalationAt && (
            <Alert tone="info" title="Escalated to BazarHQ">
              Escalated {formatRelative(t.escalationAt)}. A platform admin will follow up.
            </Alert>
          )}
          {canCustomerReopenTicket(t, now) && (
            <Card className="p-4 text-sm">
              <p className="font-semibold">Issue not fixed?</p>
              <p className="mt-1 text-[13px] text-ink-muted">You can reopen a closed ticket within {ADMIN_LIMITS.ticketReopenDays} days.</p>
              <Button
                size="sm"
                className="mt-3"
                variant="secondary"
                loading={busy === 'reopen'}
                onClick={() => act('reopen', () => services.account.reopenTicket(t.id), 'Ticket reopened')}
              >
                Reopen ticket
              </Button>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function CustomerNotifications() {
  const services = useServices();
  const p = useCustomerPaths();
  const list = useAsync(() => services.notifications.list(), []);
  useEffect(() => services.notifications.subscribe(() => void list.reload()), [services, list.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <Button size="sm" variant="secondary" onClick={() => services.notifications.markAllRead().then(list.reload)}>
            Mark all read
          </Button>
        }
      />
      <Card>
        {list.loading ? (
          <SkeletonRows rows={5} />
        ) : (list.data?.length ?? 0) === 0 ? (
          <EmptyState icon={<Bell className="size-6" aria-hidden />} title="You’re all caught up" />
        ) : (
          <NotificationList
            items={list.data!}
            hrefFor={(n) => customerNotificationHref(n, p)}
            onOpen={(n) => void services.notifications.markRead(n.id).then(list.reload)}
          />
        )}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Profile, addresses, password, delete (FR-C-33/36)                   */
/* ------------------------------------------------------------------ */

export function CustomerProfile() {
  return (
    <>
      <PageHeader title="Profile" description="Your details, saved addresses and account settings." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ProfileCard />
        <AddressBook />
        <PasswordCard />
        <DeleteAccountCard />
      </div>
    </>
  );
}

/** Saved addresses as a page of its own (mobile "Addresses" screen). */
export function CustomerAddresses() {
  return (
    <>
      <PageHeader title="Addresses" description={`Up to ${ADMIN_LIMITS.maxSavedAddresses} delivery addresses. The default pre-fills checkout.`} />
      <AddressBook />
    </>
  );
}

function ProfileCard() {
  const services = useServices();
  const toast = useToast();
  const { session, refresh } = useSession();
  const form = useZodForm(profileSchema, { fullName: session?.user.fullName ?? '', phone: session?.user.phone ?? '' });
  const submit = form.handleSubmit(async (v) => {
    try {
      await services.auth.updateProfile({ fullName: v.fullName, phone: v.phone || null });
      await refresh();
      toast.success('Profile saved');
    } catch (err) {
      if (!applyServerErrors(form, err)) toast.error('Couldn’t save', errorMessage(err));
    }
  });
  return (
    <Card>
      <CardHeader title="Personal details" description={session?.user.email} />
      <form onSubmit={submit} noValidate className="space-y-4 p-5 pt-0">
        <TextField label="Full name" required {...form.register('fullName')} error={form.formState.errors.fullName?.message} />
        <TextField label="Phone" inputMode="tel" placeholder="01XXXXXXXXX" {...form.register('phone')} error={form.formState.errors.phone?.message} />
        <div className="flex justify-end">
          <Button type="submit" loading={form.formState.isSubmitting}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function AddressBook() {
  const services = useServices();
  const toast = useToast();
  const list = useAsync(() => services.account.listAddresses(), []);
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [removing, setRemoving] = useState<Address | null>(null);
  const full = (list.data?.length ?? 0) >= ADMIN_LIMITS.maxSavedAddresses;
  return (
    <Card id="addresses" className="scroll-mt-24">
      <CardHeader
        title="Saved addresses"
        description={`Up to ${ADMIN_LIMITS.maxSavedAddresses}. The default pre-fills checkout.`}
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="size-4" aria-hidden />}
            disabled={full}
            onClick={() => setEditing('new')}
            title={full ? 'Delete an address to add another' : undefined}
          >
            Add
          </Button>
        }
      />
      {list.loading ? (
        <SkeletonRows rows={2} />
      ) : (list.data?.length ?? 0) === 0 ? (
        <EmptyState icon={<MapPin className="size-6" aria-hidden />} title="No saved addresses" />
      ) : (
        <ul className="divide-y divide-line">
          {list.data!.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-5 py-3.5">
              <MapPin className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  {a.label} {a.isDefault && <Badge tone="success">Default</Badge>}
                </p>
                <p className="text-ink-muted">
                  {a.recipientName} · {a.phone}
                  <br />
                  {a.address}, {a.district} {a.postalCode}
                </p>
                {!a.isDefault && (
                  <button
                    type="button"
                    className="mt-1 text-[13px] font-semibold text-brand-700"
                    onClick={() => services.account.setDefaultAddress(a.id).then((d) => list.setData(d))}
                  >
                    Set as default
                  </button>
                )}
              </div>
              <button
                type="button"
                aria-label={`Edit ${a.label}`}
                onClick={() => setEditing(a)}
                className="rounded-lg p-2 text-ink-subtle hover:bg-canvas hover:text-ink"
              >
                <Pencil className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Delete ${a.label}`}
                onClick={() => setRemoving(a)}
                className="rounded-lg p-2 text-ink-subtle hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {full && <p className="border-t border-line px-5 py-2.5 text-[12.5px] text-ink-subtle">You’ve saved 3 addresses. Delete one to add another.</p>}
      {editing && <AddressModal address={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(d) => list.setData(d)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Delete this address?"
        description={removing ? `${removing.label}: ${removing.address}` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          try {
            list.setData(await services.account.deleteAddress(removing!.id));
            toast.success('Address deleted');
          } catch (err) {
            toast.error('Couldn’t delete', errorMessage(err));
          }
          setRemoving(null);
        }}
      />
    </Card>
  );
}

function AddressModal({ address, onClose, onSaved }: { address: Address | null; onClose: () => void; onSaved: (a: Address[]) => void }) {
  const services = useServices();
  const toast = useToast();
  const { session } = useSession();
  const form = useZodForm(addressSchema, {
    label: address?.label ?? '',
    recipientName: address?.recipientName ?? session?.user.fullName ?? '',
    phone: address?.phone ?? session?.user.phone ?? '',
    address: address?.address ?? '',
    district: address?.district ?? '',
    postalCode: address?.postalCode ?? '',
    isDefault: address?.isDefault ?? false,
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      onSaved(await services.account.saveAddress({ ...v, postalCode: v.postalCode || null }, address?.id));
      toast.success('Address saved');
      onClose();
    } catch (err) {
      if (!applyServerErrors(form, err)) toast.error('Couldn’t save', errorMessage(err));
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      busy={form.formState.isSubmitting}
      title={address ? 'Edit address' : 'Add address'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={form.formState.isSubmitting}>
            Save address
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Label" required placeholder="Home, Office…" {...form.register('label')} error={form.formState.errors.label?.message} />
        <TextField label="Recipient" required {...form.register('recipientName')} error={form.formState.errors.recipientName?.message} />
        <TextField label="Phone" required inputMode="tel" {...form.register('phone')} error={form.formState.errors.phone?.message} />
        <SelectField
          label="District"
          required
          placeholder="Choose district"
          options={BD_DISTRICTS.map((d) => ({ value: d, label: d }))}
          {...form.register('district')}
          error={form.formState.errors.district?.message}
        />
        <TextField label="Address" required containerClassName="sm:col-span-2" {...form.register('address')} error={form.formState.errors.address?.message} />
        <TextField label="Postal code" inputMode="numeric" maxLength={4} {...form.register('postalCode')} error={form.formState.errors.postalCode?.message} />
        <div className="self-end">
          <Controller
            control={form.control}
            name="isDefault"
            render={({ field }) => <Checkbox label="Default address" checked={field.value} onChange={field.onChange} />}
          />
        </div>
      </form>
    </Modal>
  );
}

function PasswordCard() {
  const services = useServices();
  const toast = useToast();
  const { session } = useSession();
  const form = useZodForm(changePasswordSchema, { currentPassword: '', password: '', confirmPassword: '' });
  if (session?.user.authProvider === 'google') {
    return (
      <Card className="p-5 text-sm text-ink-muted">
        <p className="font-bold text-ink">Password</p>
        <p className="mt-1">You sign in with Google, so there’s no BazarHQ password to change.</p>
      </Card>
    );
  }
  const submit = form.handleSubmit(async (v) => {
    try {
      await services.auth.changePassword(v.currentPassword, v.password);
      toast.success('Password changed', 'Other devices were signed out.');
      form.reset();
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('currentPassword', { message: errorMessage(err) });
    }
  });
  return (
    <Card>
      <CardHeader title="Change password" />
      <form onSubmit={submit} noValidate className="space-y-4 p-5 pt-0">
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          {...form.register('currentPassword')}
          error={form.formState.errors.currentPassword?.message}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters with a number."
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          {...form.register('confirmPassword')}
          error={form.formState.errors.confirmPassword?.message}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={form.formState.isSubmitting}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DeleteAccountCard() {
  const services = useServices();
  const { setSession } = useSession();
  const { navigate } = useNavigation();
  const p = useCustomerPaths();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Card className="border-red-200 p-5">
      <p className="font-bold text-red-800">Delete account</p>
      <p className="mt-1 text-sm text-ink-muted">
        You’ll lose access to your order history and saved addresses. Stores keep the transaction records they’re required to retain.
      </p>
      <Button className="mt-3" variant="danger-outline" onClick={() => setOpen(true)}>
        Delete my account
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        title="Delete your account?"
        description="This can’t be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={text !== 'DELETE'}
              onClick={async () => {
                setBusy(true);
                try {
                  await services.account.deleteAccount(text);
                  await services.auth.signOut();
                  setSession(null);
                  navigate(p.home, { replace: true });
                } catch (err) {
                  setError(errorMessage(err));
                  setBusy(false);
                }
              }}
            >
              Delete account
            </Button>
          </>
        }
      >
        <TextField
          label={
            <>
              Type <strong>DELETE</strong> to confirm
            </>
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error}
          autoComplete="off"
        />
      </Modal>
    </Card>
  );
}
