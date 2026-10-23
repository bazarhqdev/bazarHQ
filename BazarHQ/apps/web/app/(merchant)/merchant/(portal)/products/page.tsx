'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Copy, EllipsisVertical, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  errorMessage,
  formatBDT,
  productPriceRange,
  productStockState,
  productTotalStock,
  type Product,
  type ProductStatus,
  type StockState,
} from '@bazarhq/shared';
import {
  buttonClass,
  Card,
  ConfirmDialog,
  DuplicateProductDialog,
  IconButton,
  PriceTag,
  EmptyState,
  ErrorState,
  PageHeader,
  ProductStatusBadge,
  ProductThumb,
  SearchInput,
  SelectField,
  SkeletonRows,
  StockBadge,
  Switch,
  TableWrap,
  Tabs,
  td,
  th,
  useAsync,
  useDebounced,
  useServices,
  useToast,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

function RowMenu({ product, onDuplicate, onDelete }: { product: Product; onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${product.name}`}
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-2 text-ink-muted hover:bg-navy-50 hover:text-ink"
      >
        <EllipsisVertical className="size-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 animate-fade-in rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-pop)]">
          <Link role="menuitem" href={paths.product(product.id)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-canvas">
            <Pencil className="size-4" aria-hidden /> Edit
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => (setOpen(false), onDuplicate())}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-canvas"
          >
            <Copy className="size-4" aria-hidden /> Duplicate
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => (setOpen(false), onDelete())}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50"
          >
            <Trash2 className="size-4" aria-hidden /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProductStatus | 'all'>('all');
  const [categoryId, setCategoryId] = useState('all');
  const [stock, setStock] = useState<StockState | 'all'>('all');
  const [type, setType] = useState<'all' | 'simple' | 'variant'>('all');
  const q = useDebounced(search);
  const categories = useAsync(() => services.products.listCategories(), []);
  const products = useAsync(() => services.products.list({ search: q, status, categoryId, stock, productType: type }), [q, status, categoryId, stock, type]);
  const all = useAsync(() => services.products.list(), [products.data]);
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name ?? '—';
  const counts = (s: ProductStatus | 'all') => (all.data ? (s === 'all' ? all.data.length : all.data.filter((p) => p.status === s).length) : undefined);

  // Optimistic visibility toggle; reverted if the server rejects it.
  const toggle = async (p: Product, on: boolean) => {
    const next: ProductStatus = on ? 'active' : 'inactive';
    products.setData((list) => (list ?? []).map((x) => (x.id === p.id ? { ...x, status: next } : x)));
    try {
      await services.products.setStatus(p.id, next);
      toast.success(on ? `${p.name} is now visible` : `${p.name} is hidden`);
    } catch (e) {
      products.setData((list) => (list ?? []).map((x) => (x.id === p.id ? { ...x, status: p.status } : x)));
      toast.error('Couldn’t change visibility', errorMessage(e));
    }
  };

  const [duplicating, setDuplicating] = useState<Product | null>(null);
  const duplicate = (p: Product) => setDuplicating(p);

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await services.products.remove(toDelete.id);
      products.setData((list) => (list ?? []).filter((x) => x.id !== toDelete.id));
      toast.success('Product deleted', 'Past orders keep their item details.');
      setToDelete(null);
    } catch (e) {
      toast.error('Couldn’t delete', errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const filtersActive = q || status !== 'all' || categoryId !== 'all' || stock !== 'all' || type !== 'all';
  const list = products.data ?? [];

  return (
    <>
      <title>Products · BazarHQ Merchant</title>
      <PageHeader
        title="Products"
        description="Create, edit and control visibility of your catalogue."
        actions={
          <Link href={paths.productNew} className={buttonClass('brand', 'md')}>
            <Plus className="size-4" aria-hidden /> Add product
          </Link>
        }
      />
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <Tabs
            label="Filter by status"
            value={status}
            onChange={setStatus}
            items={[
              { value: 'all', label: 'All', count: counts('all') },
              { value: 'active', label: 'Active', count: counts('active') },
              { value: 'inactive', label: 'Hidden', count: counts('inactive') },
              { value: 'draft', label: 'Draft', count: counts('draft') },
            ]}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr]">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by name or SKU" label="Search products" />
            <SelectField
              aria-label="Category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              options={[{ value: 'all', label: 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
            />
            <SelectField
              aria-label="Stock"
              value={stock}
              onChange={(e) => setStock(e.target.value as StockState | 'all')}
              options={[
                { value: 'all', label: 'Any stock' },
                { value: 'in_stock', label: 'In stock' },
                { value: 'low_stock', label: 'Low stock' },
                { value: 'out_of_stock', label: 'Out of stock' },
              ]}
            />
            <SelectField
              aria-label="Product type"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              options={[
                { value: 'all', label: 'All types' },
                { value: 'simple', label: 'Simple' },
                { value: 'variant', label: 'With variants' },
              ]}
            />
          </div>
        </div>

        {products.loading ? (
          <SkeletonRows rows={6} />
        ) : products.error ? (
          <ErrorState message={products.error} onRetry={products.reload} />
        ) : list.length === 0 ? (
          filtersActive ? (
            <EmptyState
              icon={<Package className="size-6" aria-hidden />}
              title="No products match these filters"
              description="Try a different search or clear the filters."
            />
          ) : (
            <EmptyState
              icon={<Package className="size-6" aria-hidden />}
              title="Add your first product"
              description="Products you add appear on your storefront once they’re active."
              action={
                <Link href={paths.productNew} className={buttonClass('brand', 'md')}>
                  Add product
                </Link>
              }
            />
          )
        ) : (
          <>
            {/* Desktop table */}
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
                    <th scope="col" className={th}>
                      Price
                    </th>
                    <th scope="col" className={th}>
                      Stock
                    </th>
                    <th scope="col" className={th}>
                      Status
                    </th>
                    <th scope="col" className={th}>
                      Visible
                    </th>
                    <th scope="col" className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.map((p) => {
                    const [lo, hi] = productPriceRange(p);
                    const primary = p.images.find((i) => i.isPrimary) ?? p.images[0];
                    return (
                      <tr key={p.id} className="hover:bg-canvas/60">
                        <td className={td}>
                          <Link href={paths.product(p.id)} className="flex items-center gap-3 font-semibold text-ink hover:text-brand-700">
                            <ProductThumb name={p.name} url={primary?.url} size={40} />
                            <span className="min-w-0">
                              <span className="block truncate">{p.name}</span>
                              <span className="block text-[12px] font-normal text-ink-subtle">
                                {p.extensions.sku ?? 'No SKU'}
                                {p.productType === 'variant' && ` · ${p.variants.length} variants`}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className={td}>{catName(p.categoryId)}</td>
                        <td className={td}>
                          <PriceTag product={p} range size="sm" />
                          {lo !== hi && <span className="sr-only">{`${formatBDT(lo)} to ${formatBDT(hi)}`}</span>}
                        </td>
                        <td className={td}>
                          <div className="flex items-center gap-2">
                            <span className="w-8 tabular font-semibold">{productTotalStock(p)}</span>
                            <StockBadge state={productStockState(p)} />
                          </div>
                        </td>
                        <td className={td}>
                          <ProductStatusBadge status={p.status} />
                        </td>
                        <td className={td}>
                          <Switch checked={p.status === 'active'} onChange={(on) => void toggle(p, on)} label={`Show ${p.name} on storefront`} size="sm" />
                        </td>
                        <td className={`${td} text-right`}>
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton label={`Duplicate ${p.name}`} title="Duplicate" onClick={() => duplicate(p)}>
                              <Copy className="size-4" aria-hidden />
                            </IconButton>
                            <RowMenu product={p} onDuplicate={() => duplicate(p)} onDelete={() => setToDelete(p)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            {/* Mobile list */}
            <ul className="divide-y divide-line md:hidden">
              {list.map((p) => {
                const primary = p.images.find((i) => i.isPrimary) ?? p.images[0];
                return (
                  <li key={p.id} className="flex items-center gap-3 p-4">
                    <Link href={paths.product(p.id)} className="flex min-w-0 flex-1 items-center gap-3">
                      <ProductThumb name={p.name} url={primary?.url} size={48} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{p.name}</span>
                        <span className="flex flex-wrap items-baseline gap-x-1.5 text-[12.5px] text-ink-muted">
                          <PriceTag product={p} size="sm" /> · {productTotalStock(p)} in stock
                        </span>
                        <span className="mt-1 flex gap-1.5">
                          <ProductStatusBadge status={p.status} />
                          <StockBadge state={productStockState(p)} />
                        </span>
                      </span>
                    </Link>
                    <Switch checked={p.status === 'active'} onChange={(on) => void toggle(p, on)} label={`Show ${p.name} on storefront`} size="sm" />
                    <RowMenu product={p} onDuplicate={() => duplicate(p)} onDelete={() => setToDelete(p)} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
      <DuplicateProductDialog
        product={duplicating}
        onClose={() => setDuplicating(null)}
        onDuplicated={(copy) => {
          setDuplicating(null);
          router.push(paths.product(copy.id));
        }}
      />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={() => void remove()}
        busy={deleting}
        tone="danger"
        title={`Delete “${toDelete?.name ?? ''}”?`}
        description="The product is removed from your store. Past orders keep their item snapshots."
        confirmLabel="Delete product"
      />
    </>
  );
}
