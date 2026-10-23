'use client';

/**
 * Merchant return review + refund processing (SRS §14, FR-RET/FR-REF), manual
 * wallet payment review (Option B) and delivery-history export.
 */
import { useState } from 'react';
import { Banknote, CheckCircle2, Download, PackageCheck, ShieldAlert, XCircle } from 'lucide-react';
import {
  canManuallyReviewPayment,
  DISPUTE_STATUS_LABEL,
  errorMessage,
  formatBDT,
  formatDate,
  formatDateTime,
  newIdempotencyKey,
  PAYMENT_METHOD_LABEL,
  paymentReviewSchema,
  REFUND_METHOD_LABEL,
  REFUND_STATUS_LABEL,
  RETURN_METHOD_LABEL,
  RETURN_REASON_LABEL,
  returnDecisionSchema,
  toFieldErrors,
  type DateRange,
  type OrderDetail,
  type RefundMethod,
  type ReturnMethod,
} from '@bazarhq/shared';
import type { ReturnDetail } from '@bazarhq/shared';
import { cn } from '../cn';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ErrorState,
  KeyValue,
  Modal,
  ReturnStatusBadge,
  SelectField,
  SkeletonRows,
  TextArea,
  TextField,
  useToast,
} from '../components';
import { useAsync, useNavigation, useServices } from '../context';
import { useSaveText } from '../native';

const refundTone = { initiated: 'info', processing: 'warning', completed: 'success', failed: 'danger' } as const;

export function ReturnPanel({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const services = useServices();
  const toast = useToast();
  const { Link, paths } = useNavigation();
  const state = useAsync<ReturnDetail>(() => services.returns.get(id), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [restock, setRestock] = useState(true);
  const [receiveNote, setReceiveNote] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);

  if (state.loading) return <SkeletonRows rows={6} />;
  if (state.error || !state.data) return <ErrorState message={state.error ?? 'Return not found.'} onRetry={state.reload} />;
  const { returnRequest: r, order, refund } = state.data;

  const run = async (key: string, fn: () => Promise<ReturnDetail>, ok: string) => {
    setBusy(key);
    try {
      state.setData(await fn());
      onChanged?.();
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
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-ink-subtle">{r.returnNumber}</p>
          <h2 className="text-lg font-bold text-ink">
            {r.customerName} ·{' '}
            <Link href={paths.order(order.id)} className="text-brand-700 hover:underline">
              {r.orderNumber}
            </Link>
          </h2>
          <p className="text-[13px] text-ink-muted">
            Requested {formatDateTime(r.createdAt)} · order total {formatBDT(order.totalAmount)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ReturnStatusBadge status={r.status} />
          {r.dispute.status !== 'none' && <Badge tone="violet">Dispute: {DISPUTE_STATUS_LABEL[r.dispute.status]}</Badge>}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 rounded-xl border border-line p-4 text-sm sm:grid-cols-2">
        <KeyValue label="Reason">{RETURN_REASON_LABEL[r.reason]}</KeyValue>
        <KeyValue label="Requested refund">{formatBDT(r.refundAmountRequested)}</KeyValue>
        <KeyValue label="Condition" className="sm:col-span-2">
          {r.conditionDescription}
        </KeyValue>
        {r.evidenceUrl && (
          <KeyValue label="Evidence" className="sm:col-span-2">
            <img src={r.evidenceUrl} alt="Customer evidence" className="mt-1 max-h-48 rounded-lg ring-1 ring-line" />
          </KeyValue>
        )}
        {r.merchantResponse && (
          <KeyValue label="Your response" className="sm:col-span-2">
            {r.merchantResponse}
          </KeyValue>
        )}
      </dl>

      {r.dispute.status !== 'none' && (
        <Alert tone="info" title="Escalated to BazarHQ">
          The customer disputed this decision. {r.dispute.adminNote ?? 'A Super Admin is reviewing it; you may be asked for more information.'}
        </Alert>
      )}

      {r.status === 'requested' && (
        <Card className="p-4">
          <p className="text-sm font-semibold">Review the request</p>
          <p className="text-[13px] text-ink-muted">
            The customer is notified of your decision. Rejections need a reason and can be escalated by the customer.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="brand"
              icon={<CheckCircle2 className="size-4" aria-hidden />}
              loading={busy === 'approve'}
              onClick={() => run('approve', () => services.returns.decide(r.id, { decision: 'approved', reason: '' }), 'Return approved')}
            >
              Approve
            </Button>
            <Button variant="danger-outline" icon={<XCircle className="size-4" aria-hidden />} onClick={() => setRejectOpen(true)}>
              Reject
            </Button>
          </div>
        </Card>
      )}

      {r.status === 'approved' && (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-semibold">Arrange the return</p>
          <SelectField
            label="Return method"
            value={r.returnMethod ?? ''}
            placeholder="Choose how the item comes back"
            options={Object.entries(RETURN_METHOD_LABEL).map(([value, label]) => ({ value, label }))}
            onChange={(e) =>
              e.target.value && run('method', () => services.returns.setReturnMethod(r.id, e.target.value as ReturnMethod), 'Return method saved')
            }
          />
          <Button icon={<PackageCheck className="size-4" aria-hidden />} disabled={!r.returnMethod} onClick={() => setReceiveOpen(true)}>
            Confirm item received
          </Button>
        </Card>
      )}

      {r.status === 'received' && !refund && (
        <Card className="p-4">
          <p className="text-sm font-semibold">Item received {r.receivedAt && formatDate(r.receivedAt)}</p>
          <p className="text-[13px] text-ink-muted">Create the refund. COD orders are refunded by bank transfer or mobile wallet.</p>
          <Button className="mt-3" icon={<Banknote className="size-4" aria-hidden />} onClick={() => setRefundOpen(true)}>
            Create refund
          </Button>
        </Card>
      )}

      {refund && (
        <Card>
          <CardHeader
            title={`Refund ${formatBDT(refund.amount)}`}
            description={`${REFUND_METHOD_LABEL[refund.method]} · started by ${refund.initiatorName ?? 'System'}`}
            action={<Badge tone={refundTone[refund.status]}>{REFUND_STATUS_LABEL[refund.status]}</Badge>}
          />
          <ol className="space-y-1.5 px-5 text-[13px]">
            {refund.events.map((e, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  <strong>{REFUND_STATUS_LABEL[e.status]}</strong> · {e.actorName}
                  {e.note && <span className="text-ink-muted"> — {e.note}</span>}
                </span>
                <span className="shrink-0 text-ink-subtle">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ol>
          {refund.confirmationReference && <p className="px-5 pt-2 text-[12.5px] text-ink-muted">Settlement reference: {refund.confirmationReference}</p>}
          <div className="flex flex-wrap gap-2 p-5">
            {(refund.status === 'initiated' || refund.status === 'failed') && (
              <Button
                variant="secondary"
                size="sm"
                loading={busy === 'processing'}
                onClick={() => run('processing', () => services.returns.markRefundProcessing(refund.id, ''), 'Refund marked processing')}
              >
                {refund.status === 'failed' ? 'Retry (mark processing)' : 'Mark processing'}
              </Button>
            )}
            {(refund.status === 'initiated' || refund.status === 'processing') && (
              <>
                <Button size="sm" variant="brand" onClick={() => setSettleOpen(true)}>
                  Record settlement
                </Button>
                <Button size="sm" variant="danger-outline" onClick={() => setFailOpen(true)}>
                  Mark failed
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        busy={busy === 'reject'}
        title="Reject this return?"
        description="The reason is shown to the customer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === 'reject'}
              onClick={async () => {
                const v = returnDecisionSchema.safeParse({ decision: 'rejected', reason });
                if (!v.success) return setReasonError(toFieldErrors(v.error).reason);
                if (await run('reject', () => services.returns.decide(r.id, { decision: 'rejected', reason }), 'Return rejected')) setRejectOpen(false);
              }}
            >
              Reject return
            </Button>
          </>
        }
      >
        <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={reasonError} />
      </Modal>

      <Modal
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        busy={busy === 'receive'}
        title="Confirm the item was received"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReceiveOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'receive'}
              onClick={async () =>
                (await run(
                  'receive',
                  () => services.returns.confirmReceipt(r.id, { restock, note: receiveNote, idempotencyKey: newIdempotencyKey('return-receipt') }),
                  'Receipt confirmed',
                )) && setReceiveOpen(false)
              }
            >
              Confirm receipt
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Checkbox
            label="Return items to stock"
            description="Adds the quantities back with an inventory movement (reason: return). Untick if the item can’t be resold."
            checked={restock}
            onChange={setRestock}
          />
          <TextArea label="Inspection note (optional)" value={receiveNote} onChange={(e) => setReceiveNote(e.target.value)} rows={3} />
        </div>
      </Modal>

      <RefundCreateModal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        detail={state.data}
        onDone={(d) => {
          state.setData(d);
          onChanged?.();
        }}
      />
      {refund && (
        <>
          <SettlementModal
            open={settleOpen}
            onClose={() => setSettleOpen(false)}
            refundId={refund.id}
            amount={refund.amount}
            onDone={(d) => {
              state.setData(d);
              onChanged?.();
            }}
          />
          <Modal
            open={failOpen}
            onClose={() => setFailOpen(false)}
            busy={busy === 'fail'}
            title="Mark refund as failed"
            footer={
              <>
                <Button variant="ghost" onClick={() => setFailOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  loading={busy === 'fail'}
                  onClick={async () =>
                    (await run('fail', () => services.returns.markRefundFailed(refund.id, reason), 'Refund marked failed')) && setFailOpen(false)
                  }
                >
                  Mark failed
                </Button>
              </>
            }
          >
            <TextArea label="What went wrong?" required value={reason} onChange={(e) => setReason(e.target.value)} hint="Shown in the refund history." />
          </Modal>
        </>
      )}
    </div>
  );
}

function RefundCreateModal({ open, onClose, detail, onDone }: { open: boolean; onClose: () => void; detail: ReturnDetail; onDone: (d: ReturnDetail) => void }) {
  const services = useServices();
  const toast = useToast();
  const isCod = detail.order.paymentMethod === 'cod';
  const [amount, setAmount] = useState(String(Math.min(detail.returnRequest.refundAmountRequested, detail.order.totalAmount)));
  const [method, setMethod] = useState<RefundMethod>(isCod ? 'bkash' : 'original_method');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newIdempotencyKey('refund'));
  const methods = (Object.keys(REFUND_METHOD_LABEL) as RefundMethod[]).filter((m) => !(isCod && m === 'original_method'));
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Create refund"
      description={`Order total ${formatBDT(detail.order.totalAmount)} · paid by ${PAYMENT_METHOD_LABEL[detail.order.paymentMethod]}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              const n = Number(amount);
              if (!(n > 0) || n > detail.order.totalAmount) return setError(`Enter an amount between ৳1 and ${formatBDT(detail.order.totalAmount)}.`);
              setBusy(true);
              try {
                onDone(await services.returns.createRefund(detail.returnRequest.id, { amount: n, method, idempotencyKey: key }));
                toast.success('Refund created', 'The customer was notified.');
                onClose();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create refund
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Amount (৳)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} error={error} />
        <SelectField
          label="Refund method"
          value={method}
          onChange={(e) => setMethod(e.target.value as RefundMethod)}
          options={methods.map((m) => ({ value: m, label: REFUND_METHOD_LABEL[m] }))}
        />
      </div>
      {isCod && <p className="mt-3 text-[12.5px] text-ink-muted">This was a cash-on-delivery order, so it can’t be refunded to the original method.</p>}
    </Modal>
  );
}

function SettlementModal({
  open,
  onClose,
  refundId,
  amount,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  refundId: string;
  amount: number;
  onDone: (d: ReturnDetail) => void;
}) {
  const services = useServices();
  const toast = useToast();
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newIdempotencyKey('refund-settle'));
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={`Record ${formatBDT(amount)} settlement`}
      description="Completion requires the transfer or wallet transaction reference as evidence."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                onDone(await services.returns.recordRefundSettlement(refundId, { reference, note, idempotencyKey: key }));
                toast.success('Refund completed', 'The order is marked refunded and the return is closed.');
                onClose();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark completed
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Settlement reference"
          required
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          error={error}
          placeholder="e.g. BKASH 9XK2…"
        />
        <TextArea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Manual payment review (Option B: pending_verification → paid|failed)*/
/* ------------------------------------------------------------------ */

export function PaymentReviewCard({
  detail,
  onChange,
  review,
  actorLabel = 'merchant',
}: {
  detail: OrderDetail;
  onChange: (d: OrderDetail) => void;
  /** Defaults to the merchant endpoint; Super Admin passes its own audited endpoint. */
  review?: (orderId: string, input: { decision: 'paid' | 'failed'; reason: string; idempotencyKey: string }) => Promise<OrderDetail>;
  actorLabel?: 'merchant' | 'admin';
}) {
  const services = useServices();
  const toast = useToast();
  const [decision, setDecision] = useState<'paid' | 'failed' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newIdempotencyKey('payment-review'));
  const o = detail.order;
  if (!canManuallyReviewPayment(o)) return null;
  const attempt = detail.payments?.filter((p) => p.status === 'pending_verification').at(-1);
  return (
    <Card className="border-amber-200">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-700" aria-hidden /> Payment awaiting verification
          </span>
        }
        description={`${PAYMENT_METHOD_LABEL[o.paymentMethod]} · ${formatBDT(o.totalAmount)}${attempt?.providerReferenceMasked ? ` · transaction ${attempt.providerReferenceMasked}` : ''}`}
      />
      <div className="space-y-3 px-5 pb-5">
        <p className="text-[13px] text-ink-muted">
          {actorLabel === 'admin'
            ? 'Platform review: confirm with the provider or the merchant’s statement before deciding. Your decision is audited with your IP address.'
            : `Check your ${PAYMENT_METHOD_LABEL[o.paymentMethod]} merchant statement for this transaction before deciding. Your decision is audited.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="brand" onClick={() => setDecision('paid')}>
            Confirm payment received
          </Button>
          <Button size="sm" variant="danger-outline" onClick={() => setDecision('failed')}>
            Not received
          </Button>
        </div>
      </div>
      <Modal
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        busy={busy}
        title={decision === 'paid' ? 'Mark payment as paid?' : 'Mark payment as failed?'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === 'paid' ? 'brand' : 'danger'}
              loading={busy}
              onClick={async () => {
                const v = paymentReviewSchema.safeParse({ decision, reason });
                if (!v.success) return setError(toFieldErrors(v.error).reason);
                setBusy(true);
                try {
                  onChange(await (review ?? services.orders.reviewPayment)(o.id, { decision: decision!, reason, idempotencyKey: key }));
                  toast.success(decision === 'paid' ? 'Payment confirmed' : 'Payment marked failed', 'The customer was notified.');
                  setKey(newIdempotencyKey('payment-review'));
                  setDecision(null);
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {decision === 'paid' ? 'Mark paid' : 'Mark failed'}
            </Button>
          </>
        }
      >
        <TextArea
          label="What did you check?"
          required
          hint="For example: “Matched TRX… in the Rocket merchant statement at 14:05.” At least 10 characters."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={error}
        />
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Delivery history CSV (merchant-recorded delivery events)            */
/* ------------------------------------------------------------------ */

export function DeliveryHistoryButton({ range, className }: { range: DateRange; className?: string }) {
  const services = useServices();
  const toast = useToast();
  const saveText = useSaveText();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      className={cn(className)}
      loading={busy}
      icon={<Download className="size-4" aria-hidden />}
      onClick={async () => {
        setBusy(true);
        try {
          const { filename, csv } = await services.orders.deliveryHistoryCsv(range);
          await saveText(filename, csv);
          toast.success('Delivery history exported', filename);
        } catch (err) {
          toast.error('Export failed', errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      Delivery history CSV
    </Button>
  );
}
