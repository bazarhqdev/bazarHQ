'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OrderSuccess } from '@bazarhq/ui';

function Success() {
  const order = useSearchParams().get('order') ?? '';
  return <OrderSuccess orderNumber={order} />;
}

export default function OrderSuccessPage() {
  return (
    <>
      <title>Order placed · BazarHQ</title>
      <Suspense>
        <Success />
      </Suspense>
    </>
  );
}
