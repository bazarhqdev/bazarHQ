'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { Boxes, SlidersHorizontal, X } from 'lucide-react';
import { type InventoryRow, type StockState } from '@bazarhq/shared';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  MovementList,
  PageHeader,
  ProductThumb,
  SearchInput,
  SelectField,
  SkeletonRows,
  StockAdjustDialog,
  StockBadge,
  TableWrap,
  Tabs,
  td,
  th,
  useAsync,
  useDebounced,
  useServices,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

function InventoryView() {
  const services = useServices();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const productFilter = params.get('product');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<StockState | 'all'>('all');
  const [categoryId, setCategoryId] = useState('all');
  const q = useDebounced(search);
  const categories = useAsync(() => services.products.listCategories(), []);
  const rows = useAsync(() => services.inventory.list({ search: q, state, categoryId }), [q, state, categoryId]);
  const allRows = useAsync(() => services.inventory.list(), [rows.data]);
  const movements = useAsync(() => services.inventory.movements({ productId: productFilter ?? undefined, limit: 40 }), [productFilter, rows.data]);
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);

  const visible = useMemo(() => (rows.data ?? []).filter((r) => !productFilter || r.productId === productFilter), [rows.data, productFilter]);
  const counts = useMemo(() => {
    const list = allRows.data ?? [];
    return {
      all: list.length,
      in_stock: list.filter((r) => r.state === 'in_stock').length,
      low_stock: list.filter((r) => r.state === 'low_stock').length,
      out_of_stock: list.filter((r) => r.state === 'out_of_stock').length,
    };
  }, [allRows.data]);
  const focusedName = productFilter ? (allRows.data ?? []).find((r) => r.productId === productFilter)?.productName : null;

  return (
    <>
      <title>Inventory · BazarHQ Merchant</title>
      <PageHeader title="Inventory" description="Stock levels per product and variant. Every change is recorded in the movement log." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <div className="space-y-3 border-b border-line p-4">
            <Tabs
              label="Stock status"
              value={state}
              onChange={setState}
              items={[
                { value: 'all', label: 'All', count: allRows.data ? counts.all : undefined },
                { value: 'low_stock', label: 'Low stock', count: allRows.data ? counts.low_stock : undefined },
                { value: 'out_of_stock', label: 'Out of stock', count: allRows.data ? counts.out_of_stock : undefined },
                { value: 'in_stock', label: 'In stock', count: allRows.data ? counts.in_stock : undefined },
              ]}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_1fr]">
              <SearchInput value={search} onChange={setSearch} placeholder="Search product or variant" label="Search inventory" />
              <SelectField
                aria-label="Category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                options={[{ value: 'all', label: 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
            {productFilter && (
              <div className="flex items-center gap-2 text-[13px]">
                <span className="text-ink-muted">Showing:</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2.5 py-1 font-semibold text-navy-800">
                  {focusedName ?? 'Selected product'}
                  <button
                    type="button"
                    aria-label="Clear product filter"
                    onClick={() => router.replace(pathname)}
                    className="rounded-full p-0.5 hover:bg-navy-100"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </span>
              </div>
            )}
          </div>
          {rows.loading ? (
            <SkeletonRows rows={6} />
          ) : rows.error ? (
            <ErrorState message={rows.error} onRetry={rows.reload} />
          ) : visible.length === 0 ? (
            <EmptyState icon={<Boxes className="size-6" aria-hidden />} title="Nothing to show" description="No stock items match these filters." />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <table className="w-full">
                  <thead className="border-b border-line bg-canvas/60">
                    <tr>
                      <th scope="col" className={th}>
                        Product
                      </th>
                      <th scope="col" className={th}>
                        Category
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Stock
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Threshold
                      </th>
                      <th scope="col" className={th}>
                        Status
                      </th>
                      <th scope="col" className={th}>
                        <span className="sr-only">Adjust</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {visible.map((r) => (
                      <tr key={`${r.productId}:${r.variantId ?? ''}`} className="hover:bg-canvas/60">
                        <td className={td}>
                          <Link href={paths.product(r.productId)} className="flex items-center gap-3 hover:text-brand-700">
                            <ProductThumb name={r.productName} url={r.imageUrl} size={36} />
                            <span>
                              <span className="block font-semibold">{r.productName}</span>
                              {r.variantLabel && <span className="block text-[12px] text-ink-muted">{r.variantLabel}</span>}
                            </span>
                          </Link>
                        </td>
                        <td className={td}>{r.categoryName ?? '—'}</td>
                        <td className={`${td} text-right text-base font-bold tabular`}>{r.stockQuantity}</td>
                        <td className={`${td} text-right tabular text-ink-muted`}>{r.lowStockThreshold}</td>
                        <td className={td}>
                          <StockBadge state={r.state} />
                        </td>
                        <td className={`${td} text-right`}>
                          <Button size="sm" variant="secondary" icon={<SlidersHorizontal className="size-4" aria-hidden />} onClick={() => setAdjusting(r)}>
                            Adjust
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <ul className="divide-y divide-line md:hidden">
                {visible.map((r) => (
                  <li key={`${r.productId}:${r.variantId ?? ''}`} className="flex items-center gap-3 p-4">
                    <ProductThumb name={r.productName} url={r.imageUrl} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {r.productName}
                        {r.variantLabel && <span className="font-normal text-ink-muted"> — {r.variantLabel}</span>}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-sm font-bold tabular">{r.stockQuantity}</span>
                        <StockBadge state={r.state} />
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setAdjusting(r)}>
                      Adjust
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card className="xl:self-start">
          <CardHeader title="Movement history" description={focusedName ? `For ${focusedName}` : 'Latest stock changes across your store'} />
          {movements.loading ? (
            <SkeletonRows rows={5} />
          ) : movements.error ? (
            <ErrorState message={movements.error} onRetry={movements.reload} />
          ) : (
            <MovementList movements={movements.data ?? []} showProduct={!productFilter} />
          )}
        </Card>
      </div>
      <StockAdjustDialog
        row={adjusting}
        open={Boolean(adjusting)}
        onClose={() => setAdjusting(null)}
        onAdjusted={() => {
          void rows.reload();
        }}
      />
    </>
  );
}

export default function InventoryPage() {
  return (
    <Suspense>
      <InventoryView />
    </Suspense>
  );
}
