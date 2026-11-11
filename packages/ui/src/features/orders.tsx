'use client';

import { useState } from 'react';
import { Ban, Banknote, CheckCircle2, Circle, Clock, FlaskConical } from 'lucide-react';
import {
  canCancelOrder,
  canRecordCodCollection,
  cancelOrderSchema,
  codCollectionSchema,
  confirmBlockedReason,
  errorMessage,
  formatBDT,
  formatDateTime,
  newIdempotencyKey,
  nextForwardStatus,
  ORDER_ACTION_LABEL,
  ORDER_FORWARD_PATH,
  ORDER_STATUS_LABEL,
  toFieldErrors,
  type DeliveryEvent,
  type FieldErrors,
  type Order,
  type OrderDetail,
  type OrderStatus,
} from '@bazarhq/shared';
import { cn } from '../cn';
import { useServices } from '../context';
import { Modal, useToast } from '../components';
import { Alert, Badge, Button, Checkbox, TextArea, TextField } from '../components';
import { ProductThumb } from '../components';

/** Canonical timeline: forward path with timestamps from delivery_events, cancellation shown separately (FR-C-24). */
export function OrderTimeline({ order, events }: { order: Order; events: DeliveryEvent[] }) {
  const at = (s: OrderStatus) => events.find((e) => e.eventType === s);
  const reachedIndex =
    order.status === 'cancelled' ? Math.max(...ORDER_FORWARD_PATH.map((s, i) => (at(s) ? i : -1))) : ORDER_FORWARD_PATH.indexOf(order.status);
  const cancelled = events.find((e) => e.eventType === 'cancelled');
  const cod = events.find((e) => e.eventType === 'cod_collected');

  const steps = ORDER_FORWARD_PATH.map((s, i) => ({
    status: s,
    event: at(s),
    done: i <= reachedIndex,
    current: i === reachedIndex && order.status !== 'cancelled',
  }));

  return (
    <ol className="relative space-y-0" aria-label="Order timeline">
      {steps.map((st, i) => {
        const last = i === steps.length - 1 && !cancelled;
        return (
          <li key={st.status} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && (
              <span
                className={cn('absolute left-[11px] top-6 h-[calc(100%-18px)] w-0.5', st.done && steps[i + 1]?.done ? 'bg-brand-500' : 'bg-line-strong')}
                aria-hidden
              />
            )}
            <span className="relative z-[1] mt-0.5 shrink-0">
              {st.done ? (
                <CheckCircle2 className={cn('size-6', st.current ? 'text-navy-900' : 'text-brand-600')} fill="white" aria-hidden />
              ) : (
                <Circle className="size-6 text-line-strong" fill="white" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <p className={cn('text-sm font-semibold', st.done ? 'text-ink' : 'text-ink-subtle')}>
                {ORDER_STATUS_LABEL[st.status]}
                <span className="sr-only">{st.done ? ' (completed)' : ' (not yet)'}</span>
              </p>
              {st.event ? (
                <p className="text-[12.5px] text-ink-muted">
                  {formatDateTime(st.event.createdAt)}
                  {st.event.actorName && ` · ${st.event.actorName}`}
                </p>
              ) : (
                <p className="text-[12.5px] text-ink-subtle">Pending</p>
              )}
              {st.event?.notes && <p className="mt-0.5 text-[12.5px] text-ink-muted">“{st.event.notes}”</p>}
            </div>
          </li>
        );
      })}
      {cancelled && (
        <li className="relative flex gap-3">
          <Ban className="mt-0.5 size-6 shrink-0 text-red-600" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-red-700">Cancelled</p>
            <p className="text-[12.5px] text-ink-muted">
              {formatDateTime(cancelled.createdAt)}
              {cancelled.actorName && ` · ${cancelled.actorName}`}
            </p>
            {cancelled.notes && <p className="mt-0.5 text-[12.5px] text-ink-muted">Reason: {cancelled.notes}</p>}
          </div>
        </li>
      )}
      {cod && (
        <li className="relative mt-4 flex gap-3 rounded-lg bg-brand-50 p-2.5">
          <Banknote className="size-5 shrink-0 text-brand-700" aria-hidden />
          <p className="text-[12.5px] text-brand-900">
            COD {formatBDT(cod.codAmount ?? 0)} collected · {formatDateTime(cod.createdAt)}
            {cod.actorName && ` · ${cod.actorName}`}
          </p>
        </li>
      )}
    </ol>
  );
}

export function OrderItemsList({ order }: { order: Order }) {
  return (
    <div>
      <ul className="divide-y divide-line">
        {order.items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 py-3">
            <ProductThumb name={it.productName} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{it.productName}</p>
              <p className="text-[12.5px] text-ink-muted">
                {it.variantLabel ? `${it.variantLabel} · ` : ''}
                {formatBDT(it.unitPrice)} × {it.quantity}
              </p>
            </div>
            <p className="text-sm font-semibold tabular text-ink">{formatBDT(it.subtotal)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-2 space-y-1.5 border-t border-line pt-3 text-sm">
        <div className="flex justify-between text-ink-muted">
          <dt>Subtotal</dt>
          <dd className="tabular">{formatBDT(order.subtotal)}</dd>
        </div>
        <div className="flex justify-between text-ink-muted">
          <dt>Delivery charge</dt>
          <dd className="tabular">{formatBDT(order.deliveryCharge)}</dd>
        </div>
        <div className="flex justify-between text-base font-bold text-ink">
          <dt>Total</dt>
          <dd className="tabular">{formatBDT(order.totalAmount)}</dd>
        </div>
      </dl>
    </div>
  );
}



/** One-way academic test marker. It never changes payment/order state or deletes financial records. */
export function MarkTestOrder({ detail, onChange, compact }: { detail: OrderDetail; onChange: (d: OrderDetail) => void; compact?: boolean }) {
  const services = useServices();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('Academic project test — no real money was received.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { order } = detail;

  if (order.isTest) {
    return (
      <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warning"><FlaskConical className="size-3" aria-hidden /> Academic test order</Badge>
          <span className="text-[12px] font-medium text-amber-900">Excluded from sales and GMV analytics</span>
        </div>
        {order.testReason && <p className="text-[12.5px] text-amber-900">Reason: {order.testReason}</p>}
        {order.paymentStatus === 'cod_collected' && (
          <p className="text-[12px] text-amber-900">This is a test marker only. The recorded COD/payment history has not been changed and does not prove real cash was received.</p>
        )}
      </div>
    );
  }

  async function submit() {
    const clean = reason.normalize('NFC').trim();
    if (clean.length < 5 || clean.length > 300) {
      setError('Add a reason between 5 and 300 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await services.orders.markAsTest(order.id, clean);
      onChange(updated);
      toast.success('Order marked as test', 'It will be excluded from merchant sales and GMV analytics. Payment and audit history remain unchanged.');
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size={compact ? 'sm' : 'md'} block={compact} icon={<FlaskConical className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
        Mark as academic test
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Mark this order as a test?"
        description="This is a one-way label for academic/testing records. The order and payment history will not be deleted or changed. The order will be excluded from merchant sales and GMV analytics."
        busy={busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Keep as real order</Button>
            <Button variant="brand" loading={busy} onClick={() => void submit()}>Mark as test</Button>
          </>
        }
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <TextArea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} hint="For example: Academic project test; no real cash was collected." />
      </Modal>
    </>
  );
}

/**
 * Merchant-managed status actions. Only the transitions allowed by the
 * canonical state machine are offered; the server re-validates each one.
 */
export function OrderActions({ detail, onChange, compact }: { detail: OrderDetail; onChange: (d: OrderDetail) => void; compact?: boolean }) {
  const services = useServices();
  const toast = useToast();
  const { order } = detail;
  const next = nextForwardStatus(order.status) as Exclude<OrderStatus, 'cancelled' | 'pending'> | null;
  const blocked = next === 'confirmed' ? confirmBlockedReason(order) : null;
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [codOpen, setCodOpen] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(String(order.totalAmount));
  const [confirmCash, setConfirmCash] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per dialog opening so double-taps/retries are safe.
  const [opKey, setOpKey] = useState(() => newIdempotencyKey('order'));

  const open = (which: 'advance' | 'cancel' | 'cod') => {
    setOpKey(newIdempotencyKey(which));
    setErrors({});
    setError(null);
    if (which === 'advance') setAdvanceOpen(true);
    if (which === 'cancel') setCancelOpen(true);
    if (which === 'cod') setCodOpen(true);
  };

  async function run(fn: () => Promise<OrderDetail>, success: string, close: () => void) {
    setBusy(true);
    setError(null);
    try {
      const d = await fn();
      onChange(d);
      toast.success(success);
      close();
      setNote('');
      setReason('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const terminal = order.status === 'delivered' || order.status === 'cancelled';
  const showCod = canRecordCodCollection(order);

  return (
    <div className="space-y-3">
      {blocked && <Alert tone="warning">{blocked}</Alert>}
      {order.paymentMethod === 'cod' && order.paymentStatus === 'cod_pending' && !showCod && !terminal && (
        <p className="flex items-start gap-1.5 text-[12.5px] text-ink-muted">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> COD stays pending until you record the cash collection at delivery.
        </p>
      )}
      <div className={cn('flex flex-wrap gap-2', compact && 'flex-col')}>
        {next && (
          <Button variant="primary" onClick={() => open('advance')} disabled={Boolean(blocked)} block={compact}>
            {ORDER_ACTION_LABEL[next]}
          </Button>
        )}
        {showCod && (
          <Button variant="brand" icon={<Banknote className="size-4" aria-hidden />} onClick={() => open('cod')} block={compact}>
            Record COD collection
          </Button>
        )}
        {canCancelOrder(order.status) && (
          <Button variant="danger-outline" onClick={() => open('cancel')} block={compact}>
            Cancel order
          </Button>
        )}
      </div>
      {terminal && !showCod && (
        <p className="text-[12.5px] text-ink-muted">
          {order.status === 'delivered'
            ? 'This order is delivered. No further status changes are available.'
            : 'This order is cancelled. No further status changes are available.'}
        </p>
      )}
      {order.status === 'out_for_delivery' && <p className="text-[12.5px] text-ink-muted">Orders out for delivery can no longer be cancelled.</p>}

      {next && (
        <Modal
          open={advanceOpen}
          onClose={() => setAdvanceOpen(false)}
          busy={busy}
          title={ORDER_ACTION_LABEL[next]}
          description={`${order.orderNumber}: ${ORDER_STATUS_LABEL[order.status]} → ${ORDER_STATUS_LABEL[next]}. The customer will be notified.`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdvanceOpen(false)} disabled={busy}>
                Back
              </Button>
              <Button
                variant="primary"
                loading={busy}
                onClick={() =>
                  void run(
                    () => services.orders.updateStatus(order.id, next, { note, idempotencyKey: opKey }),
                    `Order marked ${ORDER_STATUS_LABEL[next].toLowerCase()}`,
                    () => setAdvanceOpen(false),
                  )
                }
              >
                {ORDER_ACTION_LABEL[next]}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <TextArea
              label={next === 'shipped' ? 'Courier note (optional)' : 'Note (optional)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder={next === 'shipped' ? 'e.g. Handed to courier, tracking ID…' : 'Visible in the order history'}
              data-autofocus
            />
          </div>
        </Modal>
      )}

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        busy={busy}
        title="Cancel this order?"
        description="A reason is required and is shown to the customer. Reserved stock is returned to inventory once."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={busy}>
              Keep order
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                const v = cancelOrderSchema.safeParse({ reason });
                if (!v.success) return setErrors(toFieldErrors(v.error));
                void run(
                  () => services.orders.cancel(order.id, { reason, idempotencyKey: opKey }),
                  'Order cancelled',
                  () => setCancelOpen(false),
                );
              }}
            >
              Cancel order
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          {(order.paymentStatus === 'paid' || order.paymentStatus === 'pending_verification') && (
            <Alert tone="warning">This order has an online payment. Any refund follows the platform refund process and is not issued by cancelling.</Alert>
          )}
          <TextArea
            label="Cancellation reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={errors.reason}
            rows={3}
            maxLength={300}
            data-autofocus
          />
        </div>
      </Modal>

      <Modal
        open={codOpen}
        onClose={() => setCodOpen(false)}
        busy={busy}
        title="Record COD collection"
        description="Record this only after you have actually received the cash."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCodOpen(false)} disabled={busy}>
              Back
            </Button>
            <Button
              variant="brand"
              loading={busy}
              onClick={() => {
                const v = codCollectionSchema(order.totalAmount).safeParse({ amount: Number(amount), confirm: confirmCash });
                if (!v.success) return setErrors(toFieldErrors(v.error));
                void run(
                  () => services.orders.recordCodCollection(order.id, { amount: Number(amount), idempotencyKey: opKey }),
                  'COD collection recorded',
                  () => setCodOpen(false),
                );
              }}
            >
              Record collection
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <TextField
            label="Amount collected"
            type="number"
            inputMode="decimal"
            prefix="৳"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={errors.amount}
            hint={`Order total: ${formatBDT(order.totalAmount)}`}
          />
          <Checkbox label="I confirm the cash has been collected" checked={confirmCash} onChange={setConfirmCash} />
          {errors.confirm && <p className="text-[12.5px] font-medium text-red-700">{errors.confirm}</p>}
        </div>
      </Modal>
    </div>
  );
}
