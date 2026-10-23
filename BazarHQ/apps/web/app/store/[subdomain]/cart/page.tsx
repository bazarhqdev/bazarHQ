'use client';

import { CartView, useStore } from '@bazarhq/ui';

export default function StoreCartPage() {
  const store = useStore();
  return (
    <>
      <title>{`Cart · ${store.name}`}</title>
      <CartView />
    </>
  );
}
