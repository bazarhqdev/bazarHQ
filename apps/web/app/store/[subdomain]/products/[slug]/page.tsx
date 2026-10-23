'use client';

import { useParams } from 'next/navigation';
import { ProductDetail, useStore } from '@bazarhq/ui';

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const store = useStore();
  return (
    <>
      <title>{`Product · ${store.name}`}</title>
      <ProductDetail key={slug} productSlug={decodeURIComponent(slug)} />
    </>
  );
}
