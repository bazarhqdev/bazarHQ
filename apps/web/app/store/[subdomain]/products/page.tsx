'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { type StorefrontSort } from '@bazarhq/shared';
import { ProductListing, useStore } from '@bazarhq/ui';

function Listing() {
  const sp = useSearchParams();
  const initial = { q: sp.get('q') ?? undefined, category: sp.get('category') ?? undefined, sort: (sp.get('sort') as StorefrontSort | null) ?? undefined };
  return <ProductListing key={sp.toString()} initial={initial} />;
}

export default function ProductsPage() {
  const store = useStore();
  return (
    <>
      <title>{`Products · ${store.name}`}</title>
      <Suspense>
        <Listing />
      </Suspense>
    </>
  );
}
