'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAllCarts } from '@bazarhq/ui';
import { customerPaths as p } from '@/lib/paths';
import CartsPage from '../cart/page';

/** Checkout always happens inside one store; with one cart we go straight there. */
export default function CheckoutChooser() {
  const carts = useAllCarts();
  const router = useRouter();
  useEffect(() => {
    if (carts.length === 1) router.replace(p.storeCheckout(carts[0]!.subdomain));
  }, [carts, router]);
  return <CartsPage />;
}
