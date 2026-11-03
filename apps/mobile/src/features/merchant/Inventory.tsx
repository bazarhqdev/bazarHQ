import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, X } from 'lucide-react';
import { type InventoryRow, type StockState } from '@bazarhq/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  MovementList,
  ProductThumb,
  SearchInput,
  SkeletonRows,
  StockAdjustDialog,
  StockBadge,
  Tabs,
  useAsync,
  useDebounced,
  useServices,
} from '@bazarhq/ui';
import { Screen, SectionTitle } from '@/components/Screen';

export function InventoryScreen() {
  const services = useServices();
  const [params, setParams] = useSearchParams();
  const productFilter = params.get('product');
  const [state, setState] = useState<StockState | 'all'>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search).trim().toLowerCase();
  // The service currently loads the product inventory before applying filters.
  // Fetch it once, then filter locally so search/tab changes do not repeat the same
  // products + categories requests.
  const all = useAsync(() => services.inventory.list(), []);
  const movements = useAsync(() => services.inventory.movements({ productId: productFilter ?? undefined, limit: 15 }), [productFilter]);
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const visible = useMemo(
    () =>
      (all.data ?? []).filter(
        (r) =>
          (!productFilter || r.productId === productFilter) &&
          (state === 'all' || r.state === state) &&
          (!q || r.productName.toLowerCase().includes(q) || (r.variantLabel ?? '').toLowerCase().includes(q)),
      ),
    [all.data, productFilter, q, state],
  );
  const count = (s: StockState | 'all') => (all.data ? (s === 'all' ? all.data.length : all.data.filter((r) => r.state === s).length) : undefined);

  return (
    <Screen title="Inventory management" onRefresh={() => Promise.all([all.reload(), movements.reload()])}>
      <SearchInput value={search} onChange={setSearch} placeholder="Search stock…" label="Search inventory" />
      <Tabs
        className="mt-3"
        label="Stock status"
        value={state}
        onChange={setState}
        items={[
          { value: 'all', label: 'All', count: count('all') },
          { value: 'low_stock', label: 'Low stock', count: count('low_stock') },
          { value: 'out_of_stock', label: 'Out of stock', count: count('out_of_stock') },
        ]}
      />
      {productFilter && (
        <button
          type="button"
          onClick={() => setParams({})}
          className="mt-2 inline-flex items-center gap-1 rounded-full bg-navy-50 px-3 py-1 text-[13px] font-semibold text-navy-800"
        >
          {visible[0]?.productName ?? 'Selected product'} <X className="size-3.5" aria-label="Clear filter" />
        </button>
      )}
      <Card className="mt-3">
        {all.loading ? (
          <SkeletonRows rows={6} />
        ) : all.error ? (
          <ErrorState message={all.error} onRetry={all.reload} />
        ) : visible.length === 0 ? (
          <EmptyState icon={<Boxes className="size-6" aria-hidden />} title="Nothing here" description="No items match this filter." />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((r) => (
              <li key={`${r.productId}:${r.variantId ?? ''}`} className="flex items-center gap-3 px-3 py-3">
                <ProductThumb name={r.productName} url={r.imageUrl} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">
                    {r.productName}
                    {r.variantLabel && <span className="font-normal text-ink-muted"> — {r.variantLabel}</span>}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm">
                      Stock: <strong className="tabular">{r.stockQuantity}</strong>
                    </span>
                    <StockBadge state={r.state} />
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setAdjusting(r)}>
                  Adjust
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <SectionTitle>Recent stock movements</SectionTitle>
      <Card>{movements.loading ? <SkeletonRows rows={3} /> : <MovementList movements={movements.data ?? []} showProduct={!productFilter} />}</Card>
      <StockAdjustDialog row={adjusting} open={Boolean(adjusting)} onClose={() => setAdjusting(null)} onAdjusted={() => void Promise.all([all.reload(), movements.reload()])} />
    </Screen>
  );
}
