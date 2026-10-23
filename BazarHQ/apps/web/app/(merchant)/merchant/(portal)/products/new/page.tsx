'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, ErrorState, PageHeader, ProductForm, SkeletonRows, StartFromExisting, useAsync, useServices, useToast } from '@bazarhq/ui';
import { paths } from '@/lib/paths';

export default function NewProductPage() {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const categories = useAsync(() => services.products.listCategories(), []);

  return (
    <>
      <title>Add product · BazarHQ Merchant</title>
      <PageHeader
        back={
          <Link href={paths.products} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Products
          </Link>
        }
        title="Add product"
        description="Required fields are marked with *."
      />
      {categories.loading ? (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      ) : categories.error ? (
        <Card>
          <ErrorState message={categories.error} onRetry={categories.reload} />
        </Card>
      ) : (
        <>
          <StartFromExisting onDuplicated={(copy) => router.push(paths.product(copy.id))} />
          <ProductForm
            categories={categories.data ?? []}
            onCategoriesChange={(c) => categories.setData(c)}
            onCancel={() => router.push(paths.products)}
            onSubmit={async (input) => {
              const p = await services.products.create(input);
              toast.success('Product added', p.status === 'active' ? 'It’s now visible on your storefront.' : 'Saved — not visible to customers yet.');
              router.push(paths.products);
            }}
          />
        </>
      )}
    </>
  );
}
