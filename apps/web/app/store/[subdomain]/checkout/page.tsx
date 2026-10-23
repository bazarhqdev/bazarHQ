'use client';

import { CheckoutFlow, useStore } from '@bazarhq/ui';

export default function StoreCheckoutPage() {
  const store = useStore();
  return (
    <>
      <title>{`Checkout · ${store.name}`}</title>
      <CheckoutFlow />
    </>
  );
}
