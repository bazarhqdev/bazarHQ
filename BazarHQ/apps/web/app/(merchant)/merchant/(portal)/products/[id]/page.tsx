'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Copy, Trash2 } from 'lucide-react';
import { errorMessage, formatDateTime } from '@bazarhq/shared';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  MovementList,
  PageHeader,
  ProductForm,
  ProductStatusBadge,
  SkeletonRows,
  useAsync,
  useServices,
  useToast,
  DuplicateProductDialog,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const product = useAsync(() => services.products.get(id), [id]);
  const categories = useAsync(() => services.products.listCategories(), []);
  const movements = useAsync(() => services.inventory.movements({ productId: id, limit: 8 }), [id]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<'delete' | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const p = product.data;
  const loading = product.loading || categories.loading;
  const error = product.error ?? categories.error;

  return (
    <>
      <title>{`${p?.name ?? 'Edit product'} · BazarHQ Merchant`}</title>
      <PageHeader
        back={
          <Link href={paths.products} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Products
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p?.name ?? 'Edit product'} {p && <ProductStatusBadge status={p.status} />}
          </span>
        }
        description={p ? `Last updated ${formatDateTime(p.updatedAt)}` : undefined}
        actions={
          p && (
            <>
              <Button variant="secondary" icon={<Copy className="size-4" aria-hidden />} onClick={() => setDuplicating(true)}>
                Duplicate
              </Button>
              <Button variant="danger-outline" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </>
          )
        }
      />
      {loading ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : error || !p ? (
        <Card>
          <ErrorState message={error ?? 'Product not found.'} onRetry={product.reload} />
        </Card>
      ) : (
        <div className="space-y-5">
          <ProductForm
            key={p.updatedAt}
            product={p}
            categories={categories.data ?? []}
            onCategoriesChange={(c) => categories.setData(c)}
            onCancel={() => router.push(paths.products)}
            onSubmit={async (input) => {
              const updated = await services.products.update(p.id, input);
              product.setData(updated);
              toast.success('Changes saved');
            }}
          />
          <Card>
            <CardHeader
              title="Recent stock movements"
              action={
                <Link href={paths.inventoryFor(p.id)} className="text-[13px] font-semibold text-brand-700 hover:underline">
                  Open in Inventory
                </Link>
              }
            />
            {movements.loading ? <SkeletonRows rows={3} /> : <MovementList movements={movements.data ?? []} showProduct={false} />}
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        busy={busy === 'delete'}
        tone="danger"
        title="Delete this product?"
        description="It will be removed from your store. Past orders keep their item details."
        confirmLabel="Delete product"
        onConfirm={async () => {
          if (!p) return;
          setBusy('delete');
          try {
            await services.products.remove(p.id);
            toast.success('Product deleted');
            router.push(paths.products);
          } catch (e) {
            toast.error('Couldn’t delete', errorMessage(e));
            setBusy(null);
          }
        }}
      />
      <DuplicateProductDialog
        product={duplicating ? (p ?? null) : null}
        onClose={() => setDuplicating(false)}
        onDuplicated={(copy) => {
          setDuplicating(false);
          router.push(paths.product(copy.id));
        }}
      />
    </>
  );
}
