import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Copy, Package, Plus, Trash2 } from 'lucide-react';
import { errorMessage, productStockState, productTotalStock, type Product, type ProductStatus } from '@bazarhq/shared';
import {
  Card,
  ConfirmDialog,
  DuplicateProductDialog,
  EmptyState,
  ErrorState,
  IconButton,
  PriceTag,
  ProductForm,
  ProductStatusBadge,
  ProductThumb,
  SearchInput,
  SkeletonRows,
  StartFromExisting,
  StockBadge,
  Switch,
  Tabs,
  useAsync,
  useDebounced,
  useServices,
  useToast,
} from '@bazarhq/ui';
import { Screen } from '@/components/Screen';
import { paths } from '@/navigation/paths';

export function ProductsScreen() {
  const services = useServices();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProductStatus | 'all'>('all');
  const q = useDebounced(search);
  const products = useAsync(() => services.products.list({ search: q, status }), [q, status]);
  const list = products.data ?? [];
  const navigate = useNavigate();
  const [duplicating, setDuplicating] = useState<Product | null>(null);

  const toggle = async (p: Product, on: boolean) => {
    const next: ProductStatus = on ? 'active' : 'inactive';
    products.setData((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, status: next } : x)));
    try {
      await services.products.setStatus(p.id, next);
    } catch (e) {
      products.setData((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, status: p.status } : x)));
      toast.error('Couldn’t change visibility', errorMessage(e));
    }
  };

  return (
    <Screen
      title="My products"
      subtitle={products.data ? `${list.length} shown` : undefined}
      onRefresh={products.reload}
      actions={
        <Link
          to={paths.productNew}
          aria-label="Add product"
          className="flex size-11 items-center justify-center rounded-full bg-brand-600 text-white active:bg-brand-700"
        >
          <Plus className="size-5" aria-hidden />
        </Link>
      }
    >
      <SearchInput value={search} onChange={setSearch} placeholder="Search products…" label="Search products" />
      <Tabs
        className="mt-3"
        label="Product status"
        value={status}
        onChange={setStatus}
        items={[
          { value: 'all', label: 'All' },
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Hidden' },
          { value: 'draft', label: 'Draft' },
        ]}
      />
      <Card className="mt-3">
        {products.loading ? (
          <SkeletonRows rows={6} />
        ) : products.error ? (
          <ErrorState message={products.error} onRetry={products.reload} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Package className="size-6" aria-hidden />}
            title={q || status !== 'all' ? 'No products match' : 'No products yet'}
            description="Tap + to add your first product."
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((p) => {
              const primary = p.images.find((i) => i.isPrimary) ?? p.images[0];
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-3">
                  <Link to={paths.product(p.id)} className="flex min-w-0 flex-1 items-center gap-3">
                    <ProductThumb name={p.name} url={primary?.url} size={52} />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold">{p.name}</span>
                      <span className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] text-ink-muted">
                        <PriceTag product={p} size="sm" /> · Stock {productTotalStock(p)}
                      </span>
                      <span className="mt-1 flex gap-1.5">
                        <ProductStatusBadge status={p.status} />
                        <StockBadge state={productStockState(p)} />
                      </span>
                    </span>
                  </Link>
                  <IconButton label={`Duplicate ${p.name}`} onClick={() => setDuplicating(p)}>
                    <Copy className="size-5" aria-hidden />
                  </IconButton>
                  <Switch checked={p.status === 'active'} onChange={(on) => void toggle(p, on)} label={`Show ${p.name} on storefront`} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <DuplicateProductDialog
        product={duplicating}
        onClose={() => setDuplicating(null)}
        onDuplicated={(copy) => {
          setDuplicating(null);
          navigate(paths.product(copy.id));
        }}
      />
    </Screen>
  );
}

export function ProductEditorScreen() {
  const { id } = useParams<{ id: string }>();
  const services = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const product = useAsync(() => (id ? services.products.get(id) : Promise.resolve(undefined)), [id]);
  const categories = useAsync(() => services.products.listCategories(), []);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState<Product | null>(null);
  const p = product.data;

  return (
    <Screen
      title={id ? 'Edit product' : 'Add new product'}
      back
      className="pb-0"
      actions={
        p && (
          <>
            <IconButton label="Duplicate" onClick={() => setDuplicating(p)}>
              <Copy className="size-5" aria-hidden />
            </IconButton>
            <IconButton label="Delete" tone="danger" onClick={() => setConfirm(true)}>
              <Trash2 className="size-5" aria-hidden />
            </IconButton>
          </>
        )
      }
    >
      {product.loading || categories.loading ? (
        <SkeletonRows rows={6} />
      ) : product.error || categories.error ? (
        <ErrorState message={(product.error ?? categories.error)!} onRetry={product.reload} />
      ) : (
        <>
          {!p && <StartFromExisting onDuplicated={(copy) => navigate(paths.product(copy.id), { replace: true })} />}
          <ProductForm
            key={p?.updatedAt ?? 'new'}
            layout="mobile"
            product={p}
            categories={categories.data ?? []}
            onCategoriesChange={(c) => categories.setData(c)}
            onCancel={() => navigate(-1)}
            onSubmit={async (input) => {
              if (p) {
                const updated = await services.products.update(p.id, input);
                product.setData(updated);
                toast.success('Changes saved');
              } else {
                await services.products.create(input);
                toast.success('Product added');
                navigate(paths.products, { replace: true });
              }
            }}
          />
        </>
      )}
      <DuplicateProductDialog
        product={duplicating}
        onClose={() => setDuplicating(null)}
        onDuplicated={(copy) => {
          setDuplicating(null);
          navigate(paths.product(copy.id), { replace: true });
        }}
      />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        busy={deleting}
        tone="danger"
        title="Delete this product?"
        description="Past orders keep their item details."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!p) return;
          setDeleting(true);
          try {
            await services.products.remove(p.id);
            toast.success('Product deleted');
            navigate(paths.products, { replace: true });
          } catch (e) {
            toast.error('Couldn’t delete', errorMessage(e));
            setDeleting(false);
          }
        }}
      />
    </Screen>
  );
}
