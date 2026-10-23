'use client';

import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, Plus } from 'lucide-react';
import {
  errorMessage,
  formatDateTime,
  INVENTORY_REASON_LABEL,
  newIdempotencyKey,
  stockAdjustmentSchema,
  toFieldErrors,
  type FieldErrors,
  type InventoryMovement,
  type InventoryRow,
} from '@bazarhq/shared';
import { cn } from '../cn';
import { useServices } from '../context';
import { Modal, useToast } from '../components';
import { Alert, Button, TextField } from '../components';
import { StockBadge } from '../components';

export function StockAdjustDialog({
  row,
  open,
  onClose,
  onAdjusted,
}: {
  row: InventoryRow | null;
  open: boolean;
  onClose: () => void;
  onAdjusted: (row: InventoryRow) => void;
}) {
  const services = useServices();
  const toast = useToast();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newIdempotencyKey('adjust'));

  const reset = () => {
    setQty('');
    setNote('');
    setErrors({});
    setError(null);
    setMode('add');
    setKey(newIdempotencyKey('adjust'));
  };

  if (!row) return null;
  const n = Number(qty) || 0;
  const delta = mode === 'add' ? n : -n;
  const after = row.stockQuantity + delta;

  const submit = async () => {
    const v = stockAdjustmentSchema(row.stockQuantity).safeParse({ delta: qty.trim() === '' ? Number.NaN : delta, note });
    if (!v.success) {
      const fe = toFieldErrors(v.error);
      setErrors({ qty: fe.delta ?? '', note: fe.note ?? '' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await services.inventory.adjust({ productId: row.productId, variantId: row.variantId, delta, note, idempotencyKey: key });
      onAdjusted(updated);
      toast.success('Stock updated', `${row.productName}${row.variantLabel ? ` — ${row.variantLabel}` : ''}: ${updated.stockQuantity} units`);
      reset();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      busy={busy}
      size="sm"
      title="Adjust stock"
      description={`${row.productName}${row.variantLabel ? ` — ${row.variantLabel}` : ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" loading={busy} onClick={() => void submit()}>
            Save adjustment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Current</p>
            <p className="text-xl font-bold tabular">{row.stockQuantity}</p>
          </div>
          <div className="text-right">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">After</p>
            <p className={cn('text-xl font-bold tabular', after < 0 ? 'text-red-600' : 'text-ink')}>{qty ? after : '—'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Adjustment type">
          {(['add', 'remove'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold',
                mode === m
                  ? m === 'add'
                    ? 'border-brand-600 bg-brand-50 text-brand-800'
                    : 'border-red-300 bg-red-50 text-red-700'
                  : 'border-line-strong text-ink-muted',
              )}
            >
              {m === 'add' ? <Plus className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
              {m === 'add' ? 'Add stock' : 'Remove stock'}
            </button>
          ))}
        </div>
        <TextField
          label="Quantity"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          error={errors.qty || undefined}
          data-autofocus
        />
        <TextField
          label="Reason"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={errors.note || undefined}
          placeholder="e.g. Weekly restock, damaged items"
          hint="Saved to the inventory movement log."
          maxLength={200}
        />
      </div>
    </Modal>
  );
}

export function MovementList({ movements, showProduct = true }: { movements: InventoryMovement[]; showProduct?: boolean }) {
  if (!movements.length) return <p className="px-5 py-8 text-center text-sm text-ink-muted">No stock movements recorded yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {movements.map((m) => {
        const up = m.quantityDelta > 0;
        return (
          <li key={m.id} className="flex items-start gap-3 px-5 py-3">
            <span
              className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', up ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600')}
            >
              {up ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowDownRight className="size-4" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                <span className="font-semibold">{INVENTORY_REASON_LABEL[m.reason]}</span>
                {showProduct && (
                  <span className="text-ink-muted">
                    {' '}
                    · {m.productName}
                    {m.variantLabel ? ` — ${m.variantLabel}` : ''}
                  </span>
                )}
              </p>
              <p className="text-[12.5px] text-ink-muted">
                {formatDateTime(m.createdAt)}
                {m.actorName && ` · ${m.actorName}`}
                {m.referenceId && ` · ${m.referenceId}`}
              </p>
              {m.note && <p className="text-[12.5px] text-ink-subtle">“{m.note}”</p>}
            </div>
            <span className={cn('shrink-0 text-sm font-bold tabular', up ? 'text-brand-700' : 'text-red-600')}>
              {up ? '+' : '−'}
              {Math.abs(m.quantityDelta)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export { StockBadge };
